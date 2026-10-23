import { formatTime } from "./format.js";

// Without background checks, a result older than this is shown as stale.
export const STALE_WITHOUT_POLLING_MS = 15 * 60 * 1000;

const BADGE_COLORS = {
  green: "#15803d",
  red: "#dc2626",
  blue: "#1d4ed8",
  gray: "#4b5563"
};

export function staleAfterMs(settings) {
  return settings.pollMinutes > 0 ? (settings.pollMinutes * 2 + 1) * 60 * 1000 : STALE_WITHOUT_POLLING_MS;
}

export function isStale(state, settings, now) {
  return !state?.ok || !state.checkedAt || now - state.checkedAt > staleAfterMs(settings);
}

function directFamilies(state) {
  const families = state.addresses
    .filter((address) => address.tunnelled === false)
    .map((address) => address.family || "Some");
  return families.join(" and ") || "Some";
}

// Describes the connection for the toolbar icon and the popup. Every alert
// state carries badge text as well as a colour, so it reads without colour.
export function deriveIndicator(state, settings, now) {
  if (!state?.addresses?.length) {
    return {
      color: "gray",
      badgeText: "?",
      badgeColor: BADGE_COLORS.gray,
      vpnLabel: state?.error ? "Unavailable" : "Checking...",
      detail: null,
      warning: null,
      stale: true,
      title: state?.error ? `BrowserIP: check failed (${state.error})` : "BrowserIP: not checked yet"
    };
  }

  const primary = state.addresses[0];
  const reasons = [...new Set(state.addresses.flatMap((address) => address.reasons ?? []))];
  const countryBadge = settings.showCountryBadge ? primary.info?.countryCode || "" : "";
  let result;

  switch (state.overall) {
    case "tunnelled":
      result = {
        color: "green",
        badgeText: countryBadge,
        vpnLabel: "Detected",
        detail: reasons.join(", ") || null,
        warning: null
      };
      break;
    case "leak": {
      const leaking = directFamilies(state);
      result = {
        color: "red",
        badgeText: "LEAK",
        vpnLabel: "Leaking",
        detail: `${leaking} traffic bypasses the tunnel`,
        warning: `Leak: ${leaking} not tunnelled`
      };
      break;
    }
    case "direct":
      result = settings.expectVpn
        ? {
            color: "red",
            badgeText: "OFF",
            vpnLabel: "Not detected",
            detail: null,
            warning: "Warning: VPN not detected"
          }
        : { color: "blue", badgeText: countryBadge, vpnLabel: "Not detected", detail: null, warning: null };
      break;
    default:
      result = {
        color: "gray",
        badgeText: "?",
        vpnLabel: "Unknown",
        detail: `${primary.info?.provider ?? "The provider"} has no VPN data`,
        warning: null
      };
  }

  const stale = isStale(state, settings, now);
  const summary = result.detail ? `${result.vpnLabel} (${result.detail})` : result.vpnLabel;
  const where = [primary.ip, primary.info?.countryCode].filter(Boolean).join(" · ");
  let title = `BrowserIP: VPN ${summary.charAt(0).toLowerCase()}${summary.slice(1)}\n${where}`;
  if (state.checkedAt) {
    title += `\nChecked ${formatTime(state.checkedAt)}`;
  }

  if (stale) {
    // The last result may no longer be true; never show it as current.
    result = { ...result, color: "gray", badgeText: "?" };
    title += state.ok ? "\nOut of date" : `\nLast check failed: ${state.error}`;
  }

  return { ...result, badgeColor: BADGE_COLORS[result.color], stale, title };
}

const CHANGE_TITLES = {
  tunnelled: "VPN connected",
  direct: "VPN disconnected",
  leak: "VPN leak detected"
};

// Returns a notification for a meaningful change between two successful
// checks, or null.
export function describeChange(previous, next) {
  if (!previous?.ok || !next?.ok || !next.addresses.length) {
    return null;
  }

  const previousIps = previous.addresses.map((address) => address.ip).join(",");
  const nextIps = next.addresses.map((address) => address.ip).join(",");
  const stateChanged =
    previous.overall !== next.overall && previous.overall !== "unknown" && next.overall !== "unknown";

  if (!stateChanged && previousIps === nextIps) {
    return null;
  }

  const primary = next.addresses[0];
  const message = [primary.ip, primary.info?.isp, primary.info?.country].filter(Boolean).join(" · ");
  return {
    title: stateChanged ? CHANGE_TITLES[next.overall] : "IP address changed",
    message
  };
}
