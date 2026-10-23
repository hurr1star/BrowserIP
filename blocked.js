import { blockedTarget } from "./lib/guard.js";
import { localizePage, t } from "./lib/i18n.js";
import { deriveIndicator } from "./lib/indicator.js";
import { applyTheme, loadSettings } from "./lib/settings.js";

const target = blockedTarget(location.hash);
const statusEl = document.getElementById("status");
const recheckButton = document.getElementById("recheck");

// Continues to the original page once the VPN is confirmed; otherwise shows
// why the page is still held back.
async function evaluate(state) {
  const settings = await loadSettings();
  applyTheme(settings);
  const indicator = deriveIndicator(state, settings, Date.now());
  if (indicator.safe && target) {
    statusEl.textContent = t("blockedContinuing");
    location.replace(target.href);
    return;
  }
  let reason = indicator.warning;
  if (!reason) {
    reason = indicator.stale ? t("blockedStale") : indicator.detail ? `${indicator.vpnLabel}: ${indicator.detail}` : indicator.vpnLabel;
  }
  document.getElementById("reason").textContent = reason;
}

async function recheck() {
  recheckButton.disabled = true;
  statusEl.textContent = t("statusFetching");
  try {
    const response = await chrome.runtime.sendMessage({ type: "refresh", force: true });
    statusEl.textContent = response?.error ? t("statusLoadFailed", response.error) : "";
    await evaluate(response?.state ?? null);
  } finally {
    recheckButton.disabled = false;
  }
}

localizePage();
document.getElementById("blockedHost").textContent = target?.hostname ?? "";
recheckButton.addEventListener("click", recheck);
document.getElementById("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.state) {
    evaluate(changes.state.newValue ?? null);
  }
});
chrome.storage.local.get("state").then(({ state }) => evaluate(state ?? null));
