// Sanity checks run in CI: the manifest parses as strict JSON, its version
// matches package.json, every file it references exists, no source file
// starts with a UTF-8 byte-order mark, and the translations are complete.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { GENERATED_PATH, renderMessagesModule } from "./build-locales.js";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
const read = (file) => readFileSync(join(root, file), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

if (manifest.version !== pkg.version) {
  errors.push(`manifest.json version ${manifest.version} does not match package.json version ${pkg.version}`);
}

const referenced = [
  manifest.background?.service_worker,
  ...(manifest.background?.scripts ?? []),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources)
].filter(Boolean);

for (const color of ["gray", "green", "red", "blue"]) {
  for (const size of [16, 32, 48, 128]) {
    referenced.push(`icons/icon-${color}-${size}.png`);
  }
}

for (const file of new Set(referenced)) {
  if (!existsSync(join(root, file))) {
    errors.push(`missing file referenced by the extension: ${file}`);
  }
}

const TEXT_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".md"]);
const sources = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path);
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      sources.push(path.slice(root.length));
    }
  }
}
walk(root);

for (const file of sources) {
  const bytes = readFileSync(join(root, file));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    errors.push(`${file} starts with a UTF-8 byte-order mark`);
  }
}

// Translations: every locale has the same keys and placeholders as English,
// and every key the code uses exists.
const placeholders = (message) => [...message.matchAll(/\{\d\}|%s/g)].map((match) => match[0]).sort().join(" ");
const english = JSON.parse(read("_locales/en/messages.json"));
for (const locale of readdirSync(join(root, "_locales"))) {
  const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
  for (const key of Object.keys(english)) {
    if (!messages[key]) {
      errors.push(`_locales/${locale} is missing "${key}"`);
    } else if (placeholders(messages[key].message) !== placeholders(english[key].message)) {
      errors.push(`_locales/${locale} "${key}" has different placeholders from English`);
    } else if (messages[key].message.includes("$")) {
      errors.push(`_locales/${locale} "${key}" contains "$", which chrome.i18n treats specially`);
    }
  }
  for (const key of Object.keys(messages)) {
    if (!english[key]) {
      errors.push(`_locales/${locale} has "${key}", which English lacks`);
    }
  }
}

const usedKeys = new Set();
const extensionFiles = sources.filter(
  (path) => /\.(js|html|json)$/.test(path) && !/^(test|e2e|scripts|_locales)\//.test(path) && path !== "package.json"
);
for (const file of extensionFiles) {
  const text = read(file);
  for (const match of text.matchAll(/\bt\("([A-Za-z0-9]+)"/g)) {
    usedKeys.add(match[1]);
  }
  for (const match of text.matchAll(/data-i18n="([A-Za-z0-9]+)"/g)) {
    usedKeys.add(match[1]);
  }
  for (const match of text.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of match[1].split(",")) {
      usedKeys.add(pair.split(":")[1]?.trim());
    }
  }
  for (const match of text.matchAll(/__MSG_([A-Za-z0-9]+)__/g)) {
    usedKeys.add(match[1]);
  }
}
for (const key of usedKeys) {
  if (!english[key]) {
    errors.push(`message "${key}" is used but not defined in _locales/en/messages.json`);
  }
}
for (const key of Object.keys(english)) {
  if (!usedKeys.has(key)) {
    errors.push(`message "${key}" is defined but never used`);
  }
}

if (readFileSync(GENERATED_PATH, "utf8") !== renderMessagesModule()) {
  errors.push("lib/messages-en.js is out of date; run npm run locales");
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`manifest OK (version ${manifest.version}, ${Object.keys(english).length} messages)`);
