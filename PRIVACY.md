# BrowserIP privacy policy

BrowserIP has no server of its own and collects no analytics or telemetry. It does not read your browsing history or page content.

## What leaves your browser

To show your public IP, the extension sends requests to these third-party services. Each one necessarily sees your IP address, because that is what it reports on:

| Service | When | Purpose |
| --- | --- | --- |
| `api4.ipify.org`, `api6.ipify.org` | Each check (popup open, Refresh, background checks, waking up) | Find your public IPv4 and IPv6 addresses |
| `api.ipapi.is` | When your address changes, every 6 hours, on Refresh, or when you look up an IP | Location, provider and VPN/proxy/Tor/hosting flags |
| `proxycheck.io` | Same as above, only for addresses ipapi.is didn't flag (can be turned off) | Second opinion on VPN/proxy status |
| `ipwho.is`, `ipinfo.io` | Only if `api.ipapi.is` fails | Fallback location and provider lookup |
| `stun.l.google.com`, `stun.cloudflare.com` | Only when you run the **WebRTC test** | See which address WebRTC exposes |
| `bash.ws` | Only when you run the **DNS leak test** | See which DNS servers resolve your lookups |
| `ipv4.am.i.mullvad.net`, `ipv6.am.i.mullvad.net` | Only if you chose Mullvad as your VPN; on full lookups | Whether you exit through a Mullvad server, and its blocklist status |

IP addresses you look up yourself (in the popup or from the context menu) are sent to the same lookup services. Requests are sent without cookies. If you enter API keys, they are sent to their own service only. Each service's own privacy policy applies to what it receives.

## What is stored

On your device only (`chrome.storage.local`):

- the last check result (addresses and lookup details);
- your connection history (up to 200 events), until you clear it;
- your API keys, if you enter any.

Synced between your own devices by your browser (`chrome.storage.sync`):

- your settings, including your protected-site list and expected country/provider.

Removing the extension deletes all of it.

## Permissions

| Permission | Why |
| --- | --- |
| Lookup service hosts | Make the requests listed above |
| `alarms`, `idle` | Run background checks, and check right after the computer wakes up |
| `notifications` | Tell you when your VPN status or IP changes |
| `storage` | Keep the data listed above |
| `contextMenus` | *Look up "…" with BrowserIP* on selected text |
| `declarativeNetRequest` | Hold back protected sites while the VPN is not confirmed |
| Optional: access to a protected site | Show an explanation page instead of a plain block for that site |
| Optional: `nativeMessaging` | Talk to the BrowserIP helper, only if you set it up (Mullvad one-click connect) |

## The Mullvad helper

The optional helper runs on your computer, and only when BrowserIP talks to it. It has no network access of its own and stores nothing. It runs Mullvad's command-line tool for a fixed set of commands: status, connect, disconnect, reconnect, set location, list servers and version.
