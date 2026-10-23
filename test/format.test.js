import assert from "node:assert/strict";
import { test } from "node:test";

import { describeReputation, formatCountry } from "../lib/format.js";

test("describeReputation prefers Mullvad's blocklist check", () => {
  assert.deepEqual(describeReputation({ mullvad: { blacklisted: true, blacklists: ["Spamhaus", "SORBS"] } }), {
    flagged: true,
    text: "On blocklists (Spamhaus, SORBS); expect CAPTCHAs"
  });
  assert.deepEqual(describeReputation({ flags: { abuser: true } }), {
    flagged: true,
    text: "Flagged for abuse; expect CAPTCHAs"
  });
  assert.deepEqual(describeReputation({ flags: { abuser: false } }), { flagged: false, text: "Not on blocklists" });
  assert.equal(describeReputation({ flags: { abuser: null } }), null);
  assert.equal(describeReputation(undefined), null);
});

test("formatCountry uses the ISO code when it can", () => {
  assert.equal(formatCountry({ countryCode: "SE", country: "Sverige" }), "Sweden");
  assert.equal(formatCountry({ country: "Sweden" }), "Sweden");
  assert.equal(formatCountry(null), null);
});
