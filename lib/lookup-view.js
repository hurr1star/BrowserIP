import { addressStatus, formatAsn, formatCountry, formatLocation } from "./format.js";
import { t } from "./i18n.js";

function row(label, value, sub) {
  const wrapper = document.createElement("div");
  wrapper.className = "row";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  if (sub) {
    const subEl = document.createElement("span");
    subEl.className = "sub";
    subEl.textContent = sub;
    detail.append(subEl);
  }
  wrapper.append(term, detail);
  return wrapper;
}

// Renders a classified address (from lookupAddress) as a details list.
export function renderLookup(container, address) {
  const info = address.info ?? {};
  const list = document.createElement("dl");
  list.className = "details";
  const unavailable = t("unavailable");
  list.append(
    row(address.family || "IP", address.ip),
    row(t("labelVpn"), addressStatus(address), (address.reasons ?? []).join(", ") || null),
    row(t("labelLocation"), formatLocation(info) ?? unavailable),
    row(t("labelCountry"), formatCountry(info) ?? unavailable),
    row(t("labelProvider"), info.isp ?? unavailable),
    row(t("labelAsn"), formatAsn(info) ?? unavailable),
    row(t("labelTimezone"), info.timezone ?? unavailable),
    row(t("labelSource"), info.provider ?? unavailable)
  );
  container.replaceChildren(list);
}
