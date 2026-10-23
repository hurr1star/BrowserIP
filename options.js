import { localizePage, t, uiLanguage } from "./lib/i18n.js";
import { siteOrigins } from "./lib/guard.js";
import { HELPER_RELEASES_URL, callHelper } from "./lib/mullvad.js";
import { countryName } from "./lib/providers.js";
import {
  MAX_GUARDED_SITES,
  POLL_OPTIONS,
  applyTheme,
  loadApiKeys,
  loadSettings,
  normalizeDomain,
  saveApiKeys,
  saveSettings
} from "./lib/settings.js";

const $ = (id) => document.getElementById(id);
const form = $("settings");
const keysForm = $("apiKeys");
const savedEl = $("saved");
// Region codes Intl knows that are not countries.
const NOT_COUNTRIES = new Set(["EU", "EZ", "QO", "UN", "XA", "XB", "ZZ"]);

let settings;

function fillSelects() {
  const poll = $("pollMinutes");
  for (const minutes of POLL_OPTIONS) {
    const option = new Option(minutes ? t("pollEvery", minutes) : t("pollOff"), String(minutes));
    poll.append(option);
  }

  const country = $("expectedCountry");
  country.append(new Option(t("anyCountry"), ""));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const countries = [];
  for (const first of letters) {
    for (const second of letters) {
      const code = first + second;
      const name = NOT_COUNTRIES.has(code) ? null : countryName(code, uiLanguage());
      if (name) {
        countries.push([code, name]);
      }
    }
  }
  countries.sort((a, b) => a[1].localeCompare(b[1], uiLanguage()));
  for (const [code, name] of countries) {
    country.append(new Option(`${name} (${code})`, code));
  }
}

function fillForm() {
  for (const name of ["expectVpn", "notifyOnChange", "showCountryBadge", "checkIpv6", "secondOpinion"]) {
    form.elements[name].checked = settings[name];
  }
  form.elements.pollMinutes.value = String(settings.pollMinutes);
  form.elements.expectedCountry.value = settings.expectedCountry;
  form.elements.expectedProvider.value = settings.expectedProvider;
  form.elements.theme.value = settings.theme;
  form.elements.vpnProvider.value = settings.vpnProvider;
  $("helperSetup").hidden = settings.vpnProvider !== "mullvad";
}

function readForm() {
  return {
    ...settings,
    expectVpn: form.elements.expectVpn.checked,
    notifyOnChange: form.elements.notifyOnChange.checked,
    showCountryBadge: form.elements.showCountryBadge.checked,
    checkIpv6: form.elements.checkIpv6.checked,
    secondOpinion: form.elements.secondOpinion.checked,
    pollMinutes: Number(form.elements.pollMinutes.value),
    expectedCountry: form.elements.expectedCountry.value,
    expectedProvider: form.elements.expectedProvider.value,
    theme: form.elements.theme.value,
    vpnProvider: form.elements.vpnProvider.value
  };
}

async function save(next) {
  try {
    await saveSettings(next);
    settings = await loadSettings();
    applyTheme(settings);
    $("helperSetup").hidden = settings.vpnProvider !== "mullvad";
    savedEl.textContent = t("saved");
  } catch (error) {
    savedEl.textContent = t("saveFailed", error.message);
  }
}

