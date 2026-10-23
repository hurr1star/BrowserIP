import { lookupAddress, runCheck } from "./lib/check.js";
import { buildGuardRules, siteOrigins } from "./lib/guard.js";
import { appendHistory, historyEntry } from "./lib/history.js";
import { t } from "./lib/i18n.js";
import { deriveIndicator, describeChange, staleAfterMs } from "./lib/indicator.js";
import { findIpAddress, isIpAddress } from "./lib/ip.js";
import { loadApiKeys, loadSettings } from "./lib/settings.js";

const POLL_ALARM = "poll";
const STALE_ALARM = "stale";
const NOTIFICATION_ID = "browserip-change";
const LOOKUP_MENU_ID = "lookup-ip";

let inFlight = null;

function iconSet(color) {
  return {
    16: `icons/icon-${color}-16.png`,
    32: `icons/icon-${color}-32.png`,
    48: `icons/icon-${color}-48.png`,
    128: `icons/icon-${color}-128.png`
  };
}

async function readState() {
  const { state } = await chrome.storage.local.get("state");
  return state ?? null;
}

async function updateGuard(indicator, settings) {
  const active = settings.guardSites.length > 0 && !indicator.safe;
  let addRules = [];
  if (active) {
    const granted = await Promise.all(
      settings.guardSites.map((domain) => chrome.permissions.contains({ origins: siteOrigins(domain) }))
    );
    addRules = buildGuardRules(
      settings.guardSites,
      settings.guardSites.filter((_domain, index) => granted[index]),
      chrome.runtime.getURL("blocked.html")
    );
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules
  });
}

// Brings the toolbar icon and the protected-site rules in line with `state`.
async function applyState(state, settings) {
  const indicator = deriveIndicator(state, settings, Date.now());
  await Promise.all([
    chrome.action.setIcon({ path: iconSet(indicator.color) }),
    chrome.action.setBadgeText({ text: indicator.badgeText }),
    chrome.action.setBadgeBackgroundColor({ color: indicator.badgeColor }),
    chrome.action.setBadgeTextColor?.({ color: "#ffffff" }),
    chrome.action.setTitle({ title: indicator.title }),
    updateGuard(indicator, settings)
  ]);
  return indicator;
}

async function schedulePolling(settings) {
  await chrome.alarms.clear(POLL_ALARM);
  if (settings.pollMinutes > 0) {
    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: settings.pollMinutes });
  }
}

// Greys the icon out (and re-arms protected sites) once the last result is
// too old to trust, even if no further check runs.
async function scheduleStaleAlarm(state, settings) {
  if (state?.checkedAt) {
    await chrome.alarms.create(STALE_ALARM, { when: state.checkedAt + staleAfterMs(settings) + 1000 });
  }
}

async function notify(change, indicator) {
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL(`icons/icon-${indicator.color}-128.png`),
      title: change.title,
      message: change.message
    });
  } catch (_error) {
    // Notifications can be blocked at the OS level; the icon still updates.
  }
}

async function recordHistory(previous, state, change) {
  const entry = historyEntry(previous, state, change, Date.now());
  if (entry) {
    const { history } = await chrome.storage.local.get("history");
    await chrome.storage.local.set({ history: appendHistory(history, entry) });
  }
}

function check({ force = false, notifyChange = true } = {}) {
  if (!inFlight) {
    inFlight = (async () => {
      const [previous, settings, keys] = await Promise.all([readState(), loadSettings(), loadApiKeys()]);
      const state = await runCheck({ previous, settings, keys, force });
      // Update the protected-site rules before publishing the state: the
      // blocked page continues as soon as the stored state turns safe.
      const indicator = await applyState(state, settings);
      await chrome.storage.local.set({ state });
      await scheduleStaleAlarm(state, settings);
      const change = describeChange(previous, state, settings);
      await recordHistory(previous, state, change);
      if (change && notifyChange && settings.notifyOnChange) {
        await notify(change, indicator);
      }
      return state;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function initialize() {
  const settings = await loadSettings();
  await schedulePolling(settings);
  // The last result predates this browser session; never show it as current.
  await applyState(null, settings);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: LOOKUP_MENU_ID, title: t("contextLookup"), contexts: ["selection"] });
  });
  chrome.idle.setDetectionInterval(60);
  await check({ notifyChange: false });
}

async function reapply() {
  const [state, settings] = await Promise.all([readState(), loadSettings()]);
  await applyState(state, settings);
  return { state, settings };
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await check();
  } else if (alarm.name === STALE_ALARM) {
    await reapply();
  }
});

// Waking from sleep or unlocking is when VPNs most often turn out to have
// dropped, so check right away instead of waiting for the next alarm.
chrome.idle.onStateChanged.addListener((newState) => {
  if (newState === "active") {
    check();
  }
});
self.addEventListener("online", () => check());

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.settings) {
    const { state, settings } = await reapply();
    await schedulePolling(settings);
    await scheduleStaleAlarm(state, settings);
  }
});

// Granting or revoking a protected site's permission switches its rule
// between redirect and block.
chrome.permissions.onAdded.addListener(reapply);
chrome.permissions.onRemoved.addListener(reapply);

chrome.commands.onCommand.addListener((command) => {
  if (command === "refresh") {
    check({ force: true });
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== LOOKUP_MENU_ID) {
    return;
  }
  const ip = findIpAddress(info.selectionText);
  const url = new URL(chrome.runtime.getURL("lookup.html"));
  url.searchParams.set(ip ? "ip" : "q", ip ?? info.selectionText ?? "");
  chrome.windows.create({ url: url.href, type: "popup", width: 400, height: 640 });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh") {
    // The page asking is already showing the result, so don't also notify.
    check({ force: Boolean(message.force), notifyChange: false }).then(
      (state) => sendResponse({ state }),
      (error) => sendResponse({ error: error.message })
    );
    return true;
  }
  if (message?.type === "lookup") {
    if (!isIpAddress(message.ip)) {
      sendResponse({ error: t("lookupInvalid") });
      return false;
    }
    Promise.all([loadSettings(), loadApiKeys()])
      .then(([settings, keys]) => lookupAddress(message.ip, { settings, keys }))
      .then(
        (address) => sendResponse({ address }),
        (error) => sendResponse({ error: error.message })
      );
    return true;
  }
  return false;
});
