import assert from "node:assert/strict";
import { test } from "node:test";

import { LOOKUP_TTL_MS, lookupAddress, runCheck } from "../lib/check.js";
import { DEFAULT_SETTINGS } from "../lib/settings.js";
import { fakeFetch, fixture } from "./helpers.js";

// Most tests leave the second opinion out; it has its own tests below.
const settings = { ...DEFAULT_SETTINGS, secondOpinion: false };
const NOW = 1_800_000_000_000;

function residentialFor(ip) {
  return { ...fixture("ipapi-residential"), ip };
}

test("looks up IPv4 and IPv6 separately and detects an IPv6 leak", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api6.ipify.org/": { ip: "2001:db8::7" },
    "https://api.ipapi.is/?q=185": fixture("ipapi-vpn"),
    "https://api.ipapi.is/?q=2001": residentialFor("2001:db8::7")
  });
  const state = await runCheck({ settings, now: NOW, fetchImpl });
  assert.equal(state.ok, true);
  assert.equal(state.overall, "leak");
  assert.deepEqual(
    state.addresses.map((address) => [address.family, address.ip, address.tunnelled]),
    [
      ["IPv4", "185.65.135.10", true],
      ["IPv6", "2001:db8::7", false]
    ]
  );
  assert.equal(state.checkedAt, NOW);
  assert.equal(state.lookedUpAt, NOW);
});

test("skips IPv6 when the setting is off", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api.ipapi.is/": fixture("ipapi-vpn")
  });
  const state = await runCheck({ settings: { ...settings, checkIpv6: false }, now: NOW, fetchImpl });
  assert.equal(state.addresses.length, 1);
  assert.ok(!fetchImpl.calls.some((url) => url.includes("api6")));
});

test("reuses the previous lookup while the addresses are unchanged", async () => {
  const routes = {
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api.ipapi.is/": fixture("ipapi-vpn")
  };
  const previous = await runCheck({ settings, now: NOW, fetchImpl: fakeFetch(routes) });

  const fetchImpl = fakeFetch(routes);
  const state = await runCheck({ previous, settings, now: NOW + 60_000, fetchImpl });
  assert.equal(state.overall, "tunnelled");
  assert.equal(state.checkedAt, NOW + 60_000);
  assert.equal(state.lookedUpAt, NOW);
  assert.ok(!fetchImpl.calls.some((url) => url.startsWith("https://api.ipapi.is/")));
});

test("looks up again when forced, when the IP changes, or after the TTL", async () => {
  const routes = {
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api.ipapi.is/": fixture("ipapi-vpn")
  };
  const previous = await runCheck({ settings, now: NOW, fetchImpl: fakeFetch(routes) });
  const lookups = (fetchImpl) => fetchImpl.calls.filter((url) => url.startsWith("https://api.ipapi.is/")).length;

  const forced = fakeFetch(routes);
  await runCheck({ previous, settings, force: true, now: NOW + 1000, fetchImpl: forced });
  assert.equal(lookups(forced), 1);

  const expired = fakeFetch(routes);
  await runCheck({ previous, settings, now: NOW + LOOKUP_TTL_MS + 1, fetchImpl: expired });
  assert.equal(lookups(expired), 1);

  const changed = fakeFetch({
    "https://api4.ipify.org/": { ip: "198.51.100.7" },
    "https://api.ipapi.is/": fixture("ipapi-residential")
  });
  const state = await runCheck({ previous, settings, now: NOW + 1000, fetchImpl: changed });
  assert.equal(lookups(changed), 1);
  assert.equal(state.overall, "direct");
});

test("falls back to a self lookup when the address endpoints are unreachable", async () => {
  const fetchImpl = fakeFetch({ "https://api.ipapi.is/": fixture("ipapi-residential") });
  const state = await runCheck({ settings, now: NOW, fetchImpl });
  assert.equal(state.ok, true);
  assert.equal(state.addresses[0].ip, "198.51.100.7");
  assert.equal(state.overall, "direct");
});

test("keeps an address whose lookup failed while another succeeded", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api6.ipify.org/": { ip: "2001:db8::7" },
    "https://api.ipapi.is/?q=185": fixture("ipapi-vpn")
  });
  const state = await runCheck({ settings, now: NOW, fetchImpl });
  assert.equal(state.overall, "tunnelled");
  assert.equal(state.addresses[1].info, null);
  assert.match(state.addresses[1].error, /All IP providers failed/);
});

test("a failed check keeps the previous data and records the error", async () => {
  const previous = await runCheck({
    settings,
    now: NOW,
    fetchImpl: fakeFetch({ "https://api.ipapi.is/": fixture("ipapi-vpn") })
  });
  const state = await runCheck({ previous, settings, now: NOW + 1000, fetchImpl: fakeFetch({}) });
  assert.equal(state.ok, false);
  assert.match(state.error, /All IP providers failed/);
  assert.equal(state.checkedAt, NOW);
  assert.equal(state.failedAt, NOW + 1000);
  assert.equal(state.addresses[0].ip, "185.65.135.10");
});

test("a failed first check has no data", async () => {
  const state = await runCheck({ settings, now: NOW, fetchImpl: fakeFetch({}) });
  assert.equal(state.ok, false);
  assert.deepEqual(state.addresses, []);
  assert.equal(state.checkedAt, null);
});

test("asks proxycheck.io only about addresses ipapi.is did not flag", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api6.ipify.org/": { ip: "2001:db8::7" },
    "https://api.ipapi.is/?q=185": fixture("ipapi-vpn"),
    "https://api.ipapi.is/?q=2001": residentialFor("2001:db8::7"),
    "https://proxycheck.io/": { status: "ok", "2001:db8::7": { proxy: "yes", type: "VPN" } }
  });
  const state = await runCheck({ settings: { ...settings, secondOpinion: true }, now: NOW, fetchImpl });
  assert.equal(state.overall, "tunnelled");
  assert.deepEqual(state.addresses[1].reasons, ["VPN (proxycheck.io)"]);
  assert.deepEqual(
    fetchImpl.calls.filter((url) => url.startsWith("https://proxycheck.io/")),
    ["https://proxycheck.io/v2/2001:db8::7?vpn=1&asn=1"]
  );
});

test("passes API keys to the providers", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "198.51.100.7" },
    "https://api.ipapi.is/": fixture("ipapi-residential"),
    "https://proxycheck.io/": { status: "ok", "198.51.100.7": { proxy: "no" } }
  });
  await runCheck({
    settings: { ...settings, checkIpv6: false, secondOpinion: true },
    keys: { ipapi: "A", proxycheck: "B" },
    now: NOW,
    fetchImpl
  });
  assert.ok(fetchImpl.calls.includes("https://api.ipapi.is/?q=198.51.100.7&key=A"));
  assert.ok(fetchImpl.calls.includes("https://proxycheck.io/v2/198.51.100.7?vpn=1&asn=1&key=B"));
});

test("lookupAddress classifies any address", async () => {
  const fetchImpl = fakeFetch({ "https://api.ipapi.is/?q=185": fixture("ipapi-vpn") });
  const address = await lookupAddress("185.65.135.10", { settings, fetchImpl });
  assert.equal(address.ip, "185.65.135.10");
  assert.equal(address.tunnelled, true);
});
