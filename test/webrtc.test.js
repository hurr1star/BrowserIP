import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeCandidates, parseCandidate } from "../lib/webrtc.js";

const HOST_MDNS = "candidate:1 1 udp 2122260223 4f2c1d2e-8a1b-4c3d-9e0f-123456789abc.local 54400 typ host generation 0";
const HOST_REAL = "candidate:2 1 udp 2122260223 192.168.1.20 54401 typ host generation 0";
const SRFLX_VPN = "candidate:3 1 udp 1686052607 185.65.135.10 54402 typ srflx raddr 0.0.0.0 rport 0";
const SRFLX_ISP = "candidate:4 1 udp 1686052607 198.51.100.7 54403 typ srflx raddr 0.0.0.0 rport 0";
const SRFLX_V6 = "candidate:5 1 udp 1686052607 2001:DB8::7 54404 typ srflx raddr :: rport 0";

test("parseCandidate reads the address and type", () => {
  assert.deepEqual(parseCandidate(SRFLX_VPN), { address: "185.65.135.10", type: "srflx" });
  assert.deepEqual(parseCandidate(`a=${HOST_REAL}`), { address: "192.168.1.20", type: "host" });
  assert.equal(parseCandidate("garbage"), null);
});

test("no leak when WebRTC exposes only the browser's own address", () => {
  const result = analyzeCandidates([HOST_MDNS, SRFLX_VPN], ["185.65.135.10"]);
  assert.deepEqual(result, { publicIps: ["185.65.135.10"], localIps: [], leaked: [] });
});

test("a STUN-visible address that differs from the browser IP is a leak", () => {
  const result = analyzeCandidates([SRFLX_VPN, SRFLX_ISP], ["185.65.135.10"]);
  assert.deepEqual(result.leaked, ["198.51.100.7"]);
});

test("IPv6 addresses compare case-insensitively", () => {
  assert.deepEqual(analyzeCandidates([SRFLX_V6], ["2001:db8::7"]).leaked, []);
});

test("unobfuscated host addresses are reported as local", () => {
  assert.deepEqual(analyzeCandidates([HOST_REAL, HOST_MDNS], []).localIps, ["192.168.1.20"]);
});
