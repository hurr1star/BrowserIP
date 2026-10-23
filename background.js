import { runCheck } from "./lib/check.js";
import { deriveIndicator, describeChange, staleAfterMs } from "./lib/indicator.js";
import { loadSettings } from "./lib/settings.js";

const POLL_ALARM = "poll";
const STALE_ALARM = "stale";
const NOTIFICATION_ID = "browserip-change";

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

async function applyIndicator(state, settings) {
  const indicator = deriveIndicator(state, settings, Date.now());
  await Promise.all([
    chrome.action.setIcon({ path: iconSet(indicator.color) }),
    chrome.action.setBadgeText({ text: indicator.badgeText }),
    chrome.action.setBadgeBackgroundColor({ color: indicator.badgeColor }),
    chrome.action.setBadgeTextColor?.({ color: "#ffffff" }),
    chrome.action.setTitle({ title: indicator.title })
  ]);
}

async function schedulePolling(settings) {
  await chrome.alarms.clear(POLL_ALARM);
  if (settings.pollMinutes > 0) {
    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: settings.pollMinutes });
  }
}

// Greys the icon out once the last result is too old to trust, even if no
// further check runs (background checks off, or the browser is offline).
async function scheduleStaleAlarm(state, settings) {
  if (state?.checkedAt) {
    await chrome.alarms.create(STALE_ALARM, { when: state.checkedAt + staleAfterMs(settings) + 1000 });
  }
}

async function notifyChange(previous, state, settings) {
  const change = describeChange(previous, state);
  if (!change) {
    return;
  }
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: "basic",
      iconUrl: chrome.runtime.getURL(`icons/icon-${deriveIndicator(state, settings, Date.now()).color}-128.png`),
      title: change.title,
      message: change.message
    });
  } catch (_error) {
    // Notifications can be blocked at the OS level; the icon still updates.
  }
}

function check({ force = false, notify = true } = {}) {
  if (!inFlight) {
    inFlight = (async () => {
      const [previous, settings] = await Promise.all([readState(), loadSettings()]);
      const state = await runCheck({ previous, settings, force });
      await chrome.storage.local.set({ state });
      await applyIndicator(state, settings);
      await scheduleStaleAlarm(state, settings);
      if (notify && settings.notifyOnChange) {
        await notifyChange(previous, state, settings);
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
  await applyIndicator(null, settings);
  await check({ notify: false });
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await check();
  } else if (alarm.name === STALE_ALARM) {
    await applyIndicator(await readState(), await loadSettings());
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && changes.settings) {
    const settings = await loadSettings();
    await schedulePolling(settings);
    const state = await readState();
    await applyIndicator(state, settings);
    await scheduleStaleAlarm(state, settings);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "refresh") {
    return false;
  }
  // The popup is already showing the result, so don't also notify.
  check({ force: Boolean(message.force), notify: false }).then(
    (state) => sendResponse({ state }),
    (error) => sendResponse({ error: error.message })
  );
  return true;
});
