[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath,

    [string]$PackageName = "pro.neurofox.multimental",
    [string]$Serial = $env:ADB_SERIAL,
    [string]$OutputDirectory = "device-results"
)

$ErrorActionPreference = "Stop"

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $baseArgs = @()
    if ($Serial) {
        $baseArgs += @("-s", $Serial)
    }

    & adb @baseArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "adb failed: $($Arguments -join ' ')"
    }
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is not available on PATH. Install Android platform-tools first."
}

$resolvedApk = (Resolve-Path $ApkPath).Path
$adbBaseArgs = @()
if ($Serial) { $adbBaseArgs = @("-s", $Serial) }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$devices = (& adb devices) | Select-String "\tdevice$"
if (-not $Serial -and $devices.Count -ne 1) {
    throw "Expected exactly one authorized Android device, found $($devices.Count). Set ADB_SERIAL when using several devices."
}

Write-Host "Installing $resolvedApk"
Invoke-Adb install -r $resolvedApk
Invoke-Adb shell am force-stop $PackageName
Invoke-Adb logcat -c
Invoke-Adb shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1
Start-Sleep -Seconds 5

$screenshotPath = (Resolve-Path $OutputDirectory).Path + "\screenshot.png"
$adbPrefix = "adb"
if ($Serial) { $adbPrefix += " -s `"$Serial`"" }
cmd /c "$adbPrefix exec-out screencap -p > `"$screenshotPath`""
if ($LASTEXITCODE -ne 0) { throw "Unable to capture screenshot." }

& adb @adbBaseArgs logcat -d -v threadtime | Set-Content -Encoding UTF8 "$OutputDirectory/logcat.txt"
$pidOutput = & adb @adbBaseArgs shell pidof $PackageName
if (-not $pidOutput) {
    throw "The Multimental process is not running after launch. See logcat.txt."
}

Write-Host "PASS: Multimental is running with PID $pidOutput"
