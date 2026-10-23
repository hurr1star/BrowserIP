# BrowserIP

BrowserIP is a browser extension (Chrome, Edge and other Chromium browsers, plus Firefox) that shows your browser's public IP and network details in one click. It keeps a toolbar icon in sync with your VPN status and warns when the VPN is off, leaking, or exiting somewhere you didn't expect.

Available in English, German and Spanish.

## What It Does

**Status**
- Shows your browser's public IPv4 and IPv6 addresses, location, provider, ASN and time zone
- Detects VPN, proxy, Tor and hosting-network exits, and names the VPN service when known
- Asks a second VPN database (proxycheck.io) before declaring "no VPN", to cut false alarms
- Alerts when the VPN exits in the wrong country or through the wrong provider
- Shows the browser's own proxy settings (optional)

**Leak tests**
- **IPv6 leaks**: IPv4 goes through the tunnel but IPv6 doesn't
- **WebRTC leaks**: WebRTC exposes a different public address than your browser
- **DNS leaks**: your DNS lookups go to servers outside the VPN

**Staying informed**
- Background checks, plus an immediate check when the computer wakes up or comes back online
- The icon greys out when the result is too old to trust
- Desktop notifications when the VPN connects, disconnects, leaks or exits somewhere unexpected, or your IP changes
- A connection history of the last 200 events, exportable as CSV

**Protected sites**: pages on sites you choose (banking, work…) are held back whenever the VPN isn't confirmed. They open again by themselves once it is.

**Tools**
- Look up any IP address from the popup, or right-click selected text → *Look up "…" with BrowserIP*
- Copy a plain-text report for support tickets
- Click the IP to copy it
- Keyboard shortcuts: **Alt+Shift+I** opens the popup and **Alt+Shift+U** re-checks. Chrome won't assign a shortcut that's already taken; check them in the extension's settings.

## Toolbar Icon

| Icon | Badge | Meaning |
| --- | --- | --- |
| Green | country code | Traffic exits through a VPN, proxy, Tor or hosting network as expected |
| Red | `OFF` | No VPN detected and you said you expect one |
| Red | `LEAK` | One IP family is tunnelled and the other is not |
| Red | `!SE`, `!ISP` | Exit country or provider doesn't match what you expect |
| Blue | country code | Direct connection, and you don't expect a VPN |
| Gray | `?` | Unknown, not checked yet, last check failed, or out of date |

Alert states always carry badge text, so they don't rely on colour alone. Hover over the icon for the full status.

## Settings

Open the ⚙ in the popup or the extension's **Options**.

| Setting | Default |
| --- | --- |
| I expect to be on a VPN | on |
| Notify on change | on |
| Country code badge | on |
| Background checks | every 5 minutes (off to 60 minutes) |
| Check IPv6 separately | on |
| Ask a second VPN database | on |
| Expected country / provider | any |
| Theme | match system (dark or light) |
| Protected sites | none |
| Show browser proxy settings | off (asks for permission when turned on) |
| API keys for ipapi.is and proxycheck.io | none (stored only on this device) |

### Protected sites

Protected sites use the browser's `declarativeNetRequest` rules. When you add a site, BrowserIP asks for access to it:

- **With access**, the page is replaced by an explanation that re-checks and continues to the original page automatically.
- **Without access**, the browser can only block the page, and you see its standard "blocked by an extension" error.

Pages are held back whenever the status isn't a fresh, tunnelled result that matches your expected country and provider. That includes the first seconds after the browser starts, before the first check. It's best effort: it reacts as fast as the checks run, and only affects pages loaded after the status changes.

## How Checks Work

1. ipify reports the browser's public IPv4 and IPv6 addresses.
2. If they're unchanged and the last full lookup is under 6 hours old, that lookup is reused. This keeps background checks far below the free quotas: ipapi.is allows about 1,000 lookups a day without a key, proxycheck.io about 100.
3. Otherwise each address is looked up with ipapi.is, falling back to ipwho.is and then ipinfo.io. If ipapi.is doesn't flag an address, proxycheck.io is asked too.
4. An address counts as tunnelled when either database flags it as VPN, proxy, Tor or a hosting network. Self-hosted VPNs on a cloud server are usually flagged only as hosting.
5. The result drives the popup, the icon, the protected-site rules, notifications and history.