async function renderSites() {
  const list = $("siteList");
  list.replaceChildren();
  if (!settings.guardSites.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = t("guardEmpty");
    list.append(empty);
    return;
  }
  for (const domain of settings.guardSites) {
    const granted = await chrome.permissions.contains({ origins: siteOrigins(domain) });
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = domain;
    const mode = document.createElement("span");
    mode.className = "sub";
    mode.textContent = granted ? t("guardModeRedirect") : t("guardModeBlock");
    name.append(mode);
    item.append(name);
    if (!granted) {
      const allow = document.createElement("button");
      allow.type = "button";
      allow.textContent = t("guardAllow");
      allow.addEventListener("click", () => requestSite(domain));
      item.append(allow);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("guardRemove");
    remove.addEventListener("click", () => removeSite(domain));
    item.append(remove);
    list.append(item);
  }
}

// Must run inside the click handler: permission requests need a user gesture.
async function requestSite(domain) {
  try {
    await chrome.permissions.request({ origins: siteOrigins(domain) });
  } catch (_error) {
    // Declined or unsupported: the site is still blocked, just without the
    // explanation page.
  }
  await renderSites();
}

async function removeSite(domain) {
  await save({ ...settings, guardSites: settings.guardSites.filter((site) => site !== domain) });
  try {
    await chrome.permissions.remove({ origins: siteOrigins(domain) });
  } catch (_error) {
    // Nothing to remove.
  }
  await renderSites();
}

async function addSite(event) {
  event.preventDefault();
  const statusEl = $("siteStatus");
  const domain = normalizeDomain($("siteInput").value);
  if (!domain) {
    statusEl.textContent = t("guardInvalid");
    return;
  }
  if (settings.guardSites.length >= MAX_GUARDED_SITES) {
    statusEl.textContent = t("guardTooMany", MAX_GUARDED_SITES);
    return;
  }
  // Ask first, while the click still counts as a user gesture.
  let granted;
  try {
    granted = await chrome.permissions.request({ origins: siteOrigins(domain) });
  } catch (_error) {
    granted = false;
  }
  await save({ ...settings, guardSites: [...settings.guardSites, domain] });
  $("siteInput").value = "";
  statusEl.textContent = granted ? t("guardAdded", domain) : t("guardAddedBlockOnly", domain);
  await renderSites();
}

function setupHelper() {
  $("helperReleases").href = HELPER_RELEASES_URL;
  // Firefox identifies the extension by its fixed add-on ID, so only
  // Chromium browsers need the (per-install) extension ID.
  const firefox = chrome.runtime.getURL("").startsWith("moz-extension:");
  const id = firefox ? "" : chrome.runtime.id;
  $("helperCommandUnix").textContent = id ? `./install.sh --extension-id ${id}` : "./install.sh";
  $("helperCommandWindows").textContent = `powershell -ExecutionPolicy Bypass -File install.ps1${id ? ` -ExtensionId ${id}` : ""}`;

  $("helperTest").addEventListener("click", async () => {
    const statusEl = $("helperStatus");
    // Request first, while the click still counts as a user gesture; this
    // resolves immediately when the permission is already granted.
    let granted;
    try {
      granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    } catch (_error) {
      granted = false;
    }
    if (!granted) {
      statusEl.textContent = t("helperPermissionDenied");
      return;
    }
    statusEl.textContent = t("helperTesting");
    try {
      const hello = await callHelper("hello");
      statusEl.textContent = t("helperOk", hello.helper, hello.mullvad ?? hello.mullvadError ?? "?");
    } catch (error) {
      statusEl.textContent = t("helperFailed", error.message);
    }
  });
}

async function setupKeys() {
  const keys = await loadApiKeys();
  keysForm.elements.ipapi.value = keys.ipapi;
  keysForm.elements.proxycheck.value = keys.proxycheck;
  keysForm.addEventListener("change", async () => {
    await saveApiKeys({ ipapi: keysForm.elements.ipapi.value, proxycheck: keysForm.elements.proxycheck.value });
    savedEl.textContent = t("saved");
  });
}

async function showShortcuts() {
  const list = $("shortcuts");
  for (const command of await chrome.commands.getAll()) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = command.name === "_execute_action" ? t("commandOpen") : command.description || command.name;
    const key = document.createElement("strong");
    key.textContent = command.shortcut || t("shortcutUnset");
    item.append(name, key);
    list.append(item);
  }
}

async function init() {
  localizePage();
  fillSelects();
  settings = await loadSettings();
  applyTheme(settings);
  fillForm();
  form.addEventListener("change", () => save(readForm()));
  // Typing in the provider box shouldn't submit (and reload) the page.
  form.addEventListener("submit", (event) => event.preventDefault());
  $("addSite").addEventListener("submit", addSite);
  setupHelper();
  await Promise.all([renderSites(), setupKeys(), showShortcuts()]);
}

init();
