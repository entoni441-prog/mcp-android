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
 *  context                     → focused element (type/name/id) + its top-level window (hwnd, tabs)          [0.4.2]
 *  apps      {name}            → all top-level windows of processes named {name}, each with hwnd and tabs     [0.4.2]
 * 0.4.2: 'at' also returns element name/automationId, its top-level window hwnd and the TabItem it lies in;
 *        'activate' also reports the focused top-level window hwnd (focus confirmed by window, not only by pid).
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
  $top = $null; try { $top = NxTopOf $f } catch { }
  $th = 0; if ($null -ne $top) { $th = [int64]$top.Current.NativeWindowHandle }
  return @{ ok = $true; pid = $fpid; process = (NxPName $fpid); topHwnd = $th }
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

function NxStr($v, $n) { $t = [string]$v; if ($t.Length -gt $n) { return $t.Substring(0, $n) }; return $t }
function NxRid($e) { try { return (($e.GetRuntimeId()) -join '.') } catch { return '' } }
function NxTopOf($e) {
  $root = $AE::RootElement; $cur = $e; $n = 0
  while ($null -ne $cur -and $n -lt 60) {
    $n++
    $p = $TW.GetParent($cur)
    if ($null -eq $p) { return $null }
    if ([System.Windows.Automation.Automation]::Compare($p, $root)) { return $cur }
    $cur = $p
  }
  return $null
}
function NxTabOf($e) {
  $cur = $e; $n = 0
  while ($null -ne $cur -and $n -lt 10) {
    $n++
    if ($cur.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem) { return $cur }
    $cur = $TW.GetParent($cur)
  }
  return $null
}
function NxTabs($w) {
  # Bounded walk (≤ 400 nodes, depth ≤ 8) instead of FindAll(Descendants): FindAll on a large/foreign window can take
  # tens of seconds. Tabs of Notepad/Terminal-like apps sit within a few levels of the window.
  $out = New-Object System.Collections.ArrayList
  if ($null -eq $w) { return ,$out }
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($w, 0)); $seen = 0
  while ($stack.Count -gt 0 -and $seen -lt 400 -and $out.Count -lt 100) {
    $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $seen++
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem) {
      $sel = $false
      try { $sel = $e.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { }
      [void]$out.Add(@{ rid = (NxRid $e); name = (NxStr $e.Current.Name 120); selected = [bool]$sel })
      continue
    }
    if ($d -ge 8) { continue }
    $k = $TW.GetFirstChild($e); $kids = New-Object System.Collections.ArrayList
    while ($null -ne $k -and $kids.Count -lt 200) { [void]$kids.Add($k); $k = $TW.GetNextSibling($k) }
    for ($i = $kids.Count - 1; $i -ge 0; $i--) { $stack.Push(@($kids[$i], ($d + 1))) }
  }
  return ,$out
}
function NxWin($w) {
  if ($null -eq $w) { return $null }
  $wpid = $w.Current.ProcessId
  $tb = NxTabs $w   # ArrayList (returned with unary comma); @($tb) enumerates it — @(NxTabs $w) would wrap an empty list as [[]]
  return @{ hwnd = [int64]$w.Current.NativeWindowHandle; pid = $wpid; process = (NxPName $wpid); name = (NxStr $w.Current.Name 200); className = $w.Current.ClassName; tabs = @($tb) }
}
function NxElem($e) {
  return @{ controlType = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''); name = (NxStr $e.Current.Name 120); id = (NxStr $e.Current.AutomationId 80) }
}
$res = @{ mode = $a.mode; root = (NxRect $AE::RootElement) }
if ($null -ne $a.pid) { $res.target = @{ pid = [int]$a.pid; process = (NxPName ([int]$a.pid)) } }
switch ($a.mode) {
  'focused' { $res.focused = NxFocused }
  'at' {
    $pt = New-Object System.Windows.Point ([double]$a.x), ([double]$a.y)
    $e = $AE::FromPoint($pt)
    $epid = $e.Current.ProcessId
    $res.at = @{ pid = $epid; process = (NxPName $epid); controlType = $e.Current.ControlType.ProgrammaticName; elem = (NxElem $e) }
    $tab = NxTabOf $e
    if ($null -ne $tab) { $res.at.tab = @{ rid = (NxRid $tab); name = (NxStr $tab.Current.Name 120) } }
    $res.at.window = NxWin (NxTopOf $e)
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
    $res.windows = @($ws | ForEach-Object { @{ name = $_.Current.Name; className = $_.Current.ClassName; rect = (NxRect $_); pid = $_.Current.ProcessId; hwnd = [int64]$_.Current.NativeWindowHandle } })
    $res.focused = NxFocused
  }
  'tree' {
    $max = [int]$a.max; $depthMax = [int]$a.depth
    $script:count = 0
    function NxWalk($e, $d) {
      if ($script:count -ge $max) { return $null }
      $script:count++
      $nm = $e.Current.Name; if ($nm.Length -gt 80) { $nm = $nm.Substring(0, 80) }
      $node = @{ type = $e.Current.ControlType.ProgrammaticName.Replace('ControlType.', ''); name = $nm; id = $e.Current.AutomationId; className = $e.Current.ClassName; rect = (NxRect $e); enabled = $e.Current.IsEnabled }
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
  'context' {
    $res.focused = NxFocused
    try {
      $f = $AE::FocusedElement
      $res.elem = NxElem $f
      $res.window = NxWin (NxTopOf $f)
    } catch { }
  }
  'apps' {
    $want = ([string]$a.name).ToLowerInvariant()
    $out = New-Object System.Collections.ArrayList
    $c = $TW.GetFirstChild($AE::RootElement); $n = 0
    while ($null -ne $c -and $n -lt 400) {
      $n++
      $pn = (NxPName $c.Current.ProcessId).ToLowerInvariant()
      if ($pn -eq $want) { [void]$out.Add((NxWin $c)) }
      $c = $TW.GetNextSibling($c)
    }
    $res.apps = @($out)
  }
  default { throw 'bad_mode' }
}
ConvertTo-Json -InputObject $res -Depth 30 -Compress | Out-File -LiteralPath $env:NEXUS_UIA_OUT -Encoding utf8
`;
