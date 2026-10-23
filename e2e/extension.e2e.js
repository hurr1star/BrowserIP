// End-to-end tests: loads the extension into Chromium with every network
// service mocked, then drives the popup, settings, protected sites, history
// and lookup pages. Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(root, "test/fixtures", `${name}.json`), "utf8"));

const VPN_IP = "185.65.135.10";
const HOME_IP = "198.51.100.7";
const HOME_V6 = "2001:db8::7";
const SCENARIOS = {
  vpn: { v4: VPN_IP, v6: null },
  direct: { v4: HOME_IP, v6: null },
  leak: { v4: VPN_IP, v6: HOME_V6 },
  offline: { v4: null, v6: null }
};
const LOOKUPS = {
  [VPN_IP]: fixture("ipapi-vpn"),
  [HOME_IP]: fixture("ipapi-residential"),
  [HOME_V6]: { ...fixture("ipapi-residential"), ip: HOME_V6 }
};

let scenario = "vpn";
let context;
let worker;
let extensionUrl;
let extensionDir;
let workDir;
let helperBuilt = false;

// Decided at load time, because test options are read when tests register.
const goAvailable = (() => {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch (_error) {
    return false;
  }
})();

// A stand-in for Mullvad's CLI: keeps its connection state in files, and
// the network mock below routes traffic according to that state.
const FAKE_MULLVAD = `#!/usr/bin/env bash
state=$(cat "$FAKE_MULLVAD_STATE" 2>/dev/null || echo disconnected)
country=$(cat "$FAKE_MULLVAD_STATE.country" 2>/dev/null || echo se)
relay=se-got-wg-001; place="Sweden, Gothenburg"
if [ "$country" = de ]; then relay=de-fra-wg-001; place="Germany, Frankfurt"; fi
case "$1 $2" in
  "status --json") exit 1 ;;
  "status ")
    if [ "$state" = connected ]; then
      printf 'Connected\n    Relay:                  %s\n    Visible location:       %s. IPv4: 185.65.135.10\n' "$relay" "$place"
    else
      echo Disconnected
    fi ;;
  "connect "|"reconnect ") echo connected > "$FAKE_MULLVAD_STATE" ;;
  "disconnect ") echo disconnected > "$FAKE_MULLVAD_STATE" ;;
  "relay set") echo "$4" > "$FAKE_MULLVAD_STATE.country" ;;
  "relay list") printf 'Germany (de)\n\tFrankfurt (fra) @ 50.1N\nSweden (se)\n\tGothenburg (got) @ 57.7N\n' ;;
  "version ") echo 2025.9 ;;
  *) echo "unknown command" >&2; exit 1 ;;
esac
`;

function fakeMullvadState() {
  const read = (suffix, fallback) => {
    try {
      return readFileSync(join(workDir, `mullvad-state${suffix}`), "utf8").trim();
    } catch (_error) {
      return fallback;
    }
  };
  return { connected: read("", "disconnected") === "connected", country: read(".country", "se") };
}

async function mockNetwork(route) {
  const url = new URL(route.request().url());
  const app = fakeMullvadState();
  const current = scenario === "mullvadApp" ? (app.connected ? SCENARIOS.vpn : SCENARIOS.direct) : SCENARIOS[scenario];
  if (url.host === "ipv4.am.i.mullvad.net" || url.host === "ipv6.am.i.mullvad.net") {
    const ip = url.host.startsWith("ipv4") ? current.v4 : current.v6;
    if (!ip) {
      return route.abort();
    }
    const exit = ip === VPN_IP;
    return route.fulfill({
      json: {
        ip,
        mullvad_exit_ip: exit,
        mullvad_exit_ip_hostname: exit ? (app.country === "de" ? "de-fra-wg-001" : "se-got-wg-001") : undefined,
        mullvad_server_type: exit ? "WireGuard" : undefined,
        blacklisted: { blacklisted: exit, results: [{ name: "Spamhaus", blacklisted: exit }] }
      }
    });
  }
  if (url.host === "api4.ipify.org" || url.host === "api6.ipify.org") {
    const ip = url.host === "api4.ipify.org" ? current.v4 : current.v6;
    return ip ? route.fulfill({ json: { ip } }) : route.abort();
  }
  if (url.host === "api.ipapi.is") {
    const data = LOOKUPS[url.searchParams.get("q")];
    return data && scenario !== "offline" ? route.fulfill({ json: data }) : route.fulfill({ status: 503, body: "" });
  }
  if (url.host === "proxycheck.io") {
    const ip = url.pathname.split("/").pop();
    return route.fulfill({ json: { status: "ok", [ip]: { proxy: "no", type: "Residential" } } });
  }
  if (url.host === "bash.ws" && url.pathname === "/id") {
    return route.fulfill({ body: "4242" });
  }
  if (url.host === "bash.ws") {
    return route.fulfill({
      json: [
        { ip: "193.138.218.74", country_name: "Sweden", asn: "AS39351 31173 Services", type: "dns" },
        { ip: "DNS is not leaking.", type: "conclusion" }
      ]
    });
  }
  if (url.host.endsWith(".bash.ws")) {
    return route.fulfill({ body: "" });
  }
  if (url.host.endsWith(".test")) {
    return route.fulfill({ contentType: "text/html", body: `<title>site</title><p id="site">${url.href}</p>` });
  }
  return route.abort();
}

