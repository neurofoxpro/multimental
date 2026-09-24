[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ConfigPath,[Parameter(Mandatory=$true)][string]$UpdaterPath,[switch]$Remove)
$ErrorActionPreference='Stop'
$config=Get-Content -Raw $ConfigPath | ConvertFrom-Json
if ([Environment]::MachineName -ne $config.allowedHost) { throw 'Unauthorized host' }
if ($config.repository -ne 'neurofoxpro/multimental') { throw 'Wrong repository' }
$name='Multimental-Dev-APK-Updater'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; exit }
if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect before replacing it' }
$node=(Get-Command node.exe -ErrorAction Stop).Source
$action=New-ScheduledTaskAction -Execute $node -Argument ('"'+$UpdaterPath+'" --config "'+$ConfigPath+'"') -WorkingDirectory (Split-Path $UpdaterPath)
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Only canonical Multimental dev APKs; no remote scripts; preserve app data; defer during gameplay' | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName,State
