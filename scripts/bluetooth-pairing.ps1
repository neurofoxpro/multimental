param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot
$config=Get-Content -Raw $ConfigPath | ConvertFrom-Json
if([Environment]::MachineName -ne $config.allowedHost -or $config.repository -ne 'neurofoxpro/multimental'){throw 'Wrong execution boundary'}
$address=(& $config.adb -s $config.serial shell settings get secure bluetooth_address).Trim()
if($LASTEXITCODE -ne 0){throw 'Selected phone unavailable'}
Add-Type -Path (Join-Path $repo 'tools/BluetoothPairing.cs')
$r=[MultimentalPairing]::Inspect($address)
[pscustomobject]@{schemaVersion=1;observedAt=[DateTime]::UtcNow.ToString('o');radioPresent=$r.radioPresent;selectedPhoneKnown=$r.known;remembered=$r.remembered;authenticated=$r.authenticated;connected=$r.connected;win32Code=$r.lastError;action=if($r.authenticated){'none'}else{'pair_selected_phone_in_windows_and_confirm_on_both_devices'}} | ConvertTo-Json -Compress
