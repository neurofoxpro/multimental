param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'update-device.mjs') --config $ConfigPath
if ($LASTEXITCODE -ne 0) { throw 'Update check failed; inspect local diagnostics' }
