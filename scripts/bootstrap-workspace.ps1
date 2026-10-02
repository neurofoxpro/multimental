$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if ([Environment]::MachineName -ne 'VENEL-SENDRIK') { throw 'Unauthorized host' }
$root=Join-Path $env:USERPROFILE 'MultimentalWork';$tools=Join-Path $root 'tools'
$git=Join-Path $tools 'mingit\cmd\git.exe'
if (-not (Test-Path $git)) {
 $rel=Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest'
 $asset=@($rel.assets | Where-Object { $_.name -match '^MinGit-[0-9.]+-64-bit.zip$' })
 if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:') { throw 'Expected one official checksummed MinGit asset' }
 $zip=Join-Path $tools $asset[0].name
 Invoke-WebRequest -UseBasicParsing $asset[0].browser_download_url -OutFile $zip -TimeoutSec 180
 if ((Get-FileHash $zip).Hash.ToLower() -ne $asset[0].digest.Substring(7)) { throw 'Git checksum mismatch' }
 Expand-Archive $zip (Join-Path $tools 'mingit')
 @{url=$asset[0].browser_download_url;sha256=$asset[0].digest.Substring(7);version=$rel.tag_name} | ConvertTo-Json | Set-Content -Encoding UTF8 "$tools\mingit-lock.local.json"
}
$env:Path=(Split-Path $git)+';'+$env:Path
& $git --version
$repo=Join-Path $root 'repo'
if (-not (Test-Path $repo)) { & $git clone --branch dev https://github.com/neurofoxpro/multimental.git $repo; if ($LASTEXITCODE -ne 0) { throw 'Clone failed' } }
if ((& $git -C $repo remote get-url origin) -ne 'https://github.com/neurofoxpro/multimental.git') { throw 'Wrong repository' }
$login=gh api user --jq .login
if ($login -ne 'venelsendrik') { throw 'Unexpected GitHub account' }
& $git -C $repo config --local credential.https://github.com.helper '!gh auth git-credential'
& $git -C $repo config --local user.name 'venelsendrik'
& $git -C $repo config --local user.email 'venelsendrik@users.noreply.github.com'
& $git -C $repo config --local core.autocrlf false
& $git -C $repo status --short --branch
Write-Output "WORKTREE_READY=$repo"
