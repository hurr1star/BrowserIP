# BrowserIP

BrowserIP is a browser extension (Chrome, Edge and other Chromium browsers, plus Firefox) that shows your browser's public IP and network details in one click. It keeps a toolbar icon in sync with your VPN status, and warns when the VPN is off or leaking.

## What It Does

- Shows your browser's public IPv4 and IPv6 addresses, location, provider, ASN and time zone
- Detects VPN, proxy, Tor and hosting-network exits, and names the VPN service when known
- Detects **IPv6 leaks**: IPv4 goes through the tunnel but IPv6 doesn't
- **WebRTC leak test**: checks whether WebRTC exposes a different public address than your browser
- Re-checks in the background and greys the icon out when the result is too old to trust
- Sends a desktop notification when the VPN connects, disconnects or leaks, or your IP changes
- Falls back to other lookup providers if the main one is down or rate-limited
- Click the IP to copy it

## Toolbar Icon

| Icon | Badge | Meaning |
| --- | --- | --- |
| Green | country code | Traffic exits through a VPN, proxy, Tor or hosting network |
| Red | `OFF` | No VPN detected and you said you expect one |
| Red | `LEAK` | One IP family is tunnelled and the other is not |
| Blue | country code | Direct connection, and you don't expect a VPN |
| Gray | `?` | Unknown, not checked yet, last check failed, or result out of date |

Alert states always carry badge text, so they don't rely on colour alone. Hover over the icon for the full status.

## Settings

Open the gear in the popup (or the extension's **Options**):

- **I expect to be on a VPN** (default on): show the red icon and warning when no VPN is detected.
- **Background checks** (default every 5 minutes; off to 60 minutes).
- **Notify on change** (default on).
- **Country code badge** (default on).
- **Check IPv6 separately** (default on).

## How Checks Work

1. ipify reports the browser's public IPv4 and IPv6 addresses.
2. If the addresses are unchanged and the last full lookup is less than 6 hours old, that lookup is reused. This keeps background checks well within ipapi.is's free quota (about 1,000 lookups a day without a key).
3. Otherwise each address is looked up with ipapi.is, falling back to ipwho.is and then ipinfo.io. The fallbacks have no VPN data, so the status shows as unknown.
4. An address counts as tunnelled when ipapi.is flags it as VPN, proxy, Tor or a hosting network. Self-hosted VPNs on a cloud server are usually flagged only as hosting.
5. The result is stored and drives the popup, the icon and notifications.

Opening the popup runs a check, and **Refresh** forces a full lookup. Every request has an 8-second timeout. If a check fails, the popup keeps showing the last result, marked as out of date.

The IP shown is the address your *browser* uses. If the browser goes through a proxy, it can differ from the rest of your system.

## Architecture

```text
BrowserIP/
  manifest.json        # MV3 manifest (Chrome + Firefox)
  background.js        # Runs checks, owns state, icon/badge, alarms, notifications
  popup.html/.css/.js  # Popup: renders stored state, refresh, copy, WebRTC test
  options.html/.css/.js# Settings page
  theme.css            # Shared colours, fonts, buttons, reduced-motion rules
  lib/
    providers.js       # Provider URLs, response normalization, fallback, timeouts
    classify.js        # Per-address and overall verdicts (tunnelled/direct/leak/unknown)
    check.js           # One check: address discovery, lookup caching, error handling
    indicator.js       # Icon colour, badge, tooltip, warning, staleness, change notifications
    settings.js        # Defaults and validation
    webrtc.js          # ICE candidate gathering and leak analysis
    format.js          # Display helpers
  icons/               # gray/green/red/blue × 16/32/48/128
  test/                # node:test unit tests with recorded provider responses
  scripts/             # Manifest checks and release packaging
```

The background service worker is the only code that runs checks. The popup asks it to refresh and redraws whenever the stored state changes.

## Installation (Developer Mode)

**Chrome / Edge**

1. Go to `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension.

**Firefox (121+)**

1. Go to `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
2. Select `manifest.json`.
3. Firefox treats MV3 host permissions as opt-in. Allow the lookup sites under the extension's **Permissions** tab.

## Development

```sh
npm install
npm test         # unit tests (node:test, no browser needed)
npm run lint     # ESLint
npm run check    # manifest/version/file-reference/BOM checks
npm run package  # builds dist/browserip-<version>.zip
```

CI runs all of these on every push and pull request. Pushing a `v*` tag that matches the manifest version publishes a GitHub release with the packaged zip.

## Privacy

There is no analytics, telemetry or server of our own. The extension contacts only the IP lookup services, plus STUN servers when you run the WebRTC test. See [PRIVACY.md](PRIVACY.md) for exactly what is sent and stored.

## Limitations

- VPN detection depends on ipapi.is's IP reputation data, not on inspecting your local network.
- DNS leaks aren't detected: an extension can't see which resolver the browser uses.
- Chrome may delay background checks while the browser is idle or asleep. The icon greys out rather than showing an outdated result.

## License

[MIT](LICENSE)