// Set E2E_SCREENSHOTS=<dir> to save screenshots of key states.
async function screenshot(page, name) {
  if (process.env.E2E_SCREENSHOTS) {
    await page.setViewportSize({ width: 340, height: 980 });
    await page.screenshot({ path: join(process.env.E2E_SCREENSHOTS, `${name}.png`), fullPage: true });
  }
}

async function badge() {
  return worker.evaluate(async () => ({
    text: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({})
  }));
}

async function openPopup(page, { refresh = true } = {}) {
  await page.goto(`${extensionUrl}/popup.html`);
  if (refresh) {
    await page.click("#refresh");
  }
  await page.waitForFunction(() => /^Checked|^Refresh failed/.test(document.getElementById("status").textContent));
}

async function setSettings(settings) {
  await worker.evaluate((value) => chrome.storage.sync.set({ settings: value }), settings);
}

before(async () => {
  // A copy of the extension with access to guarded.test already granted, so
  // the protected-site redirect works without a permission prompt.
  extensionDir = mkdtempSync(join(tmpdir(), "browserip-e2e-"));
  cpSync(root, extensionDir, {
    recursive: true,
    filter: (source) => !/[/\\](node_modules|\.git|test|e2e|dist)$/.test(source)
  });
  const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
  manifest.host_permissions.push("*://guarded.test/*", "*://*.guarded.test/*");
  // Optional in production; granted up front here to skip the prompt.
  manifest.permissions.push("nativeMessaging");
  writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest));

  // The real helper, driving the fake Mullvad CLI.
  workDir = mkdtempSync(join(tmpdir(), "browserip-e2e-work-"));
  const userDataDir = join(workDir, "profile");
  const fakeCli = join(workDir, "mullvad");
  writeFileSync(fakeCli, FAKE_MULLVAD);
  chmodSync(fakeCli, 0o755);
  if (goAvailable) {
    execFileSync("go", ["build", "-o", join(workDir, "browserip-helper"), "."], { cwd: join(root, "helper") });
    helperBuilt = true;
  }

  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    env: { ...process.env, BROWSERIP_MULLVAD_CLI: fakeCli, FAKE_MULLVAD_STATE: join(workDir, "mullvad-state") }
  });
  await context.route(
    /^https?:\/\/[^/]*(ipify\.org|ipapi\.is|proxycheck\.io|bash\.ws|mullvad\.net|\.test)\//,
    mockNetwork
  );
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  extensionUrl = `chrome-extension://${new URL(worker.url()).host}`;

  // Chromium reads native host manifests from the profile on Linux when it
  // connects, so this can be written once the extension ID is known.
  if (helperBuilt) {
    const hostsDir = join(userDataDir, "NativeMessagingHosts");
    mkdirSync(hostsDir, { recursive: true });
    writeFileSync(
      join(hostsDir, "io.github.hurr1star.browserip.json"),
      JSON.stringify({
        name: "io.github.hurr1star.browserip",
        description: "BrowserIP helper (e2e)",
        path: join(workDir, "browserip-helper"),
        type: "stdio",
        allowed_origins: [`${extensionUrl}/`]
      })
    );
  }
});

