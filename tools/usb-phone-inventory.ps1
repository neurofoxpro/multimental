$ErrorActionPreference='Stop'
if([Environment]::MachineName -ne 'VENEL-SENDRIK'){throw 'Wrong diagnostic host'}
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$groups=@{}; $rows=@(); $unknownGrouping=0
$devices=@(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.InstanceId -match '^USB' -and ($_.Class -eq 'WPD' -or $_.FriendlyName -match 'Android|ADB|MTP|HONOR|HUAWEI|Xiaomi|Redmi|POCO|Pixel|Samsung|Galaxy' -or $_.Status -in @('ERROR','DEGRADED')) })
if($devices.Count -gt 64){throw 'Diagnostic inventory too large'}
foreach($d in $devices){
 $kind=if($d.FriendlyName -match 'ADB'){'ADB'}elseif($d.Class -eq 'WPD' -or $d.FriendlyName -match 'MTP'){'MTP'}elseif($d.FriendlyName -match 'Android|HONOR|HUAWEI|Xiaomi|Redmi|POCO|Pixel|Samsung|Galaxy'){'AndroidCandidate'}else{'USBError'}
 $container=$null; try{$property=@(Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_ContainerId' -ErrorAction Stop);$container=[string]$property[0].Data}catch{}
 $alias=$null; $parsed=[guid]::Empty
 if([guid]::TryParse($container,[ref]$parsed) -and $parsed -ne [guid]::Empty){
  $container=$parsed.ToString()
  if(-not $groups.ContainsKey($container)){$groups[$container]='usb-group-'+($groups.Count+1)}
  $alias=$groups[$container]
 }else{$unknownGrouping++}
 $status=if($d.Status -in @('OK','ERROR','DEGRADED','UNKNOWN')){[string]$d.Status}else{'UNKNOWN'}
 $rows+=@{group=$alias;interface=$kind;status=$status}
}
@{schemaVersion=1;scope='present-windows-usb-interfaces';interfaces=@($rows);groupingUnavailable=$unknownGrouping;identifiersRedacted=$true;readOnly=$true}|ConvertTo-Json -Depth 5 -Compress
