/**
 * Fixed Windows PowerShell 5.1 script for UI Automation (read-only + AppActivate).
 * Passed as -EncodedCommand; request data arrives ONLY through the env var NEXUS_UIA_ARGS (JSON),
 * result goes to the file named in NEXUS_UIA_OUT (UTF-8). Nothing from the request is interpolated into code.
 * Uses Add-Type -AssemblyName (loads signed framework assemblies, no compilation) — needs FullLanguage,
 * confirmed on the owner's PC by preflight 01.11.2026.
 *
 * Modes:
 *  focused                     → foreground info (focused element process) + calibration rect
 *  at        {x,y}             → process under the point (UIA coordinate space) + focused
 *  activate  {pid,title?}      → WScript.Shell.AppActivate(pid), fallback AppActivate(title); result re-read from UIA
 *  windows   {pid}             → top-level windows owned by pid (or ApplicationFrameHost frames hosting it)
 *  tree      {pid,depth,max}   → control tree of those windows (bounded)
 * Every mode returns `root` = UIA desktop rectangle, used by Node to map UIA coordinates to Java screen points.
 */
export const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$a = $env:NEXUS_UIA_ARGS | ConvertFrom-Json
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
$AE = [System.Windows.Automation.AutomationElement]
$TW = [System.Windows.Automation.TreeWalker]::ControlViewWalker
function NxRect($e) { $r = $e.Current.BoundingRectangle; if ($r.IsEmpty) { return $null }; return @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } }
function NxPName($procId) { try { return (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return '' } }
function NxFocused() {
  try { $f = $AE::FocusedElement } catch { return @{ ok = $false } }
  if ($null -eq $f) { return @{ ok = $false } }
  $fpid = $f.Current.ProcessId
  return @{ ok = $true; pid = $fpid; process = (NxPName $fpid) }
}
function NxTopWindows($procId) {
  $out = New-Object System.Collections.ArrayList
  $c = $TW.GetFirstChild($AE::RootElement)
  $n = 0
  while ($null -ne $c -and $n -lt 400) {
    $n++
    $cpid = $c.Current.ProcessId
    if ($cpid -eq $procId) { [void]$out.Add($c) }
    elseif ((NxPName $cpid) -eq 'ApplicationFrameHost') {
      $k = $TW.GetFirstChild($c); $m = 0
      while ($null -ne $k -and $m -lt 50) { $m++; if ($k.Current.ProcessId -eq $procId) { [void]$out.Add($c); break }; $k = $TW.GetNextSibling($k) }
    }
    $c = $TW.GetNextSibling($c)
  }
  return ,$out
}
$res = @{ mode = $a.mode; root = (NxRect $AE::RootElement) }
if ($null -ne $a.pid) { $res.target = @{ pid = [int]$a.pid; process = (NxPName ([int]$a.pid)) } }
switch ($a.mode) {
  'focused' { $res.focused = NxFocused }
  'at' {
    $pt = New-Object System.Windows.Point ([double]$a.x), ([double]$a.y)
    $e = $AE::FromPoint($pt)
    $epid = $e.Current.ProcessId
    $res.at = @{ pid = $epid; process = (NxPName $epid); controlType = $e.Current.ControlType.ProgrammaticName }
    $res.focused = NxFocused
  }
  'activate' {
    $ws = New-Object -ComObject WScript.Shell
    $r1 = $false; $r2 = $false
    try { $r1 = $ws.AppActivate([int]$a.pid) } catch { }
    Start-Sleep -Milliseconds 400
    $f = NxFocused
    if (-not ($f.ok -and $f.pid -eq [int]$a.pid) -and $a.title) {
      try { $r2 = $ws.AppActivate([string]$a.title) } catch { }
      Start-Sleep -Milliseconds 400
      $f = NxFocused
    }
    $res.appActivateByPid = [bool]$r1; $res.appActivateByTitle = [bool]$r2; $res.focused = $f
  }
  'windows' {
    $ws = NxTopWindows ([int]$a.pid)
    $res.windows = @($ws | ForEach-Object { @{ name = $_.Current.Name; className = $_.Current.ClassName; rect = (NxRect $_); pid = $_.Current.ProcessId } })
    $res.focused = NxFocused
  }
  'tree' {
    $max = [int]$a.max; $depthMax = [int]$a.depth
    $script:count = 0
    function NxWalk($e, $d) {
      if ($script:count -ge $max) { return $null }
      $script:count++
      $nm = $e.Current.Name; if ($nm.Length -gt 80) { $nm = $nm.Substring(0, 80) }
      $node = @{ type = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''); name = $nm; id = $e.Current.AutomationId; rect = (NxRect $e); enabled = $e.Current.IsEnabled }
      if ($d -lt $depthMax) {
        $kids = New-Object System.Collections.ArrayList
        $k = $TW.GetFirstChild($e)
        while ($null -ne $k -and $script:count -lt $max) { $w = NxWalk $k ($d + 1); if ($null -ne $w) { [void]$kids.Add($w) }; $k = $TW.GetNextSibling($k) }
        if ($kids.Count -gt 0) { $node.children = @($kids) }
      }
      return $node
    }
    $res.tree = @((NxTopWindows ([int]$a.pid)) | ForEach-Object { NxWalk $_ 0 })
    $res.nodes = $script:count
  }
  default { throw 'bad_mode' }
}
ConvertTo-Json -InputObject $res -Depth 30 -Compress | Out-File -LiteralPath $env:NEXUS_UIA_OUT -Encoding utf8
`;