after(async () => {
  await context?.close();
  rmSync(extensionDir, { recursive: true, force: true });
  if (workDir && existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("popup: VPN detected", async () => {
  scenario = "vpn";
  const page = await context.newPage();
  await openPopup(page);
  assert.equal(await page.textContent("#vpnStatus"), "Detected");
  assert.equal(await page.textContent("#vpnDetail"), "VPN (Mullvad VPN)");
  assert.equal(await page.isHidden("#vpnWarning"), true);
  assert.equal((await badge()).text, "SE");
  await page.close();
});

test("popup: IPv6 leak", async () => {
  scenario = "leak";
  const page = await context.newPage();
  await openPopup(page);
  assert.equal(await page.textContent("#vpnWarning"), "Leak: IPv6 not tunnelled");
  assert.match(await page.textContent("#ipv6"), /2001:db8::7.*direct/);
  assert.equal((await badge()).text, "LEAK");
  await page.close();
});

test("popup: no VPN while one is expected", async () => {
  scenario = "direct";
  const page = await context.newPage();
  await openPopup(page);
  assert.equal(await page.textContent("#vpnWarning"), "Warning: VPN not detected");
  assert.equal((await badge()).text, "OFF");
  await page.close();
});

test("popup: a failed refresh keeps the last data", async () => {
  scenario = "offline";
  const page = await context.newPage();
  await openPopup(page);
  assert.match(await page.textContent("#status"), /^Refresh failed: .*Showing data from/);
  assert.equal(await page.textContent("#ip"), HOME_IP);
  assert.equal((await badge()).text, "?");
  await page.close();
});

test("settings: an unexpected exit country raises an alert", async () => {
  scenario = "vpn";
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/options.html`);
  await page.selectOption("#expectedCountry", "DE");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved.");
  await openPopup(page);
  assert.equal(await page.textContent("#vpnWarning"), "Exit country is Sweden, expected Germany");
  assert.equal((await badge()).text, "!SE");
  await setSettings({});
  await page.close();
});

test("protected site: held back without the VPN, continues once it is back", async () => {
  scenario = "direct";
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/options.html`);
  await page.fill("#siteInput", "https://www.guarded.test/login");
  await page.click("#addSite button");
  await page.waitForFunction(() => document.getElementById("siteList").textContent.includes("guarded.test"));
  assert.match(await page.textContent("#siteList"), /Shows an explanation page/);
  await openPopup(page);

  await page.goto("http://app.guarded.test/inbox?x=1");
  assert.equal(page.url(), `${extensionUrl}/blocked.html#http://app.guarded.test/inbox?x=1`);
  await page.waitForFunction(() => document.getElementById("reason").textContent.length > 0);
  assert.equal(await page.textContent("#blockedHost"), "app.guarded.test");
  assert.equal(await page.textContent("#reason"), "Warning: VPN not detected");

  // Unprotected sites are untouched.
  await page.goto("http://free.test/");
  assert.equal(await page.textContent("#site"), "http://free.test/");

  await page.goto("http://app.guarded.test/inbox?x=1");
  scenario = "vpn";
  await page.click("#recheck");
  await page.waitForURL("http://app.guarded.test/inbox?x=1");
  assert.equal(await page.textContent("#site"), "http://app.guarded.test/inbox?x=1");
  await setSettings({});
  await page.close();
});

test("settings changes during checks never break the protected-site rules", async () => {
  scenario = "direct";
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/history.html`);
  // Rule updates from a settings change and from a check used to interleave
  // and add duplicate rule IDs, failing the check.
  const errors = await page.evaluate(async () => {
    const failures = [];
    for (let i = 0; i < 20; i += 1) {
      const guardSites = i % 2 ? ["a.test", "b.test"] : ["a.test", "b.test", "c.test"];
      const [response] = await Promise.all([
        chrome.runtime.sendMessage({ type: "refresh", force: false }),
        chrome.storage.sync.set({ settings: { guardSites } })
      ]);
      if (response?.error) {
        failures.push(response.error);
      }
    }
    return failures;
  });
  assert.deepEqual(errors, []);
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.equal(rules.length, 2);
  await setSettings({});
  await page.close();
});

test("history records VPN changes", async () => {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/history.html`);
  await page.waitForSelector("#rows tr");
  const events = await page.$$eval("#rows td.event", (cells) => cells.map((cell) => cell.textContent));
  for (const expected of ["First check", "VPN leak detected", "VPN disconnected", "Check failed", "VPN connected"]) {
    assert.ok(events.includes(expected), `missing "${expected}" in ${events.join(", ")}`);
  }
  await page.close();
});

test("lookup page classifies an arbitrary address", async () => {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/lookup.html?q=${encodeURIComponent(`peer ${VPN_IP}:51820`)}`);
  await page.waitForSelector("#lookupResult .details");
  const text = await page.textContent("#lookupResult");
  assert.match(text, /185\.65\.135\.10/);
  assert.match(text, /tunnelled/);
  assert.match(text, /Stockholm/);
  await page.close();
});

test("popup tools: DNS leak test and inline lookup", async () => {
  scenario = "vpn";
  const page = await context.newPage();
  await openPopup(page);
  await page.click("#tools summary");
  await page.click("#dnsTest");
  await page.waitForFunction(() => !document.getElementById("dnsTest").disabled);
  assert.match(await page.textContent("#dnsResult"), /^OK: no DNS leak detected\. DNS servers: 193\.138\.218\.74/);

  await page.fill("#lookupInput", HOME_IP);
  await page.click("#lookupForm button");
  await page.waitForSelector("#lookupResult .details");
  assert.match(await page.textContent("#lookupResult"), /Denver/);
  await page.close();
});

test("settings: the helper test reaches the Mullvad CLI", { skip: !goAvailable && "needs Go" }, async () => {
  const page = await context.newPage();
  await page.goto(`${extensionUrl}/options.html`);
  await page.selectOption('select[name="vpnProvider"]', "mullvad");
  await page.waitForSelector("#helperSetup:not([hidden])");
  assert.match(await page.textContent("#helperCommandUnix"), /^\.\/install\.sh --extension-id [a-p]{32}$/);
  await page.click("#helperTest");
  await page.waitForFunction(() => /works|Mullvad:/.test(document.getElementById("helperStatus").textContent));
  assert.equal(await page.textContent("#helperStatus"), "Helper 1.0.0 works. Mullvad: 2025.9");
  await page.close();
});

test("popup: connect, switch country and disconnect Mullvad", { skip: !goAvailable && "needs Go" }, async () => {
  scenario = "mullvadApp";
  await setSettings({ vpnProvider: "mullvad" });
  const page = await context.newPage();
  await openPopup(page);
  await page.waitForFunction(() => document.getElementById("mullvadState").textContent === "Disconnected");
  assert.equal(await page.textContent("#vpnWarning"), "Warning: VPN not detected");
  assert.equal(await page.textContent("#mullvadToggle"), "Connect");

  await page.click("#mullvadToggle");
  await page.waitForFunction(() => document.getElementById("vpnStatus").textContent === "Detected", null, {
    timeout: 30000
  });
  assert.equal(await page.textContent("#mullvadState"), "Connected · se-got-wg-001 · Sweden, Gothenburg");
  assert.equal(await page.textContent("#vpnDetail"), "Mullvad (se-got-wg-001, WireGuard)");
  assert.equal(await page.isHidden("#vpnWarning"), true);
  assert.equal(await page.textContent("#reputation"), "On blocklists (Spamhaus); expect CAPTCHAs");
  await screenshot(page, "popup-mullvad-connected");

  const countries = await page.$$eval("#mullvadCountry option", (options) => options.map((option) => option.value));
  assert.deepEqual(countries, ["", "de", "se"]);
  await page.selectOption("#mullvadCountry", "de");
  await page.waitForFunction(
    () => document.getElementById("vpnDetail").textContent === "Mullvad (de-fra-wg-001, WireGuard)",
    null,
    { timeout: 30000 }
  );
  assert.equal(await page.textContent("#mullvadState"), "Connected · de-fra-wg-001 · Germany, Frankfurt");

  await page.click("#mullvadToggle");
  await page.waitForFunction(() => document.getElementById("vpnStatus").textContent === "Not detected", null, {
    timeout: 30000
  });
  assert.equal(await page.textContent("#mullvadState"), "Disconnected");
  await setSettings({});
  await page.close();
});

test("protected site: Connect Mullvad on the blocked page", { skip: !goAvailable && "needs Go" }, async () => {
  scenario = "mullvadApp";
  await setSettings({ vpnProvider: "mullvad", guardSites: ["guarded.test"] });
  const page = await context.newPage();
  await openPopup(page);
  await page.goto("http://guarded.test/account");
  await page.waitForSelector("#connectMullvad:not([hidden])");
  await page.click("#connectMullvad");
  await page.waitForURL("http://guarded.test/account", { timeout: 30000 });
  assert.equal(await page.textContent("#site"), "http://guarded.test/account");
  writeFileSync(join(workDir, "mullvad-state"), "disconnected\n");
  await setSettings({});
  await page.close();
});
