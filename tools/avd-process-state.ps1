param([Parameter(Mandatory=$true)][string]$Workspace)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Workspace).TrimEnd('\')+'\'
$items=Get-CimInstance Win32_Process -Filter "Name='emulator.exe' OR Name='qemu-system-x86_64.exe' OR Name='qemu-system-x86_64-headless.exe'"
$slots=@()
foreach($p in $items){
    if(-not $p.ExecutablePath -or -not $p.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){continue}
    if($p.CommandLine -match '(?:^|\s)Multimental_Test_([AB])(?:\s|$)' -and $p.CommandLine -match '-port\s+(5554|5556)(?:\s|$)'){
        $slot=[regex]::Match($p.CommandLine,'Multimental_Test_([AB])').Groups[1].Value
        $port=[regex]::Match($p.CommandLine,'-port\s+(5554|5556)').Groups[1].Value
        if(($slot -eq 'A' -and $port -eq '5554') -or ($slot -eq 'B' -and $port -eq '5556')){$slots += $slot}
    }
}
ConvertTo-Json -Compress -InputObject @($slots|Sort-Object -Unique)
