import assert from "node:assert/strict";
import { test } from "node:test";

import { blockedTarget, buildGuardRules, siteOrigins } from "../lib/guard.js";

const PAGE = "chrome-extension://abc/blocked.html";

test("sites with access redirect to the explanation page; others are blocked", () => {
  const rules = buildGuardRules(["bank.example", "mail.example"], ["bank.example"], PAGE);
  assert.deepEqual(rules[0], {
    id: 1,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${PAGE}#\\0` } },
    condition: { regexFilter: "^.*$", requestDomains: ["bank.example"], resourceTypes: ["main_frame", "sub_frame"] }
  });
  assert.deepEqual(rules[1], {
    id: 2,
    priority: 1,
    action: { type: "block" },
    condition: { requestDomains: ["mail.example"], resourceTypes: ["main_frame", "sub_frame"] }
  });
});

test("site permissions cover the domain and its subdomains", () => {
  assert.deepEqual(siteOrigins("example.com"), ["*://example.com/*", "*://*.example.com/*"]);
});

test("blockedTarget only returns web URLs", () => {
  assert.equal(blockedTarget("#https://bank.example/a?b=1#frag").href, "https://bank.example/a?b=1#frag");
  assert.equal(blockedTarget("#javascript:alert(1)"), null);
  assert.equal(blockedTarget("#"), null);
});
