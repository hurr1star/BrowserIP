import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeDnsLeak, runDnsLeakTest } from "../lib/dnsleak.js";

const RESULT = [
  { ip: "185.65.135.10", country: "SE", country_name: "Sweden", asn: "AS9009 M247", type: "ip" },
  { ip: "193.138.218.74", country: "SE", country_name: "Sweden", asn: "AS39351 31173 Services", type: "dns" },
  { ip: "DNS is not leaking.", type: "conclusion" }
];

test("analyzeDnsLeak reads servers and the verdict", () => {
  assert.deepEqual(analyzeDnsLeak(RESULT), {
    servers: [{ ip: "193.138.218.74", country: "Sweden", asn: "AS39351 31173 Services" }],
    yourIps: [{ ip: "185.65.135.10", country: "Sweden", asn: "AS9009 M247" }],
    conclusion: "DNS is not leaking.",
    leaking: false
  });
  assert.equal(analyzeDnsLeak([{ ip: "DNS may be leaking.", type: "conclusion" }]).leaking, true);
  assert.equal(analyzeDnsLeak([]).leaking, null);
  assert.throws(() => analyzeDnsLeak({}), /unexpected response/);
});

test("runDnsLeakTest gets an id, resolves probe names, then fetches the result", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.mode ?? "cors"]);
    if (url === "https://bash.ws/id") {
      return { ok: true, text: async () => "4242\n" };
    }
    if (url === "https://bash.ws/dnsleak/test/4242?json") {
      return { ok: true, json: async () => RESULT };
    }
    throw new TypeError("Failed to fetch");
  };
  const result = await runDnsLeakTest({ fetchImpl });
  assert.equal(result.leaking, false);
  const probes = calls.filter(([url]) => url.endsWith(".4242.bash.ws/"));
  assert.equal(probes.length, 10);
  assert.ok(probes.every(([, mode]) => mode === "no-cors"));
});

test("runDnsLeakTest rejects a malformed id", async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => "<html>" });
  await assert.rejects(runDnsLeakTest({ fetchImpl }), /unexpected test id/);
});
