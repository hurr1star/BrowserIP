import { formatCountry, formatTime } from "./format.js";
import { formatList, t, uiLanguage } from "./i18n.js";
import { countryName } from "./providers.js";

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

// Checks the exit against the country and provider the user expects.
// Returns { text, badge } describing the first mismatch, or null.
export function expectationMismatch(state, settings) {
  const infos = (state?.addresses ?? []).map((address) => address.info).filter(Boolean);
  if (!infos.length) {
    return null;
  }
  if (settings.expectedCountry) {
    const wrong = infos.find((info) => info.countryCode && info.countryCode !== settings.expectedCountry);
    if (wrong) {
      const expected = countryName(settings.expectedCountry, uiLanguage()) || settings.expectedCountry;
      const actual = formatCountry(wrong);
      return { text: t("mismatchCountry", actual, expected), badge: `!${wrong.countryCode}` };
    }
  }
  if (settings.vpnProvider === "mullvad" && infos.some((info) => info.mullvad?.exit === false)) {
    return { text: t("mismatchNotMullvad"), badge: "!ISP" };
  }
  if (settings.expectedProvider) {
    const needle = settings.expectedProvider.toLowerCase();
    const wrong = infos.find(
      (info) =>
        ![
          info.vpnService,
          info.isp,
          info.asnOrg,
          info.datacenterName,
          info.secondOpinion?.label,
          info.mullvad?.exit ? `Mullvad ${info.mullvad.hostname ?? ""}` : null
        ].some((name) =>
          name?.toLowerCase().includes(needle)
        )
    );
    if (wrong) {
      const actual = wrong.vpnService || wrong.isp || wrong.asnOrg || t("unknownProvider");
      return { text: t("mismatchProvider", actual, settings.expectedProvider), badge: "!ISP" };
    }
  }
  return null;
}

function directFamilies(state) {
  const families = state.addresses.filter((address) => address.tunnelled === false).map((address) => address.family);
  return families.length ? formatList(families) : "IP";
}

// Describes the connection for the toolbar icon and the popup. Every alert
// state carries badge text as well as a colour, so it reads without colour.
// `safe` is true only for a fresh, tunnelled result that meets the user's
// expectations; protected sites are blocked whenever it is false.
export function deriveIndicator(state, settings, now) {
  if (!state?.addresses?.length) {
    return {
      color: "gray",
      badgeText: "?",
      badgeColor: BADGE_COLORS.gray,
      vpnLabel: state?.error ? t("vpnUnavailable") : t("vpnChecking"),
      detail: null,
      warning: null,
      stale: true,
      safe: false,
      title: state?.error ? t("titleCheckFailed", state.error) : t("titleNotChecked")
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
        vpnLabel: t("vpnDetected"),
        detail: reasons.join(", ") || null,
        warning: null
      };
      break;
    case "leak": {
      const leaking = directFamilies(state);
      result = {
        color: "red",
        badgeText: "LEAK",
        vpnLabel: t("vpnLeaking"),
        detail: t("leakDetail", leaking),
        warning: t("warningLeak", leaking)
      };
      break;
    }
    case "direct":
      result = settings.expectVpn
        ? { color: "red", badgeText: "OFF", vpnLabel: t("vpnNotDetected"), detail: null, warning: t("warningNoVpn") }
        : { color: "blue", badgeText: countryBadge, vpnLabel: t("vpnNotDetected"), detail: null, warning: null };
      break;
    default:
      result = {
        color: "gray",
        badgeText: "?",
        vpnLabel: t("vpnUnknown"),
        detail: t("noVpnData", primary.info?.provider ?? "?"),
        warning: null
      };
  }

  const mismatch = expectationMismatch(state, settings);
  if (mismatch && result.color !== "red") {
    result = { ...result, color: "red", badgeText: mismatch.badge, warning: mismatch.text };
  }

  const stale = isStale(state, settings, now);
  const safe = !stale && result.color === "green";
  const summary = result.detail ? `${result.vpnLabel} (${result.detail})` : result.vpnLabel;
  const lines = [t("titleStatus", summary), [primary.ip, primary.info?.countryCode].filter(Boolean).join(" · ")];
  if (result.warning) {
    lines.push(result.warning);
  }
  if (state.checkedAt) {
    lines.push(t("titleChecked", formatTime(state.checkedAt)));
  }

  if (stale) {
    // The last result may no longer be true; never show it as current.
    result = { ...result, color: "gray", badgeText: "?" };
    lines.push(state.ok ? t("titleOutOfDate") : t("titleFailed", state.error));
  }

  return { ...result, badgeColor: BADGE_COLORS[result.color], stale, safe, title: lines.join("\n") };
}

// Returns a notification for a meaningful change between two successful
// checks, or null.
export function describeChange(previous, next, settings) {
  if (!previous?.ok || !next?.ok || !next.addresses.length) {
    return null;
  }

  const primary = next.addresses[0];
  const message = [primary.ip, primary.info?.isp, formatCountry(primary.info)].filter(Boolean).join(" · ");
  const stateChanged =
    previous.overall !== next.overall && previous.overall !== "unknown" && next.overall !== "unknown";
  if (stateChanged) {
    const titles = { tunnelled: t("changeConnected"), direct: t("changeDisconnected"), leak: t("changeLeak") };
    return { title: titles[next.overall], message };
  }

  const nextMismatch = expectationMismatch(next, settings)?.text ?? null;
  if (nextMismatch && nextMismatch !== (expectationMismatch(previous, settings)?.text ?? null)) {
    return { title: t("changeUnexpectedExit"), message: `${nextMismatch} · ${primary.ip}` };
  }

  const previousIps = previous.addresses.map((address) => address.ip).join(",");
  const nextIps = next.addresses.map((address) => address.ip).join(",");
  return previousIps === nextIps ? null : { title: t("changeIp"), message };
}
