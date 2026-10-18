$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$repo=Split-Path $PSScriptRoot
$p=Get-Content -Raw "$repo\.gameprod\project.json" | ConvertFrom-Json
if ([Environment]::MachineName -notin $p.authorizedHosts) { throw 'Unauthorized host' }
$work=Split-Path $repo;$sdk=Join-Path $work 'tools\android-sdk'
New-Item -ItemType Directory -Force $sdk | Out-Null
$tool=Get-Content -Raw "$work\tools\signing-tools.local.json" | ConvertFrom-Json
$env:JAVA_HOME=Split-Path (Split-Path $tool.java)
$env:ANDROID_HOME=$sdk;$env:ANDROID_SDK_ROOT=$sdk
$env:ANDROID_USER_HOME=Join-Path $work 'emulation\android-user'
$env:ANDROID_AVD_HOME=Join-Path $work 'emulation\avd'
New-Item -ItemType Directory -Force $env:ANDROID_USER_HOME,$env:ANDROID_AVD_HOME | Out-Null
$manager="$sdk\cmdline-tools\12.0\bin\sdkmanager.bat"
if (-not (Test-Path $manager)) {
 [xml]$xml=(Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/repository2-3.xml').Content
 $pkg=$xml.SelectSingleNode("//*[local-name()='remotePackage' and @path='cmdline-tools;12.0']")
 $a=$pkg.SelectSingleNode(".//*[local-name()='archive'][*[local-name()='host-os']='windows']/*[local-name()='complete']")
 if(-not $a){throw 'Pinned commandline-tools 12.0 missing'}
 $archive=Join-Path $sdk 'cmdline-tools.zip'
 Invoke-WebRequest -UseBasicParsing ('https://dl.google.com/android/repository/'+$a.url) -OutFile $archive -TimeoutSec 240
 if((Get-FileHash $archive -Algorithm SHA1).Hash.ToLower() -ne $a.checksum.InnerText.ToLower()){throw 'SDK checksum mismatch'}
 Expand-Archive $archive "$sdk\cmdline-tools-extract"
 New-Item -ItemType Directory -Force "$sdk\cmdline-tools" | Out-Null
 Move-Item "$sdk\cmdline-tools-extract\cmdline-tools" "$sdk\cmdline-tools\12.0"
}
$answers=('y'+[Environment]::NewLine)*30
$answers | & $manager --sdk_root=$sdk --licenses 2>&1 | Out-File "$work\emulation\sdk-license.log" -Encoding UTF8
& $manager --sdk_root=$sdk 'emulator' 'platform-tools' 'system-images;android-35;default;x86_64' 2>&1 | Out-File "$work\emulation\sdk-install.log" -Encoding UTF8
if($LASTEXITCODE -ne 0){throw 'SDK installation failed; inspect sdk-install.log'}
$avd="$sdk\cmdline-tools\12.0\bin\avdmanager.bat"
foreach($name in @('Multimental_Test_A','Multimental_Test_B')){
 $dir=Join-Path $env:ANDROID_AVD_HOME ($name+'.avd')
 if(-not (Test-Path $dir)){
  'no' | & $avd create avd --name $name --package 'system-images;android-35;default;x86_64' --path $dir
  if($LASTEXITCODE -ne 0){throw 'AVD creation failed'}
  Add-Content -Encoding ASCII "$dir\config.ini" "`nhw.lcd.width=720`nhw.lcd.height=1280`nhw.lcd.density=240`nhw.ramSize=2048`nhw.cpu.ncore=2`nhw.gpu.enabled=yes`nhw.gpu.mode=software`ndisk.dataPartition.size=3G`nhw.keyboard=yes"
 }
}
& "$sdk\emulator\emulator.exe" -version
& "$sdk\emulator\emulator.exe" -accel-check
if($LASTEXITCODE -ne 0){throw 'Hypervisor not available; do not weaken host security or reboot automatically'}
Write-Output 'ANDROID_EMULATOR_SETUP_PASS'
