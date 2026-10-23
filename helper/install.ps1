<#
.SYNOPSIS
Installs (or removes) the BrowserIP helper for the current user on Windows
and registers it with Chrome, Edge, Brave and Firefox.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId <id>

.EXAMPLE
powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
#>
param(
  [string]$ExtensionId = "",
  [string]$Binary = (Join-Path $PSScriptRoot "browserip-helper.exe"),
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$HostName = "io.github.hurr1star.browserip"
$FirefoxId = "browserip@hurr1star.github.io"
$InstallDir = Join-Path $env:LOCALAPPDATA "BrowserIP"
# Chrome's key also serves Brave and other Chromium browsers.
$ChromiumKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)
$FirefoxKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"

if ($Uninstall) {
  foreach ($key in $ChromiumKeys + $FirefoxKey) {
    if (Test-Path $key) { Remove-Item $key -Recurse }
  }
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Write-Host "BrowserIP helper removed."
  exit 0
}

if ($ExtensionId -and $ExtensionId -notmatch '^[a-p]{32}$') {
  Write-Error "That doesn't look like an extension ID (32 letters a-p). Copy it from chrome://extensions."
}
if (-not (Test-Path $Binary)) {
  Write-Error "Helper binary not found at $Binary"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Installed = Join-Path $InstallDir "browserip-helper.exe"
Copy-Item $Binary $Installed -Force
# Files downloaded from the internet are blocked from running silently.
Unblock-File $Installed

function Write-HostManifest($Path, $Allowed) {
  $manifest = [ordered]@{
    name        = $HostName
    description = "BrowserIP helper for the Mullvad VPN app"
    path        = $Installed
    type        = "stdio"
  }
  foreach ($key in $Allowed.Keys) { $manifest[$key] = $Allowed[$key] }
  $manifest | ConvertTo-Json | Set-Content -Path $Path -Encoding ASCII
}

function Register($Key, $ManifestPath) {
  New-Item -Path $Key -Force | Out-Null
  Set-Item -Path $Key -Value $ManifestPath
}

$registered = @()
if ($ExtensionId) {
  $chromeManifest = Join-Path $InstallDir "$HostName.chrome.json"
  Write-HostManifest $chromeManifest @{ allowed_origins = @("chrome-extension://$ExtensionId/") }
  foreach ($key in $ChromiumKeys) { Register $key $chromeManifest }
  $registered += "Chrome/Brave", "Edge"
}

$firefoxManifest = Join-Path $InstallDir "$HostName.firefox.json"
Write-HostManifest $firefoxManifest @{ allowed_extensions = @($FirefoxId) }
Register $FirefoxKey $firefoxManifest
$registered += "Firefox"

Write-Host "Installed $Installed"
Write-Host ("Registered with: " + ($registered -join ", "))
Write-Host 'Now open BrowserIP''s settings and press "Test helper".'
