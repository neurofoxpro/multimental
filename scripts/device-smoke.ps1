[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApkPath,

    [string]$PackageName = "pro.neurofox.multimental",
    [string]$Serial = $env:ADB_SERIAL,
    [string]$OutputDirectory = "device-results",
    [switch]$CleanInstall,
    [int]$LaunchWaitSeconds = 8
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-AdbPath {
    $candidates = @(
        $env:ADB_PATH,
        "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
        "C:\Android\platform-tools\adb.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -gt 0) {
        return (Resolve-Path $candidates[0]).Path
    }

    $command = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "adb.exe was not found. Install Android platform-tools and set ADB_PATH or add adb.exe to PATH."
}

$script:Adb = Resolve-AdbPath

function Invoke-Adb {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [switch]$AllowFailure
    )

    $prefix = @()
    if ($Serial) {
        $prefix += @("-s", $Serial)
    }

    $output = & $script:Adb @prefix @ArgumentList 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "adb failed with exit code $exitCode: $($ArgumentList -join ' ')"
    }

    return $output
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path $OutputDirectory).Path

& $script:Adb start-server | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "Unable to start the ADB server."
}

$deviceLines = & $script:Adb devices -l
if ($LASTEXITCODE -ne 0) {
    throw "Unable to list Android devices."
}

$authorizedDevices = @(
    $deviceLines | ForEach-Object {
        if ($_ -match '^([^\s]+)\s+device(?:\s|$)') {
            $Matches[1]
        }
    }
)

if ($Serial) {
    if ($authorizedDevices -notcontains $Serial) {
        throw "ADB_SERIAL '$Serial' is not connected and authorized. Connected devices: $($authorizedDevices -join ', ')"
    }
} elseif ($authorizedDevices.Count -eq 1) {
    $Serial = $authorizedDevices[0]
} elseif ($authorizedDevices.Count -eq 0) {
    throw "No authorized Android device found. Connect the phone by USB, enable USB debugging and accept the RSA prompt."
} else {
    throw "Several Android devices are connected: $($authorizedDevices -join ', '). Set repository variable ADB_SERIAL."
}

$apkItem = Get-Item $ApkPath -ErrorAction Stop
if ($apkItem.PSIsContainer) {
    $apkFiles = @(Get-ChildItem -Path $apkItem.FullName -Recurse -Filter *.apk -File)
    if ($apkFiles.Count -ne 1) {
        throw "Expected exactly one APK under '$ApkPath', found $($apkFiles.Count)."
    }
    $resolvedApk = $apkFiles[0].FullName
} else {
    $resolvedApk = $apkItem.FullName
}

$model = (Invoke-Adb -ArgumentList @("shell", "getprop", "ro.product.model") | Select-Object -Last 1).ToString().Trim()
$androidVersion = (Invoke-Adb -ArgumentList @("shell", "getprop", "ro.build.version.release") | Select-Object -Last 1).ToString().Trim()
$sdkVersion = (Invoke-Adb -ArgumentList @("shell", "getprop", "ro.build.version.sdk") | Select-Object -Last 1).ToString().Trim()

@(
    "serial=$Serial"
    "model=$model"
    "android=$androidVersion"
    "sdk=$sdkVersion"
    "apk=$resolvedApk"
) | Set-Content -Encoding UTF8 "$outputRoot\device-info.txt"

if ($CleanInstall) {
    Write-Host "Removing previous installation and local app data..."
    Invoke-Adb -ArgumentList @("uninstall", $PackageName) -AllowFailure | Out-Null
}

Write-Host "Installing $resolvedApk on $model ($Serial)..."
$installOutput = Invoke-Adb -ArgumentList @("install", "-r", $resolvedApk)
$installOutput | Set-Content -Encoding UTF8 "$outputRoot\install.txt"

Invoke-Adb -ArgumentList @("shell", "am", "force-stop", $PackageName) -AllowFailure | Out-Null
Invoke-Adb -ArgumentList @("logcat", "-c") | Out-Null

$launchOutput = Invoke-Adb -ArgumentList @("shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1")
$launchOutput | Set-Content -Encoding UTF8 "$outputRoot\launch.txt"
Start-Sleep -Seconds $LaunchWaitSeconds

$pidOutput = Invoke-Adb -ArgumentList @("shell", "pidof", $PackageName) -AllowFailure
$pid = ($pidOutput | Select-Object -Last 1).ToString().Trim()

$remoteScreenshot = "/sdcard/multimental-smoke.png"
Invoke-Adb -ArgumentList @("shell", "screencap", "-p", $remoteScreenshot) | Out-Null
Invoke-Adb -ArgumentList @("pull", $remoteScreenshot, "$outputRoot\screenshot.png") | Out-Null
Invoke-Adb -ArgumentList @("shell", "rm", "-f", $remoteScreenshot) -AllowFailure | Out-Null

$adbPrefix = @()
if ($Serial) {
    $adbPrefix += @("-s", $Serial)
}

& $script:Adb @adbPrefix logcat -d -v threadtime 2>&1 | Set-Content -Encoding UTF8 "$outputRoot\logcat-full.txt"
& $script:Adb @adbPrefix shell dumpsys package $PackageName 2>&1 | Set-Content -Encoding UTF8 "$outputRoot\package-dump.txt"

if ($pid) {
    & $script:Adb @adbPrefix logcat -d "--pid=$pid" -v threadtime 2>&1 | Set-Content -Encoding UTF8 "$outputRoot\logcat-app.txt"
} else {
    throw "Multimental is not running after launch. See the uploaded device report."
}

@(
    "status=PASS"
    "serial=$Serial"
    "model=$model"
    "pid=$pid"
    "package=$PackageName"
) | Set-Content -Encoding UTF8 "$outputRoot\summary.txt"

Write-Host "PASS: Multimental is installed and running on $model with PID $pid."
