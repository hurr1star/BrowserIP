import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { formatList, t } from "../lib/i18n.js";

afterEach(() => {
  delete globalThis.chrome;
});

test("t falls back to English and substitutes placeholders", () => {
  assert.equal(t("mismatchCountry", "Sweden", "Germany"), "Exit country is Sweden, expected Germany");
  assert.equal(t("lookupFailed"), "Lookup failed: {0}");
  assert.equal(t("noSuchKey"), "noSuchKey");
});

test("t prefers chrome.i18n when it has the message", () => {
  globalThis.chrome = { i18n: { getMessage: (key) => (key === "changeIp" ? "IP-Adresse geändert" : "") } };
  assert.equal(t("changeIp"), "IP-Adresse geändert");
  assert.equal(t("changeLeak"), "VPN leak detected");
});

test("formatList joins with the UI language's conjunction", () => {
  assert.equal(formatList(["IPv4", "IPv6"]), "IPv4 and IPv6");
});
