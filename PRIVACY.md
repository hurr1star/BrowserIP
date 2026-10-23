# BrowserIP privacy policy

BrowserIP has no server of its own and collects no analytics or telemetry. It does not read your browsing history or page content.

## What leaves your browser

To show your public IP, the extension sends requests to these third-party services. Each one necessarily sees your IP address, because that is what it reports back:

| Service | When | Purpose |
| --- | --- | --- |
| `api4.ipify.org`, `api6.ipify.org` | Each check (popup open, Refresh, background checks) | Find your public IPv4 and IPv6 addresses |
| `api.ipapi.is` | When your address changes, every 6 hours, or on Refresh | Location, provider and VPN/proxy/Tor/hosting flags |
| `ipwho.is`, `ipinfo.io` | Only if `api.ipapi.is` fails | Fallback location and provider lookup |
| `stun.l.google.com`, `stun.cloudflare.com` | Only when you press **WebRTC leak test** | See which address WebRTC exposes |

Requests are sent without cookies. Their own privacy policies apply to the data these services receive.

## What is stored

- The last check result (addresses and lookup details) in `chrome.storage.local`, on your device only.
- Your settings in `chrome.storage.sync`, which your browser may sync between your own devices.

Removing the extension deletes both.
