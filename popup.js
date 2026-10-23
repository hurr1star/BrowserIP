import { formatAge, formatAsn, formatLocation, formatTime } from "./lib/format.js";
import { deriveIndicator } from "./lib/indicator.js";
import { DEFAULT_SETTINGS, loadSettings } from "./lib/settings.js";
import { analyzeCandidates, gatherCandidates } from "./lib/webrtc.js";

const ipEl = document.getElementById("ip");
const statusEl = document.getElementById("status");
const refreshButton = document.getElementById("refresh");
const webrtcButton = document.getElementById("webrtcTest");
const webrtcResultEl = document.getElementById("webrtcResult");
const vpnStatusEl = document.getElementById("vpnStatus");
const vpnDetailEl = document.getElementById("vpnDetail");
const vpnWarningEl = document.getElementById("vpnWarning");
const fields = {
  location: document.getElementById("location"),
  country: document.getElementById("country"),
  provider: document.getElementById("provider"),
  asn: document.getElementById("asn"),
  timezone: document.getElementById("timezone"),
  source: document.getElementById("source")
};
const familyRows = {
  IPv4: { row: document.getElementById("ipv4Row"), value: document.getElementById("ipv4") },
  IPv6: { row: document.getElementById("ipv6Row"), value: document.getElementById("ipv6") }
};

let currentState = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let refreshing = false;
let flashTimer = null;

function addressTag(address) {
  if (address.error) {
    return { text: "lookup failed", className: "tag-bad" };
  }
  if (address.tunnelled === true) {
    return { text: "✓ tunnelled", className: "tag-ok" };
  }
  if (address.tunnelled === false) {
    return { text: "✕ direct", className: currentSettings.expectVpn ? "tag-bad" : "" };
  }
  return { text: "? unknown", className: "" };
}

function renderFamilies(addresses) {
  // Per-family rows only add information when both families are present.
  const showRows = addresses.length > 1;
  for (const [family, { row, value }] of Object.entries(familyRows)) {
    const address = addresses.find((candidate) => candidate.family === family);
    row.hidden = !showRows || !address;
    value.replaceChildren();
    if (!row.hidden) {
      const tag = addressTag(address);
      const tagEl = document.createElement("span");
      tagEl.className = `sub ${tag.className}`;
      tagEl.textContent = tag.text;
      value.append(address.ip, tagEl);
    }
  }
}

function statusText(state, indicator) {
  if (refreshing) {
    return "Fetching network details...";
  }
  if (!state?.checkedAt) {
    return state?.error ? `Could not load IP: ${state.error}` : "";
  }
  const when = `${formatTime(state.checkedAt)} (${formatAge(Date.now() - state.checkedAt)})`;
  if (!state.ok) {
    return `Refresh failed: ${state.error}. Showing data from ${when}.`;
  }
  return indicator.stale ? `Out of date: last checked ${when}.` : `Checked ${when}.`;
}

function render() {
  const state = currentState;
  const indicator = deriveIndicator(state, currentSettings, Date.now());
  const addresses = state?.addresses ?? [];
  const primary = addresses[0];
  const info = primary?.info;
  const placeholder = state ? "Unavailable" : "Loading...";

  vpnWarningEl.hidden = !indicator.warning;
  vpnWarningEl.textContent = indicator.warning ?? "";

  ipEl.textContent = primary?.ip ?? placeholder;
  ipEl.disabled = !primary;

  vpnStatusEl.textContent = indicator.vpnLabel;
  vpnDetailEl.hidden = !indicator.detail;
  vpnDetailEl.textContent = indicator.detail ?? "";
  renderFamilies(addresses);

  fields.location.textContent = formatLocation(info) ?? placeholder;
  fields.country.textContent = info?.country ?? placeholder;
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

async function copyIp() {
  const ip = currentState?.addresses?.[0]?.ip;
  if (!ip) {
    return;
  }
  try {
    await navigator.clipboard.writeText(ip);
    flashStatus(`Copied ${ip} to the clipboard.`);
  } catch (_error) {
    flashStatus("Could not copy to the clipboard.");
  }
}

async function runWebRtcTest() {
  webrtcButton.disabled = true;
  webrtcResultEl.hidden = false;
  webrtcResultEl.classList.remove("is-leak");
  webrtcResultEl.textContent = "Asking STUN servers which address WebRTC exposes...";

  try {
    const knownIps = (currentState?.addresses ?? []).map((address) => address.ip);
    const result = analyzeCandidates(await gatherCandidates(), knownIps);
    const lines = [];
    if (result.leaked.length) {
      webrtcResultEl.classList.add("is-leak");
      lines.push(`LEAK: WebRTC exposes ${result.leaked.join(", ")}, which is not your browser IP.`);
    } else if (result.publicIps.length) {
      lines.push(`OK: WebRTC only exposes your browser IP (${result.publicIps.join(", ")}).`);
    } else {
      lines.push("OK: WebRTC exposed no public address.");
    }
    if (result.localIps.length) {
      lines.push(`Local address visible to sites: ${result.localIps.join(", ")}.`);
    }
    webrtcResultEl.textContent = lines.join(" ");
  } catch (error) {
    webrtcResultEl.textContent = `WebRTC test failed: ${error.message}`;
  } finally {
    webrtcButton.disabled = false;
  }
}

async function init() {
  const [{ state }, settings] = await Promise.all([chrome.storage.local.get("state"), loadSettings()]);
  currentState = state ?? null;
  currentSettings = settings;
  render();
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
      render();
    });
  }
});

refreshButton.addEventListener("click", () => refresh(true));
ipEl.addEventListener("click", copyIp);
webrtcButton.addEventListener("click", runWebRtcTest);
document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
// Keep "2m ago" and staleness current while the popup stays open.
setInterval(render, 30000);

init();
