import { formatDateTime } from "./lib/format.js";
import { historyToCsv } from "./lib/history.js";
import { localizePage, t } from "./lib/i18n.js";
import { applyTheme, loadSettings } from "./lib/settings.js";

const rows = document.getElementById("rows");
let history = [];

function render() {
  rows.replaceChildren();
  document.getElementById("empty").hidden = history.length > 0;
  for (const entry of history) {
    const row = document.createElement("tr");
    const cells = [formatDateTime(entry.at), entry.title, entry.message];
    cells.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value ?? "";
      if (index === 1) {
        cell.className = "event";
      }
      row.append(cell);
    });
    rows.append(row);
  }
}

async function load() {
  ({ history = [] } = await chrome.storage.local.get("history"));
  render();
}

document.getElementById("exportCsv").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([historyToCsv(history)], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `browserip-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document.getElementById("clearHistory").addEventListener("click", async () => {
  if (confirm(t("historyClearConfirm"))) {
    await chrome.storage.local.set({ history: [] });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.history) {
    history = changes.history.newValue ?? [];
    render();
  }
});

localizePage();
loadSettings().then(applyTheme);
load();
