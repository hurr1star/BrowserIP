import { addressStatus, formatAge, formatAsn, formatCountry, formatLocation, formatTime } from "./lib/format.js";
import { localizePage, t } from "./lib/i18n.js";
import { deriveIndicator } from "./lib/indicator.js";
import { isIpAddress } from "./lib/ip.js";
import { renderLookup } from "./lib/lookup-view.js";
import { describeProxySettings } from "./lib/proxyinfo.js";
import { buildReport } from "./lib/report.js";
import { DEFAULT_SETTINGS, applyTheme, loadSettings } from "./lib/settings.js";
import { runDnsLeakTest } from "./lib/dnsleak.js";
import { analyzeCandidates, gatherCandidates } from "./lib/webrtc.js";

const $ = (id) => document.getElementById(id);
const ipEl = $("ip");
const statusEl = $("status");
const refreshButton = $("refresh");
const fields = {
  location: $("location"),
  country: $("country"),
  provider: $("provider"),
  asn: $("asn"),
  timezone: $("timezone"),
  source: $("source")
};
const familyRows = {
  IPv4: { row: $("ipv4Row"), value: $("ipv4") },
  IPv6: { row: $("ipv6Row"), value: $("ipv6") }
};

let currentState = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let refreshing = false;
let flashTimer = null;
// Latest results, kept for the copied report.
const extras = { proxy: null, webrtc: null, dns: null };

function renderFamilies(addresses) {
  // Per-family rows only add information when both families are present.
  const showRows = addresses.length > 1;
  for (const [family, { row, value }] of Object.entries(familyRows)) {
    const address = addresses.find((candidate) => candidate.family === family);
    row.hidden = !showRows || !address;
    value.replaceChildren();
    if (!row.hidden) {
      const tagEl = document.createElement("span");
      const bad = address.error || (address.tunnelled === false && currentSettings.expectVpn);
      tagEl.className = `sub ${address.tunnelled === true ? "tag-ok" : bad ? "tag-bad" : ""}`;
      tagEl.textContent = addressStatus(address);
      value.append(address.ip, tagEl);
    }
  }
}

function statusText(state, indicator) {
  if (refreshing) {
    return t("statusFetching");
  }
  if (!state?.checkedAt) {
    return state?.error ? t("statusLoadFailed", state.error) : "";
  }
  const when = t("timeWithAge", formatTime(state.checkedAt), formatAge(Date.now() - state.checkedAt));
  if (!state.ok) {
    return t("statusRefreshFailed", state.error, when);
  }
  return indicator.stale ? t("statusOutOfDate", when) : t("statusChecked", when);
}

function render() {
  const state = currentState;
  const indicator = deriveIndicator(state, currentSettings, Date.now());
  const addresses = state?.addresses ?? [];
  const primary = addresses[0];
  const info = primary?.info;
  const placeholder = state ? t("unavailable") : t("loading");

  $("vpnWarning").hidden = !indicator.warning;
  $("vpnWarning").textContent = indicator.warning ?? "";

  ipEl.textContent = primary?.ip ?? placeholder;
  ipEl.disabled = !primary;

  $("vpnStatus").textContent = indicator.vpnLabel;
  $("vpnDetail").hidden = !indicator.detail;
  $("vpnDetail").textContent = indicator.detail ?? "";
  renderFamilies(addresses);

  fields.location.textContent = formatLocation(info) ?? placeholder;
  fields.country.textContent = formatCountry(info) ?? placeholder;
  fields.provider.textContent = info?.isp ?? placeholder;
  fields.asn.textContent = formatAsn(info) ?? placeholder;
  fields.timezone.textContent = info?.timezone ?? placeholder;
  fields.source.textContent = info?.provider ?? placeholder;

  if (!flashTimer) {
    statusEl.textContent = statusText(state, indicator);
    statusEl.classList.toggle("is-stale", Boolean(state && indicator.stale && !refreshing));
  }
  refreshButton.disabled = refreshing;
}

function flashStatus(message) {
  clearTimeout(flashTimer);
  statusEl.textContent = message;
  statusEl.classList.remove("is-stale");
  flashTimer = setTimeout(() => {
    flashTimer = null;
    render();
  }, 1500);
}

async function refresh(force) {
  refreshing = true;
  render();
  try {
    const response = await chrome.runtime.sendMessage({ type: "refresh", force });
    if (response?.state) {
      currentState = response.state;
    } else if (response?.error) {
      currentState = { ...(currentState ?? { addresses: [] }), ok: false, error: response.error };
    }
  } catch (error) {
    currentState = { ...(currentState ?? { addresses: [] }), ok: false, error: error.message };
  } finally {
    refreshing = false;
    render();
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    flashStatus(message);
  } catch (_error) {
    flashStatus(t("copyFailed"));
  }
}