Opening the popup runs a check, and **Refresh** forces a full lookup. Every request has an 8-second timeout. If a check fails, the popup keeps the last result and marks it out of date.

The IP shown is the address your *browser* uses. If the browser goes through a proxy, it can differ from the rest of your system; turn on the proxy setting to see why.

## Architecture

```text
BrowserIP/
  manifest.json          # MV3 manifest (Chrome + Firefox)
  background.js          # Runs checks; owns state, icon, alarms, notifications,
                         #   protected-site rules, history, shortcuts, context menu
  popup.*                # Status, copy report, leak tests, IP lookup
  options.*              # Settings
  history.*              # Connection history and CSV export
  lookup.*               # IP lookup window (context menu)
  blocked.*              # Explanation page for held-back protected sites
  theme.css, pages.css   # Shared tokens (dark + light), components, page layout
  _locales/              # en, de, es message catalogues
  lib/
    providers.js         # Lookup providers, second opinion, timeouts, fallback
    classify.js          # Verdicts: tunnelled / direct / leak / unknown
    check.js             # One check: discovery, caching, second opinions
    indicator.js         # Icon, badge, tooltip, warnings, expectations, staleness
    guard.js             # Protected-site rules
    history.js           # History entries and CSV
    dnsleak.js, webrtc.js# Leak tests
    proxyinfo.js         # Browser proxy settings, described
    report.js            # Plain-text report
    lookup-view.js       # Shared lookup rendering
    settings.js, ip.js, format.js, i18n.js
    messages-en.js       # Generated English fallback (npm run locales)
  test/                  # Unit tests (node:test) with recorded provider responses
  e2e/                   # Browser tests (Playwright + Chromium, network mocked)
  scripts/               # Manifest/translation checks, locale build, packaging
```

## Installation (Developer Mode)

**Chrome / Edge**

1. Go to `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension.

**Firefox (128+)**

1. Go to `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on**.
2. Select `manifest.json`.
3. Firefox treats MV3 host permissions as opt-in. Allow the lookup sites under the extension's **Permissions** tab.

## Development

```sh
npm install
npm test           # unit tests
npm run test:e2e   # browser tests (needs Chromium: npx playwright install chromium)
npm run lint       # ESLint
npm run check      # manifest, version, files, BOMs, translations
npm run locales    # regenerate lib/messages-en.js after editing _locales/en
npm run package    # dist/browserip-<version>.zip
```

### Translations

`_locales/en/messages.json` is the source of truth. Messages use `{0}`, `{1}`… for substitutions. `npm run check` fails if any locale is missing a key, has different placeholders, or if the code uses an undefined key. To add a language, copy `_locales/en` to `_locales/<code>`, translate the messages, and run `npm run check`.

### Releases

CI lints, tests (unit and browser) and packages on every push and pull request. Pushing a `v*` tag that matches the manifest version creates a GitHub release with the zip. It also publishes to the stores when the matching repository secrets are set:

- **Chrome Web Store**: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` (see [chrome-webstore-upload-cli](https://github.com/fregante/chrome-webstore-upload-cli) for creating them)
- **addons.mozilla.org**: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` (API keys from the AMO developer hub). New Firefox listings must also declare `browser_specific_settings.gecko.data_collection_permissions` in the manifest, and the first listed version needs its metadata entered on AMO.

## Privacy

There is no analytics, telemetry or server of our own. See [PRIVACY.md](PRIVACY.md) for every service the extension contacts and what it stores.

## Limitations

- VPN detection depends on ipapi.is and proxycheck.io's IP reputation data, not on inspecting your local network.
- The DNS leak test relies on bash.ws; if that service is down, the test fails.
- Chrome may delay background checks while the browser is idle or asleep. The icon greys out instead of showing an outdated result.
- `blocked.html` must be web-accessible for the redirect to work, so websites can detect that BrowserIP is installed.

## License

[MIT](LICENSE)
