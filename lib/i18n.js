// Message lookup that works in the extension (chrome.i18n, any locale) and in
// Node tests (bundled English fallback). Messages use {0}, {1}... for
// substitutions so they never collide with chrome.i18n's own $ syntax.
import { MESSAGES_EN } from "./messages-en.js";

export function t(key, ...substitutions) {
  let message;
  try {
    message = globalThis.chrome?.i18n?.getMessage(key) ?? "";
  } catch (_error) {
    message = "";
  }
  if (!message) {
    message = MESSAGES_EN[key] ?? key;
  }
  return message.replace(/\{(\d)\}/g, (match, index) => {
    const value = substitutions[Number(index)];
    return value === undefined || value === null ? match : String(value);
  });
}

export function uiLanguage() {
  try {
    return globalThis.chrome?.i18n?.getUILanguage?.() || "en";
  } catch (_error) {
    return "en";
  }
}

export function formatList(items) {
  try {
    return new Intl.ListFormat(uiLanguage(), { type: "conjunction" }).format(items);
  } catch (_error) {
    return items.join(", ");
  }
}

// Fills the text of elements with a data-i18n attribute (a message key) and
// the attributes listed in data-i18n-attr as comma-separated attribute:key
// pairs.
export function localizePage(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of element.dataset.i18nAttr.split(",")) {
      const [attribute, key] = pair.split(":").map((part) => part.trim());
      element.setAttribute(attribute, t(key));
    }
  }
  document.documentElement.lang = uiLanguage();
}
