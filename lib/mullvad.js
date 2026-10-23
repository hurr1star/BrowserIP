// Mullvad support: exact detection through Mullvad's own connection check
// (am.i.mullvad.net) and, with the optional native helper installed, control
// of the Mullvad app.
import { t } from "./i18n.js";
import { fetchJson } from "./providers.js";

export const HELPER_NAME = "io.github.hurr1star.browserip";
export const HELPER_RELEASES_URL = "https://github.com/hurr1star/BrowserIP/releases/latest";

const CHECK_URLS = {
  IPv4: "https://ipv4.am.i.mullvad.net/json",
  IPv6: "https://ipv6.am.i.mullvad.net/json"
};

export function normalizeMullvadCheck(data) {
  const ip = typeof data?.ip === "string" ? data.ip.toLowerCase() : null;
  if (!ip) {
    throw new Error("response has no IP address");
  }
  const lists = Array.isArray(data.blacklisted?.results) ? data.blacklisted.results : [];
  return {
    ip,
    exit: typeof data.mullvad_exit_ip === "boolean" ? data.mullvad_exit_ip : null,
    hostname: data.mullvad_exit_ip_hostname || null,
    serverType: data.mullvad_server_type || null,
    blacklisted: typeof data.blacklisted?.blacklisted === "boolean" ? data.blacklisted.blacklisted : null,
    blacklists: lists.filter((list) => list?.blacklisted && list.name).map((list) => list.name)
  };
}

// Asks Mullvad whether the browser's address for `family` is a Mullvad exit.
// Returns null when the check is unavailable (e.g. no route for the family).
export async function fetchMullvadCheck(family, { fetchImpl = fetch } = {}) {
  try {
    return normalizeMullvadCheck(await fetchJson(CHECK_URLS[family], { fetchImpl, timeoutMs: 5000 }));
  } catch (_error) {
    return null;
  }
}

export function mullvadReason(check) {
  const details = [check.hostname, check.serverType].filter(Boolean).join(", ");
  return details ? `Mullvad (${details})` : "Mullvad";
}

// --- Native helper -------------------------------------------------------

export async function helperPermitted() {
  try {
    return await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  } catch (_error) {
    return false;
  }
}

// Must be called from a click handler: permission requests need a gesture.
export async function requestHelperPermission() {
  return chrome.permissions.request({ permissions: ["nativeMessaging"] });
}

// Sends one request to the helper. Throws with a readable message when the
// helper is missing or the Mullvad CLI reports an error.
export async function callHelper(cmd, args = {}) {
  let response;
  try {
    response = await chrome.runtime.sendNativeMessage(HELPER_NAME, { cmd, ...args });
  } catch (error) {
    if (/not found|not installed|forbidden|No such native application/i.test(error?.message ?? "")) {
      throw new Error(t("helperMissing"), { cause: error });
    }
    throw error;
  }
  if (!response?.ok) {
    throw new Error(response?.error || t("helperMissing"));
  }
  return response;
}

// Polls the app until `target` (a list of states, or a predicate on the
// status) is satisfied, or gives up.
export async function waitForAppState(target, { timeoutMs = 20000, intervalMs = 1000 } = {}) {
  const done = typeof target === "function" ? target : (status) => target.includes(status.state);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await callHelper("status");
    if (done(status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(t("mullvadTimeout"));
}

export function describeAppStatus(status) {
  const where = [status?.relay, status?.location].filter(Boolean).join(" · ");
  switch (status?.state) {
    case "connected":
      return where ? t("mullvadStateConnected", where) : t("mullvadStateConnectedPlain");
    case "connecting":
      return t("mullvadStateConnecting");
    case "disconnected":
      return t("mullvadStateDisconnected");
    case "disconnecting":
      return t("mullvadStateDisconnecting");
    case "blocked":
      return t("mullvadStateBlocked");
    default:
      return t("mullvadStateUnknown");
  }
}
