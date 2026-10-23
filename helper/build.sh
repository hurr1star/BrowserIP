#!/usr/bin/env bash
# Builds release archives of the helper for every supported platform into
# ../dist/helper/.
set -euo pipefail
cd "$(dirname "$0")"

out="../dist/helper"
rm -rf "$out"
mkdir -p "$out"

for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  os="${target%/*}"
  arch="${target#*/}"
  name="browserip-helper-$os-$arch"
  stage="$out/$name"
  mkdir -p "$stage"
  binary="browserip-helper"
  [ "$os" = windows ] && binary="browserip-helper.exe"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags="-s -w" -o "$stage/$binary" .
  cp README.md "$stage/"
  if [ "$os" = windows ]; then
    cp install.ps1 "$stage/"
    (cd "$out" && zip -qr "$name.zip" "$name")
  else
    cp install.sh "$stage/"
    tar -czf "$out/$name.tar.gz" -C "$out" "$name"
  fi
  rm -rf "$stage"
done
ls "$out"
