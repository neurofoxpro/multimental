param([ValidateSet('start','stop','status','clean')][string]$Mode='status',[ValidateSet('A','B')][string]$Slot='A')
$ErrorActionPreference='Stop';$repo=Split-Path $PSScriptRoot
$p=Get-Content -Raw "$repo\.gameprod\project.json" | ConvertFrom-Json
if([Environment]::MachineName -notin $p.authorizedHosts){throw 'Unauthorized host'}
$work=Split-Path $repo;$sdk=Join-Path $work 'tools\android-sdk'
$env:ANDROID_HOME=$sdk;$env:ANDROID_SDK_ROOT=$sdk
$env:ANDROID_USER_HOME=Join-Path $work 'emulation\android-user'
$env:ANDROID_AVD_HOME=Join-Path $work 'emulation\avd'
$adb=Join-Path $work 'tools\platform-tools\adb.exe';$emu=Join-Path $sdk 'emulator\emulator.exe'
$port=if($Slot -eq 'A'){5554}else{5556};$serial='emulator-'+$port;$name='Multimental_Test_'+$Slot
if($Mode -eq 'status'){ & $adb devices;exit }
if($Mode -eq 'stop'){ & $adb -s $serial emu kill;exit }
if($Mode -eq 'clean'){
 $avd=@(& $adb -s $serial emu avd name);if(-not ($avd -contains $name)){throw 'Wrong emulator; no data removed'}
 & $adb -s $serial uninstall $p.developmentPackage
 if($LASTEXITCODE -ne 0){throw 'Emulator uninstall failed'}
 Write-Output 'EMULATOR_CLEAN_INSTALL_READY';exit
}
if(-not(Test-Path $emu)){throw 'Run bootstrap-emulator.ps1 first'}
$running=@(& $adb devices | Where-Object { $_ -match "^$serial\s+device" })
if($running.Count -eq 0){
 Start-Process -FilePath $emu -ArgumentList @('-avd',$name,'-port',"$port",'-no-snapshot','-no-boot-anim','-no-audio','-no-window','-gpu','software','-memory','2048','-cores','2') -RedirectStandardOutput "$work\emulation\$Slot-out.log" -RedirectStandardError "$work\emulation\$Slot-err.log" | Out-Null
}
$deadline=(Get-Date).AddMinutes(4)
do { Start-Sleep -Seconds 2;$ErrorActionPreference="Continue";$boot=& $adb -s $serial shell getprop sys.boot_completed 2>$null;$ErrorActionPreference="Stop" } while ($boot -ne '1' -and (Get-Date) -lt $deadline)
if($boot -ne '1'){throw 'Emulator boot timeout; inspect emulation logs'}
$actual=@(& $adb -s $serial emu avd name);if(-not($actual -contains $name)){throw 'Unexpected AVD on requested port'}
& $adb -s $serial shell input keyevent 82
Write-Output "EMULATOR_READY=$serial"
