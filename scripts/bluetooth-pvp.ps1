param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot
$p=Get-Content -Raw "$repo\.gameprod\project.json" | ConvertFrom-Json
if([Environment]::MachineName -notin $p.authorizedHosts){throw 'Unauthorized host'}
$r=Get-Content -Raw $RequestFile | ConvertFrom-Json
if($r.address -notmatch '^(?:[A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$' -or $r.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid selected-device test request'}
Add-Type -Path "$repo\tools\BluetoothChannel.cs"
$identity=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$client=$null;$actions=0;$reconnected=$false;$until=(Get-Date).AddSeconds(75)
function Send($m){$client.SendLine(($m|ConvertTo-Json -Compress -Depth 30))}
function NextView {
 $deadline=(Get-Date).AddSeconds(10)
 do{$m=$client.ReadLine()|ConvertFrom-Json;if($m.view){if($m.view.PSObject.Properties.Name -contains 'players' -or $m.view.PSObject.Properties.Name -contains 'seed'){throw 'Private state leak'};return $m.view}}while((Get-Date)-lt $deadline)
 throw 'No view received'
}
function OpenConnection {
 $script:client=New-Object MultimentalBluetoothChannel($r.address,'81c6ade9-42f5-4e26-82de-c9c4a2e7ab91',$true)
 Send @{kind='hello';v=2;rules='terrain-sweep-v3-balance1';token=$r.token;identity=$identity}
 return NextView
}
try {
 $view=OpenConnection
 while((Get-Date)-lt $until -and $view.winner -eq -1){
  if($actions -ge 2 -and -not $reconnected){$client.Dispose();$client=$null;Start-Sleep -Seconds 2;$view=OpenConnection;$reconnected=$true;continue}
  if($view.active -eq 0 -and $view.legal.Count -gt 0){
   $seq=[int]$view.next_sequence
   Send @{kind='command';seq=$seq;command=$view.legal[0]}
   do{$view=NextView}while($view.next_sequence -le $seq -and $view.winner -eq -1)
   $actions++
  }else{Send @{kind='ping'};$view=NextView}
 }
 if($view.winner -eq -1 -or $actions -lt 2 -or -not $reconnected){throw 'Bluetooth PvP did not finish with reconnect'}
 [pscustomobject]@{status='passed';role='windows_guest';actions=$actions;winner=$view.winner;turn=$view.turn;scores=$view.scores;reconnect=$reconnected;authenticatedRFCOMM=$true;encryptedRFCOMM=$true;tls=$false;privateView=$true} | ConvertTo-Json -Compress -Depth 8
}finally{if($client){$client.Dispose()}}
