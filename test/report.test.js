import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReport } from "../lib/report.js";
import { DEFAULT_SETTINGS } from "../lib/settings.js";

const NOW = Date.UTC(2026, 9, 23, 12, 0);

test("the report lists the status, addresses, details and test results", () => {
  const state = {
    ok: true,
    checkedAt: NOW,
    overall: "leak",
    addresses: [
      {
        ip: "185.65.135.10",
        family: "IPv4",
        tunnelled: true,
        reasons: ["VPN (Mullvad VPN)"],
        info: { city: "Stockholm", country: "Sweden", countryCode: "SE", isp: "M247", asn: 9009, asnOrg: "M247", provider: "ipapi.is" }
      },
      { ip: "2001:db8::7", family: "IPv6", tunnelled: false, reasons: [], info: {} }
    ]
  };
  const report = buildReport({
    state,
    settings: DEFAULT_SETTINGS,
    now: NOW,
    webrtc: "OK: WebRTC exposed no public address.",
    dns: null
  });
  const lines = report.split("\n");
  assert.match(lines[0], /^BrowserIP report — /);
  for (const expected of [
    "VPN: Leaking (IPv6 traffic bypasses the tunnel)",
    "Warning: Leak: IPv6 not tunnelled",
    "IPv4: 185.65.135.10 (✓ tunnelled)",
    "IPv6: 2001:db8::7 (✕ direct)",
    "Location: Stockholm",
    "ASN: AS9009 · M247",
    "WebRTC test: OK: WebRTC exposed no public address."
  ]) {
    assert.ok(lines.includes(expected), `missing "${expected}" in:\n${report}`);
  }
  assert.ok(!report.includes("DNS leak test"));
});

test("an empty state still produces a report", () => {
  assert.match(buildReport({ state: null, settings: DEFAULT_SETTINGS, now: NOW }), /VPN: Checking\.\.\./);
});

test("the report includes reputation and the Mullvad app state", () => {
  const state = {
    ok: true,
    checkedAt: NOW,
    overall: "tunnelled",
    addresses: [
      {
        ip: "185.65.135.10",
        family: "IPv4",
        tunnelled: true,
        reasons: ["Mullvad (se-got-wg-001, WireGuard)"],
        info: { mullvad: { exit: true, blacklisted: true, blacklists: ["Spamhaus"] }, flags: {} }
      }
    ]
  };
  const report = buildReport({ state, settings: DEFAULT_SETTINGS, now: NOW, mullvadApp: "Connected · se-got-wg-001" });
  assert.match(report, /^Reputation: On blocklists \(Spamhaus\); expect CAPTCHAs$/m);
  assert.match(report, /^Mullvad app: Connected · se-got-wg-001$/m);
});
