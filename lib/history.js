import { t } from "./i18n.js";

export const MAX_HISTORY = 200;

// Builds the history entry for a check, or null when nothing worth logging
// happened. `change` comes from describeChange().
export function historyEntry(previous, state, change, now) {
  const primary = state.addresses?.[0];
  const base = {
    at: now,
    overall: state.overall,
    ips: (state.addresses ?? []).map((address) => address.ip),
    countryCode: primary?.info?.countryCode ?? null,
    isp: primary?.info?.isp ?? null
  };
  if (change) {
    return { ...base, title: change.title, message: change.message };
  }
  if (!previous && state.ok) {
    return { ...base, title: t("historyFirstCheck"), message: base.ips.join(", ") };
  }
  if (previous?.ok && !state.ok) {
    return { ...base, title: t("historyCheckFailed"), message: state.error };
  }
  return null;
}

export function appendHistory(history, entry) {
  return [entry, ...(Array.isArray(history) ? history : [])].slice(0, MAX_HISTORY);
}

function csvField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function historyToCsv(history) {
  const rows = [["time", "event", "details", "status", "ips", "country", "provider"]];
  for (const entry of history) {
    rows.push([
      new Date(entry.at).toISOString(),
      entry.title,
      entry.message,
      entry.overall,
      entry.ips.join(" "),
      entry.countryCode,
      entry.isp
    ]);
  }
  return `${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
