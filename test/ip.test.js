import assert from "node:assert/strict";
import { test } from "node:test";

import { findIpAddress, isIpAddress } from "../lib/ip.js";

test("isIpAddress", () => {
  for (const valid of ["192.0.2.1", "0.0.0.0", "255.255.255.255", "2001:db8::1", "::1", "::ffff:192.0.2.1"]) {
    assert.equal(isIpAddress(valid), true, valid);
  }
  for (const invalid of ["256.1.1.1", "1.2.3", "01.2.3.4", "2001:db8:::1", "example.com", "", null, "1.2.3.4/24"]) {
    assert.equal(isIpAddress(invalid), false, String(invalid));
  }
});

test("findIpAddress pulls an address out of selected text", () => {
  assert.equal(findIpAddress("Connection from 203.0.113.5:443 refused"), "203.0.113.5");
  assert.equal(findIpAddress("peer [2001:DB8::7]:51820 handshake"), "2001:db8::7");
  assert.equal(findIpAddress("(198.51.100.7)."), "198.51.100.7");
  assert.equal(findIpAddress("no address here"), null);
  assert.equal(findIpAddress(undefined), null);
});
