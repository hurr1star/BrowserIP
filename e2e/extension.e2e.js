// End-to-end tests: loads the extension into Chromium with every network
// service mocked, then drives the popup, settings, protected sites, history
// and lookup pages. Run with `npm run test:e2e`.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

async function mockNetwork(route) {
  const url = new URL(route.request().url());
  const current = SCENARIOS[scenario];
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
  writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest));

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
  });
  await context.route(/^https?:\/\/[^/]*(ipify\.org|ipapi\.is|proxycheck\.io|bash\.ws|\.test)\//, mockNetwork);
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  extensionUrl = `chrome-extension://${new URL(worker.url()).host}`;
});

after(async () => {
  await context?.close();
  rmSync(extensionDir, { recursive: true, force: true });
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
