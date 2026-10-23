import { addressStatus, formatAsn, formatCountry, formatDateTime, formatLocation } from "./format.js";
import { t } from "./i18n.js";
import { deriveIndicator } from "./indicator.js";

// Plain-text summary for support tickets and bug reports.
export function buildReport({ state, settings, now, proxy = null, webrtc = null, dns = null }) {
  const indicator = deriveIndicator(state, settings, now);
  const info = state?.addresses?.[0]?.info;
  const lines = [t("reportHeading", formatDateTime(now)), ""];
  const add = (label, value) => {
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  };

  add(t("labelVpn"), indicator.detail ? `${indicator.vpnLabel} (${indicator.detail})` : indicator.vpnLabel);
  add(t("reportWarning"), indicator.warning);
  for (const address of state?.addresses ?? []) {
    add(address.family || "IP", `${address.ip} (${addressStatus(address)})`);
  }
  add(t("labelLocation"), formatLocation(info));
  add(t("labelCountry"), formatCountry(info));
  add(t("labelProvider"), info?.isp);
  add(t("labelAsn"), formatAsn(info));
  add(t("labelTimezone"), info?.timezone);
  add(t("labelSource"), info?.provider);
  add(t("labelProxy"), proxy);
  add(t("reportWebrtc"), webrtc);
  add(t("reportDns"), dns);
  if (state?.checkedAt) {
    add(t("reportChecked"), formatDateTime(state.checkedAt));
  }
  if (indicator.stale && state?.addresses?.length) {
    lines.push(state.ok ? t("titleOutOfDate") : t("titleFailed", state.error));
  }
  return lines.join("\n");
}
