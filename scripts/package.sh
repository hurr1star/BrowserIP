#!/usr/bin/env bash
# Builds dist/browserip-<version>.zip containing only the files the browser loads.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p 'require("./manifest.json").version')
out="dist/browserip-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -qr "$out" manifest.json ./*.html ./*.css ./*.js lib icons _locales -x eslint.config.js
echo "$out"
