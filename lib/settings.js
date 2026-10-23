export const POLL_OPTIONS = [0, 2, 5, 10, 15, 30, 60];
export const THEMES = ["system", "dark", "light"];
export const MAX_GUARDED_SITES = 50;

export const DEFAULT_SETTINGS = Object.freeze({
  // Show the red warning and icon when no VPN is detected.
  expectVpn: true,
  // Minutes between background checks; 0 turns background checks off.
  pollMinutes: 5,
  notifyOnChange: true,
  showCountryBadge: true,
  // Look up the IPv6 address separately to catch IPv6 leaks.
  checkIpv6: true,
  // Ask proxycheck.io when ipapi.is finds no VPN, to cut false alarms.
  secondOpinion: true,
  // ISO country code the VPN should exit in; "" accepts any country.
  expectedCountry: "",
  // Text the VPN service or provider name should contain; "" accepts any.
  expectedProvider: "",
  // Domains to block while the VPN is not confirmed.
  guardSites: Object.freeze([]),
  theme: "system"
});

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// Accepts "example.com", "https://www.example.com/path" or "*.example.com"
// and returns "example.com", or null when the input is not a domain.
export function normalizeDomain(input) {
  let value = String(input ?? "").trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0];
  value = value.replace(/:\d+$/, "").replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");
  return DOMAIN.test(value) ? value : null;
}

export function sanitizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, guardSites: [] };
  if (!raw || typeof raw !== "object") {
    return settings;
  }
  for (const key of ["expectVpn", "notifyOnChange", "showCountryBadge", "checkIpv6", "secondOpinion"]) {
    if (typeof raw[key] === "boolean") {
      settings[key] = raw[key];
    }
  }
  if (POLL_OPTIONS.includes(raw.pollMinutes)) {
    settings.pollMinutes = raw.pollMinutes;
  }
  if (typeof raw.expectedCountry === "string" && /^[A-Za-z]{2}$/.test(raw.expectedCountry)) {
    settings.expectedCountry = raw.expectedCountry.toUpperCase();
  }
  if (typeof raw.expectedProvider === "string") {
    settings.expectedProvider = raw.expectedProvider.trim().slice(0, 100);
  }
  if (Array.isArray(raw.guardSites)) {
    const sites = raw.guardSites.map(normalizeDomain).filter(Boolean);
    settings.guardSites = [...new Set(sites)].slice(0, MAX_GUARDED_SITES);
  }
  if (THEMES.includes(raw.theme)) {
    settings.theme = raw.theme;
  }
  return settings;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return sanitizeSettings(settings);
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings: sanitizeSettings(settings) });
}

// API keys stay on this device (storage.local), unlike settings, which sync.
export function sanitizeApiKeys(raw) {
  const keys = { ipapi: "", proxycheck: "" };
  for (const name of Object.keys(keys)) {
    if (typeof raw?.[name] === "string") {
      keys[name] = raw[name].trim().slice(0, 200);
    }
  }
  return keys;
}

export async function loadApiKeys() {
  const { apiKeys } = await chrome.storage.local.get("apiKeys");
  return sanitizeApiKeys(apiKeys);
}

export async function saveApiKeys(keys) {
  await chrome.storage.local.set({ apiKeys: sanitizeApiKeys(keys) });
}

export function applyTheme(settings, root = document.documentElement) {
  if (settings.theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = settings.theme;
  }
}
