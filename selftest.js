import { localizePage, t } from "./lib/i18n.js";
import { buildChecks, formatResults } from "./lib/selftest.js";
import { applyTheme, loadSettings } from "./lib/settings.js";

const list = document.getElementById("results");
const runButton = document.getElementById("run");
const copyButton = document.getElementById("copy");
const statusEl = document.getElementById("status");
const STATUS_TEXT = {
  pending: () => t("selftestPending"),
  running: () => t("selftestRunning"),
  pass: () => t("selftestPass"),
  fail: () => t("selftestFail"),
  info: () => t("selftestInfo"),
  skip: () => t("selftestSkip")
};
let results = [];

function renderRow(item, check, result) {
  const status = result?.status ?? check.state;
  item.className = `selftest-item is-${status}`;
  item.replaceChildren();
  const head = document.createElement("div");
  head.className = "selftest-head";
  const name = document.createElement("strong");
  name.textContent = check.name;
  const badge = document.createElement("span");
  badge.className = "selftest-status";
  badge.textContent = STATUS_TEXT[status]();
  head.append(name, badge);
  item.append(head);
  if (result?.summary) {
    const summary = document.createElement("p");
    summary.className = "selftest-summary";
    summary.textContent = result.summary;
    item.append(summary);
  }
  if (result?.raw) {
    const details = document.createElement("details");
    const label = document.createElement("summary");
    label.textContent = t("selftestRaw");
    const pre = document.createElement("pre");
    pre.textContent = result.raw;
    details.append(label, pre);
    item.append(details);
  }
}

async function run() {
  runButton.disabled = true;
  copyButton.disabled = true;
  statusEl.textContent = "";
  results = [];
  const checks = buildChecks();
  const items = checks.map((check) => {
    check.state = "pending";
    const item = document.createElement("li");
    renderRow(item, check);
    return item;
  });
  list.replaceChildren(...items);

  for (const [index, check] of checks.entries()) {
    check.state = "running";
    renderRow(items[index], check);
    let result;
    try {
      result = await check.run();
    } catch (error) {
      result = { status: "fail", summary: error.message, raw: "" };
    }
    results.push({ name: check.name, ...result });
    renderRow(items[index], check, result);
  }

  const failed = results.filter((result) => result.status === "fail").length;
  statusEl.textContent = failed ? t("selftestDoneFailed", failed) : t("selftestDoneOk");
  runButton.disabled = false;
  copyButton.disabled = false;
}

copyButton.addEventListener("click", async () => {
  const text = formatResults(results, {
    version: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent
  });
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = t("selftestCopied");
  } catch (_error) {
    statusEl.textContent = t("copyFailed");
  }
});

runButton.addEventListener("click", run);
localizePage();
loadSettings().then(applyTheme);
