import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_HISTORY, appendHistory, historyEntry, historyToCsv } from "../lib/history.js";

const NOW = Date.UTC(2026, 9, 23, 12, 0);
const state = {
  ok: true,
  overall: "tunnelled",
  addresses: [{ ip: "192.0.2.1", info: { countryCode: "SE", isp: "M247, Ltd" } }]
};

test("logs changes, the first check and new failures", () => {
  const change = { title: "VPN connected", message: "192.0.2.1" };
  assert.deepEqual(historyEntry(state, state, change, NOW), {
    at: NOW,
    overall: "tunnelled",
    ips: ["192.0.2.1"],
    countryCode: "SE",
    isp: "M247, Ltd",
    title: "VPN connected",
    message: "192.0.2.1"
  });
  assert.equal(historyEntry(null, state, null, NOW).title, "First check");
  const failed = { ...state, ok: false, error: "offline" };
  assert.equal(historyEntry(state, failed, null, NOW).title, "Check failed");
  assert.equal(historyEntry(failed, failed, null, NOW), null);
  assert.equal(historyEntry(state, state, null, NOW), null);
});

test("history keeps the newest entries", () => {
  let history = [];
  for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
    history = appendHistory(history, { at: index });
  }
  assert.equal(history.length, MAX_HISTORY);
  assert.equal(history[0].at, MAX_HISTORY + 4);
  assert.deepEqual(appendHistory(undefined, { at: 1 }), [{ at: 1 }]);
});

test("CSV export quotes fields that need it", () => {
  const entry = historyEntry(state, state, { title: "VPN connected", message: 'say "hi"' }, NOW);
  assert.equal(
    historyToCsv([entry]),
    'time,event,details,status,ips,country,provider\r\n2026-10-23T12:00:00.000Z,VPN connected,"say ""hi""",tunnelled,192.0.2.1,SE,"M247, Ltd"\r\n'
  );
});
