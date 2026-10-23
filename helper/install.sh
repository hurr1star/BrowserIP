#!/usr/bin/env bash
# Installs (or removes) the BrowserIP helper for the current user on macOS
# and Linux, and registers it with every installed Chromium-based browser
# and Firefox.
#
#   ./install.sh --extension-id <id>   # id from chrome://extensions
#   ./install.sh --uninstall
set -euo pipefail

HOST_NAME="io.github.hurr1star.browserip"
FIREFOX_ID="browserip@hurr1star.github.io"
here="$(cd "$(dirname "$0")" && pwd)"
binary="$here/browserip-helper"
extension_id=""
uninstall=false

while [ $# -gt 0 ]; do
  case "$1" in
    --extension-id) extension_id="${2:-}"; shift 2 ;;
    --binary) binary="${2:-}"; shift 2 ;;
    --uninstall) uninstall=true; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -n "$extension_id" ] && ! [[ "$extension_id" =~ ^[a-p]{32}$ ]]; then
  echo "That doesn't look like an extension ID (32 letters a-p). Copy it from chrome://extensions." >&2
  exit 2
fi

case "$(uname -s)" in
  Darwin)
    install_dir="$HOME/Library/Application Support/BrowserIP"
    support="$HOME/Library/Application Support"
    chromium_dirs=("Google/Chrome" "Google/Chrome Beta" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Vivaldi")
    chromium_root="$support"
    firefox_dir="$support/Mozilla/NativeMessagingHosts"
    ;;
  Linux)
    install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/browserip"
    chromium_root="${XDG_CONFIG_HOME:-$HOME/.config}"
    chromium_dirs=("google-chrome" "google-chrome-beta" "chromium" "BraveSoftware/Brave-Browser" "microsoft-edge" "vivaldi")
    firefox_dir="$HOME/.mozilla/native-messaging-hosts"
    ;;
  *)
    echo "Unsupported system; on Windows use install.ps1." >&2
    exit 2
    ;;
esac

manifest_name="$HOST_NAME.json"

if $uninstall; then
  for dir in "${chromium_dirs[@]}"; do
    rm -f "$chromium_root/$dir/NativeMessagingHosts/$manifest_name"
  done
  rm -f "$firefox_dir/$manifest_name"
  rm -rf "$install_dir"
  echo "BrowserIP helper removed."
  exit 0
fi

if [ ! -f "$binary" ]; then
  echo "Helper binary not found at $binary" >&2
  exit 1
fi

mkdir -p "$install_dir"
installed="$install_dir/browserip-helper"
cp "$binary" "$installed"
chmod 755 "$installed"
if [ "$(uname -s)" = Darwin ]; then
  # Downloaded files are quarantined, and a quarantined helper can't start.
  xattr -d com.apple.quarantine "$installed" 2>/dev/null || true
fi

registered=()
if [ -n "$extension_id" ]; then
  for dir in "${chromium_dirs[@]}"; do
    # Only register with browsers that are actually installed.
    [ -d "$chromium_root/$dir" ] || continue
    mkdir -p "$chromium_root/$dir/NativeMessagingHosts"
    cat > "$chromium_root/$dir/NativeMessagingHosts/$manifest_name" <<JSON
{
  "name": "$HOST_NAME",
  "description": "BrowserIP helper for the Mullvad VPN app",
  "path": "$installed",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$extension_id/"]
}
JSON
    registered+=("$dir")
  done
fi

if [ -d "$(dirname "$firefox_dir")" ]; then
  mkdir -p "$firefox_dir"
  cat > "$firefox_dir/$manifest_name" <<JSON
{
  "name": "$HOST_NAME",
  "description": "BrowserIP helper for the Mullvad VPN app",
  "path": "$installed",
  "type": "stdio",
  "allowed_extensions": ["$FIREFOX_ID"]
}
JSON
  registered+=("Firefox")
fi

echo "Installed $installed"
if [ ${#registered[@]} -eq 0 ]; then
  echo "No supported browser found. For Chrome, Edge or Brave, pass --extension-id <id>." >&2
  exit 1
fi
printf 'Registered with: %s\n' "${registered[*]}"
echo "Now open BrowserIP's settings and press \"Test helper\"."
