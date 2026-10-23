import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, normalizeDomain, sanitizeApiKeys, sanitizeSettings } from "../lib/settings.js";

test("missing or malformed settings fall back to the defaults", () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings("nope"), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ expectVpn: "yes", pollMinutes: 3 }), DEFAULT_SETTINGS);
});

test("valid values are kept", () => {
  const settings = sanitizeSettings({ expectVpn: false, pollMinutes: 0, checkIpv6: false, extra: 1 });
  assert.equal(settings.expectVpn, false);
  assert.equal(settings.pollMinutes, 0);
  assert.equal(settings.checkIpv6, false);
  assert.equal("extra" in settings, false);
});

test("normalizeDomain accepts URLs and wildcards and rejects junk", () => {
  assert.equal(normalizeDomain("Example.COM"), "example.com");
  assert.equal(normalizeDomain("https://www.bank.example.co.uk/login?x=1"), "bank.example.co.uk");
  assert.equal(normalizeDomain("*.example.com"), "example.com");
  assert.equal(normalizeDomain("example.com:8443"), "example.com");
  assert.equal(normalizeDomain("localhost"), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("192.0.2.1"), null);
});

test("expectations, protected sites and theme are validated", () => {
  const settings = sanitizeSettings({
    expectedCountry: "se",
    expectedProvider: "  Mullvad ",
    guardSites: ["example.com", "https://example.com/x", "bad site", "other.org"],
    theme: "light"
  });
  assert.equal(settings.expectedCountry, "SE");
  assert.equal(settings.expectedProvider, "Mullvad");
  assert.deepEqual(settings.guardSites, ["example.com", "other.org"]);
  assert.equal(settings.theme, "light");
  assert.equal(sanitizeSettings({ expectedCountry: "Sweden", theme: "neon" }).expectedCountry, "");
  assert.equal(sanitizeSettings({ theme: "neon" }).theme, "system");
});

test("API keys are trimmed strings", () => {
  assert.deepEqual(sanitizeApiKeys({ ipapi: " k ", proxycheck: 5 }), { ipapi: "k", proxycheck: "" });
  assert.deepEqual(sanitizeApiKeys(undefined), { ipapi: "", proxycheck: "" });
});
