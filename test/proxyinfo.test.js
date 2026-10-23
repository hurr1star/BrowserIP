import assert from "node:assert/strict";
import { test } from "node:test";

import { describeProxySettings } from "../lib/proxyinfo.js";

test("Chrome proxy settings", () => {
  assert.equal(describeProxySettings({ value: { mode: "system" } }), "System settings");
  assert.equal(
    describeProxySettings({
      value: { mode: "fixed_servers", rules: { singleProxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 } } },
      levelOfControl: "controlled_by_other_extensions"
    }),
    "Fixed: socks5://127.0.0.1:1080 (set by another extension)"
  );
  assert.equal(
    describeProxySettings({ value: { mode: "pac_script", pacScript: { url: "http://wpad/wpad.dat" } } }),
    "PAC script (http://wpad/wpad.dat)"
  );
  assert.equal(describeProxySettings({ value: { mode: "pac_script", pacScript: { data: "..." } } }), "PAC script (inline)");
});

test("Firefox proxy settings", () => {
  assert.equal(describeProxySettings({ value: { proxyType: "none" } }), "None (direct)");
  assert.equal(
    describeProxySettings({ value: { proxyType: "manual", socks: "127.0.0.1:9050", socksVersion: 5 } }),
    "Fixed: socks5://127.0.0.1:9050"
  );
  assert.equal(describeProxySettings({ value: { proxyType: "manual", http: "proxy:3128" } }), "Fixed: proxy:3128");
});
