import assert from "node:assert/strict";
import { test } from "node:test";

import { describeChange, deriveIndicator, expectationMismatch, isStale, staleAfterMs } from "../lib/indicator.js";
import { DEFAULT_SETTINGS } from "../lib/settings.js";

const settings = { ...DEFAULT_SETTINGS };
const NOW = 1_800_000_000_000;

function state(overall, overrides = {}) {
  const tunnelled = { tunnelled: true, direct: false, leak: true, unknown: null }[overall];
  const addresses = [
    {
      ip: "192.0.2.1",
      family: "IPv4",
      tunnelled,
      reasons: tunnelled ? ["VPN (Mullvad VPN)"] : [],
      info: { countryCode: "SE", country: "Sweden", isp: "M247", provider: "ipapi.is" }
    }
  ];
  if (overall === "leak") {
    addresses.push({ ip: "2001:db8::1", family: "IPv6", tunnelled: false, reasons: [], info: {} });
  }
  return { ok: true, checkedAt: NOW, overall, addresses, ...overrides };
}

test("tunnelled: green with the country badge", () => {
  const indicator = deriveIndicator(state("tunnelled"), settings, NOW);
  assert.equal(indicator.color, "green");
  assert.equal(indicator.badgeText, "SE");
  assert.equal(indicator.vpnLabel, "Detected");
  assert.equal(indicator.detail, "VPN (Mullvad VPN)");
  assert.equal(indicator.warning, null);
  assert.equal(indicator.safe, true);
  assert.match(indicator.title, /^BrowserIP · VPN: Detected \(VPN \(Mullvad VPN\)\)\n192\.0\.2\.1 · SE\nChecked /);
  assert.equal(deriveIndicator(state("tunnelled"), { ...settings, showCountryBadge: false }, NOW).badgeText, "");
});

test("direct while a VPN is expected: red, OFF badge and warning", () => {
  const indicator = deriveIndicator(state("direct"), settings, NOW);
  assert.equal(indicator.color, "red");
  assert.equal(indicator.badgeText, "OFF");
  assert.match(indicator.warning, /VPN not detected/);
  assert.equal(indicator.safe, false);
});

test("direct while no VPN is expected: blue, no warning", () => {
  const indicator = deriveIndicator(state("direct"), { ...settings, expectVpn: false }, NOW);
  assert.equal(indicator.color, "blue");
  assert.equal(indicator.badgeText, "SE");
  assert.equal(indicator.warning, null);
});

test("leak: red with a LEAK badge naming the leaking family", () => {
  const indicator = deriveIndicator(state("leak"), { ...settings, expectVpn: false }, NOW);
  assert.equal(indicator.color, "red");
  assert.equal(indicator.badgeText, "LEAK");
  assert.match(indicator.warning, /IPv6 not tunnelled/);
});

test("unknown: gray with a question mark", () => {
  const indicator = deriveIndicator(state("unknown"), settings, NOW);
  assert.equal(indicator.color, "gray");
  assert.equal(indicator.badgeText, "?");
  assert.match(indicator.detail, /ipapi\.is has no VPN data/);
});

test("old or failed results are greyed out but keep their label", () => {
  const old = deriveIndicator(state("tunnelled"), settings, NOW + staleAfterMs(settings) + 1);
  assert.equal(old.stale, true);
  assert.equal(old.color, "gray");
  assert.equal(old.badgeText, "?");
  assert.equal(old.vpnLabel, "Detected");
  assert.equal(old.safe, false);
  assert.match(old.title, /Out of date/);

  const failed = deriveIndicator(state("tunnelled", { ok: false, error: "offline" }), settings, NOW);
  assert.equal(failed.color, "gray");
  assert.match(failed.title, /Last check failed: offline/);
});

test("no data yet", () => {
  assert.equal(deriveIndicator(null, settings, NOW).vpnLabel, "Checking...");
  const failed = deriveIndicator({ ok: false, error: "offline", addresses: [] }, settings, NOW);
  assert.equal(failed.vpnLabel, "Unavailable");
  assert.equal(failed.badgeText, "?");
});

