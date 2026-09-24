# Run from a reviewed source snapshot/checkout. Never changes other machines or repositories.
[CmdletBinding()]
param([string]$WorkRoot=(Join-Path $env:USERPROFILE 'MultimentalWork'),[switch]$PrepareAgent)
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$source=Split-Path $PSScriptRoot
$profile=Get-Content -Raw "$source\.gameprod\project.json" | ConvertFrom-Json
if ([Environment]::MachineName -notin $profile.authorizedHosts) { throw 'Unauthorized host' }
if ($profile.repository -ne 'neurofoxpro/multimental') { throw 'Wrong project adapter' }
$tools=Join-Path $WorkRoot 'tools';New-Item -ItemType Directory -Force $tools | Out-Null
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function Download($url,$dest,$hash) {
 if (Test-Path $dest) { if ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -eq $hash) { return }; throw 'Existing tool archive differs from lock' }
 Invoke-WebRequest -UseBasicParsing $url -OutFile "$dest.part" -TimeoutSec 240
 if ((Get-FileHash "$dest.part" -Algorithm SHA256).Hash.ToLower() -ne $hash) { throw 'Downloaded tool differs from pinned lock' }
 Move-Item "$dest.part" $dest
}
function Extract($zip,$dest) { if (-not (Test-Path $dest)) { Expand-Archive $zip $dest } }
Download 'https://github.com/godotengine/godot-builds/releases/download/4.7.2-stable/Godot_v4.7.2-stable_win64.exe.zip' "$tools\godot.zip" '731980f9608d61333e5baf54a2ef17210acc7a538446c0cb9969f002aca1e953'
Extract "$tools\godot.zip" "$tools\godot"
[xml]$sdk=(Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/repository2-3.xml').Content
$specs=@(@{id='platform-tools';file='adb.zip';hash='45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99'},@{id='build-tools;35.0.1';file='build-tools.zip';hash='79748cb4ab64b61fa678af21639985c7e394d874a4e31f082f4026d5c57e01a3'})
foreach ($spec in $specs) {
 $p=$sdk.SelectSingleNode("//*[local-name()='remotePackage' and @path='$($spec.id)']")
 $a=$p.SelectSingleNode(".//*[local-name()='archive'][*[local-name()='host-os']='windows']/*[local-name()='complete']")
 Download ('https://dl.google.com/android/repository/'+$a.url) (Join-Path $tools $spec.file) $spec.hash
}
if (-not (Test-Path "$tools\platform-tools\adb.exe")) { Expand-Archive "$tools\adb.zip" $tools }
Extract "$tools\build-tools.zip" "$tools\build-tools"
if (-not (Test-Path "$tools\jre17.zip")) { $j=Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse';Download $j[0].binary.package.link "$tools\jre17.zip" 'bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352' }
if ((Get-FileHash "$tools\jre17.zip" -Algorithm SHA256).Hash.ToLower() -ne 'bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352') { throw 'JRE lock mismatch' }
Extract "$tools\jre17.zip" "$tools\jre17"
$java=(Get-ChildItem "$tools\jre17" -Recurse -Filter java.exe | Select-Object -First 1).FullName
$jar=(Get-ChildItem "$tools\build-tools" -Recurse -Filter apksigner.jar | Select-Object -First 1).FullName
$aapt=(Get-ChildItem "$tools\build-tools" -Recurse -Filter aapt.exe | Select-Object -First 1).FullName
@{java=$java;apksigner=$jar;aapt=$aapt} | ConvertTo-Json | Set-Content -Encoding UTF8 "$tools\signing-tools.local.json"
if ($PrepareAgent) {
 $snapshot=Get-Content -Raw "$source\.gameprod\source.json" | ConvertFrom-Json
 if ($snapshot.repository -ne $profile.repository) { throw 'Snapshot origin mismatch' }
 $agent=Join-Path $WorkRoot ('agent-'+$snapshot.commit.Substring(0,12))
 if (Test-Path $agent) { throw 'Reviewed agent directory exists; do not overwrite' }
 New-Item -ItemType Directory -Force "$agent\scripts","$agent\skills\game-production\scripts" | Out-Null
 foreach ($f in @('install-device.mjs','update-device.mjs','device-readiness.mjs','register-updater.ps1')) { Copy-Item "$source\scripts\$f" "$agent\scripts\$f" }
 Copy-Item "$source\skills\game-production\scripts\lib.mjs" "$agent\skills\game-production\scripts\lib.mjs"
 if (-not (Test-Path "$WorkRoot\station.local.json")) {
  $adb="$tools\platform-tools\adb.exe";$rows=@(& $adb devices -l | Where-Object { $_ -match '^\S+\s+device(?:\s|$)' })
  if ($rows.Count -ne 1) { throw 'Pair exactly one authorized phone' }
  $serial=($rows[0] -split '\s+')[0]
  @{repository=$profile.repository;allowedHost=[Environment]::MachineName;package=$profile.developmentPackage;serial=$serial;workDir="$WorkRoot\installations";adb=$adb;java=$java;keytool=(Join-Path (Split-Path $java) 'keytool.exe');apksigner=$jar;aapt=$aapt;allowedPermissions=@('android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE','android.permission.VIBRATE')} | ConvertTo-Json | Set-Content -Encoding UTF8 "$WorkRoot\station.local.json"
 }
 New-Item -ItemType Directory -Force "$WorkRoot\installations\private-signing" | Out-Null
 $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
 & icacls "$WorkRoot\installations\private-signing" /inheritance:r /grant:r "${user}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'Private signing folder ACL failed' }
 Write-Output "REVIEWED_AGENT=$agent"
}
Write-Output 'STATION_TOOLS_PASS'
