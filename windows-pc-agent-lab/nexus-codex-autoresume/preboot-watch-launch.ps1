# Test-only NEXUS Guardian standby monitor launcher.
# Holds a live Windows kernel mutex for as long as the Node observer runs.
# Does not run Codex, restart NEXUS Host or modify Windows security.
param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$owner=$false
$mutex=[System.Threading.Mutex]::new($true,'Local\NEXUS-Guardian-Preboot-Watch',[ref]$owner)
if(-not $owner){
  $mutex.Dispose()
  exit 11
}
$code=20
try{
  $script=Join-Path $PSScriptRoot 'preboot-watch.mjs'
  if(-not (Test-Path -LiteralPath $script -PathType Leaf)){throw 'MISSING_MONITOR_SCRIPT'}
  if(-not ($Root -match '(?i)[\\/]nexus-guardian-preboot-(watch|test-[a-f0-9]{8})$')){
    throw 'INVALID_MONITOR_ROOT'
  }
  $node=(Get-Command node.exe -ErrorAction Stop).Source
  & $node $script --root $Root --mode resident
  $code=$LASTEXITCODE
}catch{
  Write-Error "NEXUS_STANDBY_STOP: $($_.Exception.GetType().Name)"
  $code=20
}finally{
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
exit $code
