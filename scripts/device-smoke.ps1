param([Parameter(Mandatory=$true)][string]$ConfigPath,[Parameter(Mandatory=$true)][string]$ArtifactDirectory)
$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'install-device.mjs') --config $ConfigPath --dir $ArtifactDirectory
if ($LASTEXITCODE -ne 0) { throw 'Device installation/check failed; no uninstall or data deletion performed' }
