import { localizePage, t } from "./lib/i18n.js";
import { findIpAddress, isIpAddress } from "./lib/ip.js";
import { renderLookup } from "./lib/lookup-view.js";
import { applyTheme, loadSettings } from "./lib/settings.js";

const input = document.getElementById("lookupInput");
const statusEl = document.getElementById("lookupStatus");
const resultEl = document.getElementById("lookupResult");

async function lookup(value) {
  const ip = isIpAddress(value) ? value : findIpAddress(value);
  resultEl.replaceChildren();
  if (!ip) {
    statusEl.textContent = t("lookupInvalid");
    return;
  }
  input.value = ip;
  statusEl.textContent = t("lookupRunning");
  try {
    const response = await chrome.runtime.sendMessage({ type: "lookup", ip });
    if (response?.address) {
      statusEl.textContent = "";
      renderLookup(resultEl, response.address);
    } else {
      statusEl.textContent = t("lookupFailed", response?.error ?? "?");
    }
  } catch (error) {
    statusEl.textContent = t("lookupFailed", error.message);
  }
}

document.getElementById("lookupForm").addEventListener("submit", (event) => {
  event.preventDefault();
  lookup(input.value.trim());
});

localizePage();
loadSettings().then(applyTheme);
// Opened from the context menu with ?ip=... (or ?q=... when the selection
// held no address).
const params = new URLSearchParams(location.search);
const initial = params.get("ip") ?? params.get("q");
if (initial !== null) {
  input.value = initial;
  lookup(initial.trim());
}
