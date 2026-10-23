import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  callHelper,
  describeAppStatus,
  fetchMullvadCheck,
  mullvadReason,
  normalizeMullvadCheck,
  waitForAppState
} from "../lib/mullvad.js";
import { fakeFetch, fixture } from "./helpers.js";

afterEach(() => {
  delete globalThis.chrome;
});

test("normalizes am.i.mullvad.net responses", () => {
  assert.deepEqual(normalizeMullvadCheck(fixture("mullvad-exit")), {
    ip: "185.65.135.10",
    exit: true,
    hostname: "se-got-wg-001",
    serverType: "WireGuard",
    blacklisted: true,
    blacklists: ["Spamhaus"]
  });
  const home = normalizeMullvadCheck({ ip: "2001:DB8::7", mullvad_exit_ip: false, blacklisted: { blacklisted: false } });
  assert.equal(home.ip, "2001:db8::7");
  assert.equal(home.exit, false);
  assert.equal(home.blacklisted, false);
  assert.deepEqual(home.blacklists, []);
  assert.throws(() => normalizeMullvadCheck({}), /no IP address/);
});

test("fetchMullvadCheck asks the family-specific endpoint and tolerates failures", async () => {
  const fetchImpl = fakeFetch({ "https://ipv4.am.i.mullvad.net/json": fixture("mullvad-exit") });
  assert.equal((await fetchMullvadCheck("IPv4", { fetchImpl })).hostname, "se-got-wg-001");
  assert.equal(await fetchMullvadCheck("IPv6", { fetchImpl }), null);
});

test("mullvadReason names the server and protocol", () => {
  assert.equal(mullvadReason({ hostname: "se-got-wg-001", serverType: "WireGuard" }), "Mullvad (se-got-wg-001, WireGuard)");
  assert.equal(mullvadReason({}), "Mullvad");
});

test("describeAppStatus", () => {
  assert.equal(
    describeAppStatus({ state: "connected", relay: "se-got-wg-001", location: "Sweden, Gothenburg" }),
    "Connected · se-got-wg-001 · Sweden, Gothenburg"
  );
  assert.equal(describeAppStatus({ state: "connected" }), "Connected");
  assert.equal(describeAppStatus({ state: "disconnected" }), "Disconnected");
  assert.equal(describeAppStatus({ state: "blocked" }), "Blocking traffic (no tunnel)");
  assert.equal(describeAppStatus(null), "Unknown state");
});

function fakeHelper(handler) {
  const sent = [];
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async (name, message) => {
        sent.push([name, message]);
        return handler(message);
      }
    }
  };
  return sent;
}

test("callHelper sends to the BrowserIP host and unwraps errors", async () => {
  const sent = fakeHelper((message) =>
    message.cmd === "connect" ? { ok: false, error: "mullvad connect: account expired" } : { ok: true, state: "disconnected" }
  );
  assert.equal((await callHelper("status")).state, "disconnected");
  await assert.rejects(callHelper("connect"), /account expired/);
  assert.deepEqual(sent[0], ["io.github.hurr1star.browserip", { cmd: "status" }]);
});

test("callHelper explains a missing helper", async () => {
  globalThis.chrome = {
    runtime: {
      sendNativeMessage: async () => {
        throw new Error("Specified native messaging host not found.");
      }
    }
  };
  await assert.rejects(callHelper("status"), /helper isn't installed/);
});

test("waitForAppState polls until the target is reached", async () => {
  const states = ["connecting", "connecting", "connected"];
  fakeHelper(() => ({ ok: true, state: states.shift() ?? "connected", relay: "se-got-wg-001" }));
  const status = await waitForAppState(["connected"], { intervalMs: 1 });
  assert.equal(status.state, "connected");

  fakeHelper(() => ({ ok: true, state: "connected", relay: "de-fra-wg-001" }));
  const moved = await waitForAppState((s) => s.relay.startsWith("de-"), { intervalMs: 1 });
  assert.equal(moved.relay, "de-fra-wg-001");

  fakeHelper(() => ({ ok: true, state: "connecting" }));
  await assert.rejects(waitForAppState(["connected"], { timeoutMs: 20, intervalMs: 5 }), /didn't finish in time/);
});
