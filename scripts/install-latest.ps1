[CmdletBinding()]
param(
    [string]$Repository = "neurofoxpro/multimental",
    [string]$Tag = "",
    [string]$Serial = $env:ADB_SERIAL
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required. Install it with: winget install --id GitHub.cli"
}
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "ADB is required. Install Android platform-tools and add adb to PATH."
}

$target = Join-Path $env:TEMP "multimental-latest"
Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $target | Out-Null

if ($Tag) {
    gh release download $Tag --repo $Repository --pattern "*.apk" --dir $target --clobber
} else {
    $releaseTag = gh api "repos/$Repository/releases" --jq ".[0].tag_name"
    if (-not $releaseTag) {
        throw "No release was found in $Repository."
    }
    gh release download $releaseTag --repo $Repository --pattern "*.apk" --dir $target --clobber
}

$apk = Get-ChildItem $target -Filter *.apk | Select-Object -First 1
if (-not $apk) {
    throw "No APK was downloaded."
}

& "$PSScriptRoot/device-smoke.ps1" -ApkPath $apk.FullName -Serial $Serial
