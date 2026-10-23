// Sanity checks run in CI: the manifest parses as strict JSON, its version
// matches package.json, every file it references exists, and no source file
// starts with a UTF-8 byte-order mark.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (manifest.version !== pkg.version) {
  errors.push(`manifest.json version ${manifest.version} does not match package.json version ${pkg.version}`);
}

const referenced = [
  manifest.background?.service_worker,
  ...(manifest.background?.scripts ?? []),
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {})
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
function checkBom(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      checkBom(path);
    } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
      const bytes = readFileSync(path);
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        errors.push(`${path.slice(root.length)} starts with a UTF-8 byte-order mark`);
      }
    }
  }
}
checkBom(root);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`manifest OK (version ${manifest.version})`);
