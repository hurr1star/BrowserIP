import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, sanitizeSettings } from "../lib/settings.js";

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