test("staleness follows the polling interval", () => {
  assert.equal(staleAfterMs({ pollMinutes: 5 }), 11 * 60 * 1000);
  assert.equal(staleAfterMs({ pollMinutes: 0 }), 15 * 60 * 1000);
  assert.equal(isStale(state("direct"), settings, NOW + 60_000), false);
  assert.equal(isStale(null, settings, NOW), true);
});

test("describeChange reports VPN transitions and IP changes", () => {
  assert.deepEqual(describeChange(state("tunnelled"), state("direct"), settings), {
    title: "VPN disconnected",
    message: "192.0.2.1 · M247 · Sweden"
  });
  assert.equal(describeChange(state("direct"), state("tunnelled"), settings).title, "VPN connected");
  assert.equal(describeChange(state("tunnelled"), state("leak"), settings).title, "VPN leak detected");

  const moved = state("tunnelled");
  moved.addresses[0] = { ...moved.addresses[0], ip: "192.0.2.99" };
  assert.equal(describeChange(state("tunnelled"), moved, settings).title, "IP address changed");
});

test("describeChange stays quiet when nothing meaningful changed", () => {
  assert.equal(describeChange(state("tunnelled"), state("tunnelled"), settings), null);
  assert.equal(describeChange(null, state("tunnelled"), settings), null);
  assert.equal(describeChange(state("tunnelled"), state("tunnelled", { ok: false }), settings), null);
  assert.equal(describeChange(state("unknown"), state("direct"), settings), null);
});

test("an exit in the wrong country turns the icon red with a !CC badge", () => {
  const expectSweden = { ...settings, expectedCountry: "SE" };
  assert.equal(expectationMismatch(state("tunnelled"), expectSweden), null);

  const expectGermany = { ...settings, expectedCountry: "DE" };
  const indicator = deriveIndicator(state("tunnelled"), expectGermany, NOW);
  assert.equal(indicator.color, "red");
  assert.equal(indicator.badgeText, "!SE");
  assert.equal(indicator.warning, "Exit country is Sweden, expected Germany");
  assert.equal(indicator.vpnLabel, "Detected");
  assert.equal(indicator.safe, false);
});

test("a provider that doesn't match the expected one is flagged", () => {
  const matching = deriveIndicator(state("tunnelled"), { ...settings, expectedProvider: "m247" }, NOW);
  assert.equal(matching.safe, true);

  const other = deriveIndicator(state("tunnelled"), { ...settings, expectedProvider: "Proton" }, NOW);
  assert.equal(other.badgeText, "!ISP");
  assert.equal(other.warning, "Provider is M247, expected Proton");
});

test("expectation alerts never override a more serious alert", () => {
  const indicator = deriveIndicator(state("direct"), { ...settings, expectedCountry: "DE" }, NOW);
  assert.equal(indicator.badgeText, "OFF");
});

test("describeChange reports a new expectation mismatch", () => {
  const expectSweden = { ...settings, expectedCountry: "SE" };
  const moved = state("tunnelled");
  moved.addresses[0] = { ...moved.addresses[0], info: { ...moved.addresses[0].info, countryCode: "US", country: "United States" } };
  const change = describeChange(state("tunnelled"), moved, expectSweden);
  assert.equal(change.title, "Unexpected VPN exit");
  assert.match(change.message, /^Exit country is United States, expected Sweden · 192\.0\.2\.1$/);
});

test("Mullvad users are warned when the VPN isn't Mullvad", () => {
  const mullvadSettings = { ...settings, vpnProvider: "mullvad" };
  const other = state("tunnelled");
  other.addresses[0] = { ...other.addresses[0], info: { ...other.addresses[0].info, mullvad: { exit: false } } };
  const indicator = deriveIndicator(other, mullvadSettings, NOW);
  assert.equal(indicator.warning, "Not connected through Mullvad");
  assert.equal(indicator.badgeText, "!ISP");
  assert.equal(indicator.safe, false);

  const onMullvad = state("tunnelled");
  onMullvad.addresses[0] = {
    ...onMullvad.addresses[0],
    info: { ...onMullvad.addresses[0].info, mullvad: { exit: true, hostname: "se-got-wg-001" } }
  };
  assert.equal(deriveIndicator(onMullvad, mullvadSettings, NOW).safe, true);
  assert.equal(deriveIndicator(onMullvad, { ...mullvadSettings, expectedProvider: "mullvad" }, NOW).safe, true);
});
