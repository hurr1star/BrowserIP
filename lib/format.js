import { t, uiLanguage } from "./i18n.js";
import { countryName } from "./providers.js";

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(uiLanguage(), { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(uiLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) {
    return t("justNow");
  }
  const format = new Intl.RelativeTimeFormat(uiLanguage(), { style: "short" });
  if (minutes < 60) {
    return format.format(-minutes, "minute");
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? format.format(-hours, "hour") : format.format(-Math.floor(hours / 24), "day");
}

export function formatAsn(info) {
  if (!info?.asn) {
    return info?.asnOrg || null;
  }
  return info.asnOrg ? `AS${info.asn} · ${info.asnOrg}` : `AS${info.asn}`;
}

// Country name in the UI language; providers report it in English.
export function formatCountry(info) {
  return countryName(info?.countryCode, uiLanguage()) || info?.country || null;
}

export function formatLocation(info) {
  const parts = [info?.city, info?.region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function addressStatus(address) {
  if (address.error) {
    return t("addressLookupFailed");
  }
  if (address.tunnelled === true) {
    return t("addressTunnelled");
  }
  return address.tunnelled === false ? t("addressDirect") : t("addressUnknown");
}
