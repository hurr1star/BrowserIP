import assert from "node:assert/strict";
import { test } from "node:test";

import { PROVIDERS, SECOND_OPINION, countryName, fetchAddress, fetchSecondOpinion, ipFamily, lookupIp } from "../lib/providers.js";
import { fakeFetch, fixture } from "./helpers.js";

const [ipapi, ipwhois, ipinfo] = PROVIDERS;

test("ipapi.is responses keep every anonymizer flag", () => {
  const info = ipapi.normalize(fixture("ipapi-vpn"));
  assert.equal(info.ip, "185.65.135.10");
  assert.equal(info.city, "Stockholm");
  assert.equal(info.region, "Stockholm County");
  assert.equal(info.countryCode, "SE");
  assert.equal(info.isp, "M247 Europe SRL");
  assert.equal(info.asn, 9009);
  assert.equal(info.vpnService, "Mullvad VPN");
  assert.equal(info.datacenterName, "M247 Europe SRL");
  assert.deepEqual(info.flags, {
    vpn: true,
    proxy: false,
    tor: false,
    datacenter: true,
    mobile: false,
    abuser: false
  });
});

test("missing ipapi.is flags become null, not false", () => {
  const info = ipapi.normalize({ ip: "198.51.100.7" });
  assert.equal(info.flags.vpn, null);
  assert.equal(info.flags.datacenter, null);
});

test("ipapi.is error bodies are treated as failures", () => {
  assert.throws(() => ipapi.normalize({ error: "Rate limit exceeded" }), /Rate limit/);
});

test("ipwho.is responses normalize without anonymizer data", () => {
  const info = ipwhois.normalize(fixture("ipwhois"));
  assert.equal(info.isp, "Comcast Cable");
  assert.equal(info.asn, 7922);
  assert.equal(info.timezone, "America/Denver");
  assert.equal(info.flags.vpn, null);
  assert.throws(() => ipwhois.normalize({ success: false, message: "Invalid IP address" }), /Invalid IP/);
});

test("ipinfo.io org strings are split into ASN and name", () => {
  const info = ipinfo.normalize(fixture("ipinfo"));
  assert.equal(info.asn, 7922);
  assert.equal(info.isp, "Comcast Cable Communications, LLC");
  assert.equal(info.country, "United States");
  assert.equal(info.countryCode, "US");
});

test("provider URLs query a specific address when given one", () => {
  assert.equal(ipapi.url("2001:db8::1"), "https://api.ipapi.is/?q=2001%3Adb8%3A%3A1");
  assert.equal(ipapi.url(null), "https://api.ipapi.is/");
  assert.equal(ipwhois.url("198.51.100.7"), "https://ipwho.is/198.51.100.7");
  assert.equal(ipinfo.url("198.51.100.7"), "https://ipinfo.io/198.51.100.7/json");
  assert.equal(ipinfo.url(null), "https://ipinfo.io/json");
});

test("lookupIp falls back to the next provider when one fails", async () => {
  const fetchImpl = fakeFetch({
    "https://api.ipapi.is/": 429,
    "https://ipwho.is/": fixture("ipwhois")
  });
  const info = await lookupIp("198.51.100.7", { fetchImpl });
  assert.equal(info.provider, "ipwho.is");
  assert.equal(info.family, "IPv4");
  assert.equal(fetchImpl.calls.length, 2);
});

test("lookupIp reports every provider failure", async () => {
  const fetchImpl = fakeFetch({ "https://api.ipapi.is/": 500 });
  await assert.rejects(lookupIp(null, { fetchImpl }), (error) => {
    assert.match(error.message, /ipapi\.is: HTTP 500/);
    assert.match(error.message, /ipwho\.is: Failed to fetch/);
    assert.match(error.message, /ipinfo\.io: Failed to fetch/);
    return true;
  });
});

test("lookupIp turns request timeouts into a readable error", async () => {
  const timeout = new DOMException("The operation timed out.", "TimeoutError");
  const fetchImpl = fakeFetch({ "https://": timeout });
  await assert.rejects(lookupIp(null, { fetchImpl }), /timed out after 8s/);
});

test("fetchAddress returns null when the family is unreachable or mismatched", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "198.51.100.7" },
    "https://api6.ipify.org/": { ip: "198.51.100.7" }
  });
  assert.equal(await fetchAddress("IPv4", { fetchImpl }), "198.51.100.7");
  assert.equal(await fetchAddress("IPv6", { fetchImpl }), null);
  assert.equal(await fetchAddress("IPv6", { fetchImpl: fakeFetch({}) }), null);
});

test("ipFamily", () => {
  assert.equal(ipFamily("2001:db8::1"), "IPv6");
  assert.equal(ipFamily("192.0.2.1"), "IPv4");
  assert.equal(ipFamily(null), null);
});

test("API keys are added to the request URLs", () => {
  assert.equal(ipapi.url("192.0.2.1", { ipapi: "abc" }), "https://api.ipapi.is/?q=192.0.2.1&key=abc");
  assert.equal(
    SECOND_OPINION.url("2001:db8::7", { proxycheck: "k" }),
    "https://proxycheck.io/v2/2001:db8::7?vpn=1&asn=1&key=k"
  );
});

test("proxycheck.io verdicts normalize to a second opinion", () => {
  const vpn = { status: "ok", "198.51.100.7": { proxy: "yes", type: "VPN", operator: { name: "Mullvad" } } };
  assert.deepEqual(SECOND_OPINION.normalize(vpn, "198.51.100.7"), {
    provider: "proxycheck.io",
    tunnelled: true,
    label: "VPN (Mullvad)"
  });
  const clean = { status: "ok", "198.51.100.7": { proxy: "no", type: "Residential" } };
  assert.equal(SECOND_OPINION.normalize(clean, "198.51.100.7").tunnelled, false);
  // The key may be normalized differently from the queried address.
  const v6 = { status: "ok", "2001:db8::7": { proxy: "yes", type: "Hosting" } };
  assert.equal(SECOND_OPINION.normalize(v6, "2001:DB8::7").label, "Hosting");
  assert.throws(() => SECOND_OPINION.normalize({ status: "denied", message: "limit" }, "x"), /limit/);
});

test("fetchSecondOpinion returns null instead of failing", async () => {
  assert.equal(await fetchSecondOpinion("192.0.2.1", { fetchImpl: fakeFetch({}) }), null);
});

test("countryName localizes and rejects unknown codes", () => {
  assert.equal(countryName("de"), "Germany");
  assert.equal(countryName("DE", "de"), "Deutschland");
  assert.equal(countryName("QQ"), null);
  assert.equal(countryName(null), null);
});
