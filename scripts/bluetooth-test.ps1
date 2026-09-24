param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot
$p=Get-Content -Raw "$repo\.gameprod\project.json" | ConvertFrom-Json
if([Environment]::MachineName -notin $p.authorizedHosts){throw 'Unauthorized host'}
$request=Get-Content -Raw $RequestFile | ConvertFrom-Json
if($request.address -notmatch '^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$' -or $request.token -notmatch '^[a-f0-9]{48}$'){throw 'Invalid paired-test target'}
Add-Type -Path "$repo\tools\BluetoothChannel.cs"
$client=New-Object MultimentalBluetoothChannel($request.address)
function Exchange($message){$line=$message | ConvertTo-Json -Compress -Depth 15;return $client.Exchange($line)}
try {
 $hello=Exchange @{v=1;token=$request.token;op='hello'} | ConvertFrom-Json
 if(-not $hello.ok){throw 'Bluetooth hello rejected'}
 $bad=Exchange @{v=99;token=$request.token;op='hello'} | ConvertFrom-Json
 if($bad.error -ne 'incompatible_protocol'){throw 'Wrong version accepted'}
 $command=@{v=1;token=$request.token;op='command';seq=1;command=@{type='pass'}}
 $one=Exchange $command;$two=Exchange $command
 if($one -ne $two){throw 'Bluetooth duplicate not idempotent'}
 $conflict=Exchange @{v=1;token=$request.token;op='command';seq=1;command=@{type='invalid'}} | ConvertFrom-Json
 if($conflict.error -ne 'duplicate_conflict'){throw 'Conflicting duplicate accepted'}
 $sync=Exchange @{v=1;token=$request.token;op='sync'} | ConvertFrom-Json
 if(-not $sync.ok -or $sync.view.PSObject.Properties.Name -contains 'players' -or $sync.view.PSObject.Properties.Name -contains 'seed'){throw 'Invalid filtered state'}
 Write-Output 'PHYSICAL_BLUETOOTH_PROTOCOL_PASS messages=6 transport=RFCOMM'
} finally { $client.Dispose() }
