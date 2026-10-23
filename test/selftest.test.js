import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildChecks,
  formatResults,
  validateDnsLeak,
  validateIpapi,
  validateIpinfo,
  validateIpwhois,
  validateMullvad,
  validateProxycheck
} from "../lib/selftest.js";
import { fakeFetch, fixture } from "./helpers.js";

test("the recorded provider responses pass validation", () => {
  assert.deepEqual(validateIpapi(fixture("ipapi-vpn")), []);
  assert.deepEqual(validateIpapi(fixture("ipapi-residential")), []);
  assert.deepEqual(validateIpwhois(fixture("ipwhois")), []);
  assert.deepEqual(validateIpinfo(fixture("ipinfo")), []);
  assert.deepEqual(validateMullvad(fixture("mullvad-exit")), []);
  assert.deepEqual(validateProxycheck({ status: "ok", "192.0.2.1": { proxy: "no" } }, "192.0.2.1"), []);
  assert.deepEqual(
    validateDnsLeak([
      { ip: "193.138.218.74", type: "dns" },
      { ip: "DNS is not leaking.", type: "conclusion" }
    ]),
    []
  );
});

test("validators name exactly what changed", () => {
  const renamed = { ...fixture("ipapi-vpn"), is_vpn: undefined, vpn_detected: true };
  assert.deepEqual(validateIpapi(renamed), ["is_vpn"]);
  assert.deepEqual(validateIpapi({}), [
    "ip",
    "is_vpn",
    "is_proxy",
    "is_tor",
    "is_datacenter",
    "is_abuser",
    "location.country_code",
    "asn.asn"
  ]);
  assert.deepEqual(validateMullvad({ ip: "x", mullvad_exit_ip: "yes" }), ["mullvad_exit_ip", "blacklisted.blacklisted"]);
  assert.deepEqual(validateProxycheck({ status: "denied" }, "192.0.2.1"), ["status", "192.0.2.1.proxy"]);
  assert.deepEqual(validateDnsLeak({}), ["array of results"]);
});

test("checks pass, note and fail as appropriate", async () => {
  const fetchImpl = fakeFetch({
    "https://api4.ipify.org/": { ip: "185.65.135.10" },
    "https://api.ipapi.is/": fixture("ipapi-vpn"),
    "https://ipwho.is/": fixture("ipwhois"),
    "https://ipinfo.io/": { ip: "185.65.135.10", country: "SE", org: "M247 without AS prefix" },
    "https://ipv4.am.i.mullvad.net/json": fixture("mullvad-exit")
  });
  const checks = Object.fromEntries(buildChecks({ fetchImpl }).map((check) => [check.id, check]));

  assert.deepEqual(await checks.ipify4.run(), {
    status: "pass",
    summary: "185.65.135.10",
    raw: JSON.stringify({ ip: "185.65.135.10" }, null, 2)
  });
  assert.equal((await checks.ipify6.run()).status, "info");
  const ipapi = await checks.ipapi.run();
  assert.equal(ipapi.status, "pass");
  assert.equal(ipapi.summary, "185.65.135.10 · SE · AS9009 · is_vpn=true");
  assert.equal((await checks.ipwhois.run()).status, "pass");
  const ipinfo = await checks.ipinfo.run();
  assert.equal(ipinfo.status, "fail");
  assert.equal(ipinfo.summary, "Unexpected response; missing: org (AS… name)");
  assert.match((await checks.mullvadIPv4.run()).summary, /mullvad_exit_ip=true \(se-got-wg-001\)/);
  assert.equal((await checks.mullvadIPv6.run()).status, "info");
});

test("formatResults produces a shareable summary", () => {
  const text = formatResults(
    [
      { name: "ipapi.is", status: "pass", summary: "ok" },
      { name: "bash.ws", status: "fail", summary: "timed out after 8s" }
    ],
    { version: "1.3.0", userAgent: "UA" }
  );
  assert.equal(text, "BrowserIP 1.3.0 self-test\nUA\n\n[PASS] ipapi.is: ok\n[FAIL] bash.ws: timed out after 8s");
});
