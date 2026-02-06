# BrowserIP

BrowserIP is a Chromium extension that surfaces your current public IP and quick network context in one click, with a persistent toolbar icon signal tied to VPN detection state.

## What It Does

- Fetches your public IP from `https://api.ipapi.is/`
- Shows city/state, country, provider/ASN organization, and VPN detection status
- Updates the extension action icon color based on VPN status
- Shows a warning banner when VPN is **not** detected
- Supports manual refresh from the popup

## Why This Project Is Useful

When you need a fast operational check (for example before opening region-restricted services, validating a VPN tunnel, or confirming exit routing), BrowserIP gives a compact signal set:

- Popup details for quick triage
- Toolbar icon as a persistent at-a-glance state

This reduces context switching versus opening external "what is my IP" pages repeatedly.

## Architecture Overview

- `manifest.json`
  - Manifest V3 config
  - Registers service worker (`background.js`)
  - Declares popup (`popup.html`)
  - Allows host access to `https://api.ipapi.is/*`
- `popup.html` + `popup.css`
  - UI shell and cyber-style presentation
- `popup.js`
  - Fetches API data
  - Maps response fields into UI
  - Sends `vpnStatus` messages to background script
- `background.js`
  - Listens for `vpnStatus`
  - Sets icon set: `green` (VPN detected), `red` (VPN not detected), `gray` (unknown/default)

## Data Flow

1. User opens popup (or presses Refresh).
2. `popup.js` requests `https://api.ipapi.is/` with `cache: "no-store"`.
3. Response is rendered in popup fields.
4. VPN state is posted via `chrome.runtime.sendMessage`.
5. `background.js` updates the extension icon paths.

If the request fails, fields are set to `Unavailable`, status text explains the error, and icon state returns to neutral (`gray`).

## Installation (Developer Mode)

1. Open Chrome/Edge and go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (`BrowserIP`).
5. Pin the extension and open the popup.

## Behavior and Semantics

- `VPN: Detected` -> green icon, warning hidden
- `VPN: Not detected` -> red icon, warning shown
- `VPN: Unknown` or fetch failure -> gray icon / neutral state

The red warning is intentionally strong and action-oriented for users who expect a VPN to be active.

## Privacy Notes

- The extension sends one outbound request to `api.ipapi.is` when popup loads and on refresh.
- No local storage or sync storage is used.
- No analytics or telemetry code exists in this repository.

## Limitations

- VPN detection accuracy depends entirely on the upstream provider (`ipapi.is`), not local tunnel inspection.
- Browser icon state updates only after popup-triggered fetches (no periodic background polling).
- Current implementation targets Chromium extension APIs (`chrome.*`).

## Project Structure

```text
BrowserIP/
  background.js      # Service worker: icon state management
  manifest.json      # MV3 metadata + permissions + entry points
  popup.html         # Popup markup
  popup.css          # Popup styling
  popup.js           # Fetch/render/message logic
  icons/             # Gray/green/red icon variants (16/32/48/128)
```

## Possible Next Improvements

- Add timestamp of last successful check
- Add optional auto-refresh interval (user-configurable)
- Add response field normalization for additional provider metadata
- Add lightweight tests for popup render mapping and status transitions
