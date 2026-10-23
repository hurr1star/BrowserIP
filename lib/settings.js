export const POLL_OPTIONS = [0, 2, 5, 10, 15, 30, 60];

export const DEFAULT_SETTINGS = Object.freeze({
  // Show the red warning and icon when no VPN is detected.
  expectVpn: true,
  // Minutes between background checks; 0 turns background checks off.
  pollMinutes: 5,
  notifyOnChange: true,
  showCountryBadge: true,
  // Look up the IPv6 address separately to catch IPv6 leaks.
  checkIpv6: true
});

export function sanitizeSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") {
    return settings;
  }
  for (const key of ["expectVpn", "notifyOnChange", "showCountryBadge", "checkIpv6"]) {
    if (typeof raw[key] === "boolean") {
      settings[key] = raw[key];
    }
  }
  if (POLL_OPTIONS.includes(raw.pollMinutes)) {
    settings.pollMinutes = raw.pollMinutes;
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
