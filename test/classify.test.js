import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyAddress, summarize } from "../lib/classify.js";
import { PROVIDERS } from "../lib/providers.js";
import { fixture } from "./helpers.js";

const ipapi = PROVIDERS[0];
const vpn = ipapi.normalize(fixture("ipapi-vpn"));
const hosting = ipapi.normalize(fixture("ipapi-datacenter"));
const residential = ipapi.normalize(fixture("ipapi-residential"));
const noFlags = PROVIDERS[1].normalize(fixture("ipwhois"));

test("a VPN address is tunnelled and names the service", () => {
  const result = classifyAddress(vpn);
  assert.equal(result.tunnelled, true);
  assert.deepEqual(result.reasons, ["VPN (Mullvad VPN)"]);
});

test("a hosting address without the VPN flag still counts as tunnelled", () => {
  // Self-hosted WireGuard/OpenVPN servers usually only have is_datacenter set.
  const result = classifyAddress(hosting);
  assert.equal(result.tunnelled, true);
  assert.deepEqual(result.reasons, ["Hosting network (DigitalOcean)"]);
});

test("Tor and proxy flags count as tunnelled", () => {
  const tor = { flags: { vpn: false, proxy: false, tor: true, datacenter: false } };
  const proxy = { flags: { vpn: false, proxy: true, tor: false, datacenter: false } };
  assert.deepEqual(classifyAddress(tor).reasons, ["Tor exit node"]);
  assert.deepEqual(classifyAddress(proxy).reasons, ["Proxy"]);
});

test("a residential address is direct", () => {
  assert.deepEqual(classifyAddress(residential), { tunnelled: false, reasons: [] });
});

test("an address without flag data is unknown", () => {
  assert.equal(classifyAddress(noFlags).tunnelled, null);
  assert.equal(classifyAddress(null).tunnelled, null);
});

function address(info, family = "IPv4") {
  return { ip: info?.ip ?? "192.0.2.1", family, info };
}

test("summarize: all tunnelled, all direct, unknown", () => {
  assert.equal(summarize([address(vpn), address(hosting, "IPv6")]).overall, "tunnelled");
  assert.equal(summarize([address(residential)]).overall, "direct");
  assert.equal(summarize([address(noFlags)]).overall, "unknown");
  assert.equal(summarize([]).overall, "unknown");
});

test("summarize: one family tunnelled and the other direct is a leak", () => {
  const result = summarize([address(vpn), address(residential, "IPv6")]);
  assert.equal(result.overall, "leak");
  assert.equal(result.addresses[1].tunnelled, false);
});

test("summarize ignores addresses whose lookup failed", () => {
  assert.equal(summarize([address(vpn), address(null, "IPv6")]).overall, "tunnelled");
});

test("a second opinion can flag what the first database missed", () => {
  const info = { ...residential, secondOpinion: { provider: "proxycheck.io", tunnelled: true, label: "VPN (Mullvad)" } };
  assert.deepEqual(classifyAddress(info), { tunnelled: true, reasons: ["VPN (Mullvad) (proxycheck.io)"] });
});

test("a second opinion fills in when the first database has no flags", () => {
  const info = { ...noFlags, secondOpinion: { provider: "proxycheck.io", tunnelled: false, label: null } };
  assert.equal(classifyAddress(info).tunnelled, false);
});

test("Mullvad's own check marks its exits as tunnelled", () => {
  const info = { ...residential, mullvad: { exit: true, hostname: "se-got-wg-001", serverType: "WireGuard" } };
  assert.deepEqual(classifyAddress(info), { tunnelled: true, reasons: ["Mullvad (se-got-wg-001, WireGuard)"] });
  // A non-Mullvad answer leaves the decision to the IP databases.
  assert.equal(classifyAddress({ ...vpn, mullvad: { exit: false } }).tunnelled, true);
  assert.equal(classifyAddress({ ...residential, mullvad: { exit: false } }).tunnelled, false);
});