async function loadProxy() {
  try {
    if (!(await chrome.permissions.contains({ permissions: ["proxy"] }))) {
      return;
    }
    extras.proxy = describeProxySettings(await chrome.proxy.settings.get({}));
    $("proxy").textContent = extras.proxy;
    $("proxyRow").hidden = false;
  } catch (_error) {
    // Proxy details are optional extras.
  }
}

async function runWebRtcTest() {
  const button = $("webrtcTest");
  const resultEl = $("webrtcResult");
  button.disabled = true;
  resultEl.hidden = false;
  resultEl.classList.remove("is-leak");
  resultEl.textContent = t("webrtcRunning");

  try {
    const knownIps = (currentState?.addresses ?? []).map((address) => address.ip);
    const result = analyzeCandidates(await gatherCandidates(), knownIps);
    const lines = [];
    if (result.leaked.length) {
      resultEl.classList.add("is-leak");
      lines.push(t("webrtcLeak", result.leaked.join(", ")));
    } else if (result.publicIps.length) {
      lines.push(t("webrtcOk", result.publicIps.join(", ")));
    } else {
      lines.push(t("webrtcNone"));
    }
    if (result.localIps.length) {
      lines.push(t("webrtcLocal", result.localIps.join(", ")));
    }
    resultEl.textContent = lines.join(" ");
  } catch (error) {
    resultEl.textContent = t("webrtcFailed", error.message);
  } finally {
    extras.webrtc = resultEl.textContent;
    button.disabled = false;
  }
}

async function runDnsTest() {
  const button = $("dnsTest");
  const resultEl = $("dnsResult");
  button.disabled = true;
  resultEl.hidden = false;
  resultEl.classList.remove("is-leak");
  resultEl.textContent = t("dnsRunning");

  try {
    const result = await runDnsLeakTest();
    const servers = result.servers
      .map((server) => [server.ip, [server.country, server.asn].filter(Boolean).join(", ")].filter(Boolean).join(" — "))
      .join("; ");
    resultEl.classList.toggle("is-leak", result.leaking === true);
    const verdict =
      result.leaking === true ? t("dnsLeak") : result.leaking === false ? t("dnsOk") : t("dnsUnclear");
    resultEl.textContent = servers ? `${verdict} ${t("dnsServers", servers)}` : `${verdict} ${t("dnsNoServers")}`;
  } catch (error) {
    resultEl.textContent = t("dnsFailed", error.message);
  } finally {
    extras.dns = resultEl.textContent;
    button.disabled = false;
  }
}

async function lookup(event) {
  event.preventDefault();
  const ip = $("lookupInput").value.trim();
  const resultEl = $("lookupResult");
  if (!isIpAddress(ip)) {
    resultEl.textContent = t("lookupInvalid");
    return;
  }
  resultEl.textContent = t("lookupRunning");
  try {
    const response = await chrome.runtime.sendMessage({ type: "lookup", ip });
    if (response?.address) {
      renderLookup(resultEl, response.address);
    } else {
      resultEl.textContent = t("lookupFailed", response?.error ?? "?");
    }
  } catch (error) {
    resultEl.textContent = t("lookupFailed", error.message);
  }
}

async function init() {
  localizePage();
  const [{ state }, settings] = await Promise.all([chrome.storage.local.get("state"), loadSettings()]);
  currentState = state ?? null;
  currentSettings = settings;
  applyTheme(settings);
  render();
  loadProxy();
  // Opening the popup re-checks; unchanged addresses reuse the cached lookup.
  await refresh(false);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.state && !refreshing) {
    currentState = changes.state.newValue ?? null;
    render();
  } else if (area === "sync" && changes.settings) {
    loadSettings().then((settings) => {
      currentSettings = settings;
      applyTheme(settings);
      render();
    });
  }
});

refreshButton.addEventListener("click", () => refresh(true));
ipEl.addEventListener("click", () => {
  const ip = currentState?.addresses?.[0]?.ip;
  if (ip) {
    copyText(ip, t("copiedIp", ip));
  }
});
$("copyReport").addEventListener("click", () =>
  copyText(
    buildReport({ state: currentState, settings: currentSettings, now: Date.now(), ...extras }),
    t("copiedReport")
  )
);
$("webrtcTest").addEventListener("click", runWebRtcTest);
$("dnsTest").addEventListener("click", runDnsTest);
$("lookupForm").addEventListener("submit", lookup);
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openHistory").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));
// Keep "2 min. ago" and staleness current while the popup stays open.
setInterval(render, 30000);

init();
