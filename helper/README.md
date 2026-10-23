# BrowserIP helper (Mullvad)

The BrowserIP extension can't start programs on your computer by itself. This
small helper lets it control the **Mullvad VPN app** through Mullvad's own
command-line tool, so the popup can connect, disconnect, reconnect and switch
country with one click.

It accepts only these requests, each mapped to one fixed Mullvad command:

| Request | Runs |
| --- | --- |
| `status` | `mullvad status` |
| `connect`, `disconnect`, `reconnect` | `mullvad connect` / `disconnect` / `reconnect` |
| `setLocation` | `mullvad relay set location <country> [<city>]` (codes are validated) |
| `countries` | `mullvad relay list` (to list countries) |
| `hello` | `mullvad version` |

Only BrowserIP can talk to it: the browser checks the extension ID before
starting it. It has no network access of its own and stores nothing.

## Install

1. Install the Mullvad VPN app if you haven't.
2. Download the archive for your system from the
   [latest release](https://github.com/hurr1star/BrowserIP/releases/latest) and unpack it.
3. In BrowserIP's settings, under **Your VPN → Mullvad**, copy your extension ID
   (Chrome, Edge and Brave need it; Firefox doesn't).
4. Run the installer from the unpacked folder:
   - **macOS / Linux**: `./install.sh --extension-id <id>`
   - **Windows**: `powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id>`
5. Back in BrowserIP's settings, press **Test helper** and allow the permission.

The installer copies the helper to your user folder
(`~/.local/share/browserip`, `~/Library/Application Support/BrowserIP` or
`%LOCALAPPDATA%\BrowserIP`) and registers it with each installed browser. No
administrator rights are needed.

If the extension ID changes (for example when you reinstall an unpacked
copy), run the installer again with the new ID.

## Uninstall

`./install.sh --uninstall` or `install.ps1 -Uninstall`.

## Build from source

```sh
go test ./...
./build.sh        # archives for every platform in ../dist/helper
```

If the Mullvad CLI lives somewhere unusual, set `BROWSERIP_MULLVAD_CLI` to
its full path in the environment the browser starts with.
