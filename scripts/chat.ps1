param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot
$p=Get-Content -Raw (Join-Path $repo '.gameprod/project.json') | ConvertFrom-Json
if ([Environment]::MachineName -notin $p.authorizedHosts) { throw 'Unauthorized host' }
$workspace=Split-Path $repo
$env:Path=(Join-Path $workspace 'tools/mingit/cmd')+';'+$env:Path
$env:GIT_TERMINAL_PROMPT='0';$env:GH_PROMPT_DISABLED='1'
Set-Location $repo
& node skills/game-production/scripts/control.mjs @Arguments
if ($LASTEXITCODE -ne 0) { throw 'Operation blocked; see .gameprod/evidence and CONTROL_BLOCKED/OPS_BLOCKED message' }
