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
 *  minimize  {pid,hwnd}        → ONLY validated WindowsTerminal WindowPattern visual state; no mouse/key/commands
 *  activate  {pid,title?}      → WScript.Shell.AppActivate(pid), fallback AppActivate(title); result re-read from UIA
 *  windows   {pid}             → top-level windows owned by pid (or ApplicationFrameHost frames hosting it)
 *  tree      {pid,depth,max}   → control tree of those windows (bounded)
 *  context                     → focused element (type/name/id) + its top-level window (hwnd, tabs)          [0.4.2]
 *  apps      {name}            → all top-level windows of processes named {name}, each with hwnd and tabs     [0.4.2]
 * 0.4.2: 'at' also returns element name/automationId, its top-level window hwnd and the TabItem it lies in;
 *        'activate' also reports the focused top-level window hwnd (focus confirmed by window, not only by pid).
 * 0.5.1: apps — also ApplicationFrameHost frames hosting {name} (UWP Calculator): process/pid of the hosted app, hwnd of
 *        the frame (the window the user sees); activate {pid,hwnd?} — restore if minimised, UIA SetFocus on the window,
 *        then AppActivate, with diagnostics; close {hwnd,rid?} — one tab (select + its close button, Invoke) or the window
 *        (WindowPattern.Close); dialog {hwnd,choice?} — Save / Don't save / Cancel prompt of that window (in-window or
 *        a top-level dialog of the same process); with choice, Invoke that button (rect returned if not invokable).
 * Every mode returns `root` = UIA desktop rectangle, used by Node to map UIA coordinates to Java screen points.
 */
export const UIA_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
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
# NX-052-21: Steam UI belongs to steamwebhelper. Accept only a live, same-session,
# creation-time-ordered parent chain to a live Steam root. Unknown ancestry adds nothing.
function NxSteamFamily($rootId) {
  $ids = @($rootId)
  try {
    $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -in @('steam.exe', 'steamwebhelper.exe') })
    $root = $rows | Where-Object { $_.ProcessId -eq $rootId -and $_.Name -eq 'steam.exe' } | Select-Object -First 1
    if ($null -eq $root -or $null -eq $root.CreationDate) { return $ids }
    for ($depth = 0; $depth -lt 12; $depth++) {
      $added = $false
      foreach ($row in $rows) {
        if ($row.Name -ne 'steamwebhelper.exe' -or $row.ProcessId -in $ids -or $row.ParentProcessId -notin $ids -or $row.SessionId -ne $root.SessionId) { continue }
        $parent = $rows | Where-Object { $_.ProcessId -eq $row.ParentProcessId } | Select-Object -First 1
        if ($null -ne $row.CreationDate -and $null -ne $parent.CreationDate -and $row.CreationDate -ge $parent.CreationDate) {
          $ids += $row.ProcessId; $added = $true
        }
      }
      if (-not $added) { break }
    }
  } catch { }
  return $ids
}
function NxTopWindows($procId) {
  $family = @($procId)
  if ((NxPName $procId) -ieq 'steam') { $family = @(NxSteamFamily $procId) }
  $out = New-Object System.Collections.ArrayList
  $c = $TW.GetFirstChild($AE::RootElement)
  $n = 0
  while ($null -ne $c -and $n -lt 400) {
    $n++
    $cpid = $c.Current.ProcessId
    if ($cpid -in $family) { [void]$out.Add($c) }
    elseif ((NxPName $cpid) -eq 'ApplicationFrameHost') {
      $k = $TW.GetFirstChild($c); $m = 0
      while ($null -ne $k -and $m -lt 50) { $m++; if ($k.Current.ProcessId -eq $procId) { [void]$out.Add($c); break }; $k = $TW.GetNextSibling($k) }
    }
    $c = $TW.GetNextSibling($c)
  }
  return ,$out
}

# 0.5.2: managed UIA (.NET Framework) maps control-type ids it does not know (newer Windows: SemanticZoom, AppBar…)
# to $null — calling .ProgrammaticName on it threw «method on a null-valued expression» (inspect_ui on Win11 Explorer).
function NxType($e) { try { $ct = $e.Current.ControlType; if ($null -eq $ct -or $null -eq $ct.ProgrammaticName) { return 'Unknown' }; return ([string]$ct.ProgrammaticName).Replace('ControlType.', '') } catch { return 'Unknown' } }
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
function NxFindTab($w, $rid) {
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($w, 0)); $seen = 0
  while ($stack.Count -gt 0 -and $seen -lt 400) {
    $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $seen++
    if ($e.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem) { if ((NxRid $e) -eq $rid) { return $e }; continue }
    if ($d -ge 8) { continue }
    $k = $TW.GetFirstChild($e)
    while ($null -ne $k) { $stack.Push(@($k, ($d + 1))); $k = $TW.GetNextSibling($k) }
  }
  return $null
}
function NxWin($w) {
  if ($null -eq $w) { return $null }
  $wpid = $w.Current.ProcessId
  $tb = NxTabs $w   # ArrayList (returned with unary comma); @($tb) enumerates it — @(NxTabs $w) would wrap an empty list as [[]]
  return @{ hwnd = [int64]$w.Current.NativeWindowHandle; pid = $wpid; process = (NxPName $wpid); name = (NxStr $w.Current.Name 200); className = $w.Current.ClassName; rect = (NxRect $w); tabs = @($tb) }
}
# 0.5.2 R-01: is the top-level window a dialog, and what does it say? Text is used ONLY inside the Host to recognise
# «Are you sure / permanently» confirmations — it is never returned to the model (gui strips it).
function NxDlg($w) {
  if ($null -eq $w) { return $null }
  $modal = $false
  try { $modal = [bool]$w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Current.IsModal } catch { }
  $cls = [string]$w.Current.ClassName
  if (-not $modal -and $cls -ne '#32770') { return $null }
  $txt = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack; $stack.Push(@($w, 0)); $seen = 0
  while ($stack.Count -gt 0 -and $seen -lt 250 -and $txt.Count -lt 12) {
    $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $seen++
    # Windows CI 41477712638: in a real MessageBox UIA exposes the message (and the buttons) as Pane, not Text —
    # so every named descendant except the window itself is collected; buttons («Yes»/«No») never match the
    # confirmation wording, so they do not change the decision.
    if ($seen -gt 1) { $nm = NxStr $e.Current.Name 200; if ($nm) { [void]$txt.Add($nm) } }
    if ($d -ge 8) { continue }
    $k = $TW.GetFirstChild($e)
    while ($null -ne $k) { $stack.Push(@($k, ($d + 1))); $k = $TW.GetNextSibling($k) }
  }
  return @{ modal = $modal; className = $cls; title = (NxStr $w.Current.Name 200); text = @($txt) }
}
function NxElem($e) {
  return @{ controlType = (NxType $e); name = (NxStr $e.Current.Name 120); id = (NxStr $e.Current.AutomationId 80); className = (NxStr $e.Current.ClassName 80) }
}
# NX-13: bounded UIA ancestry + Win32 owner/PID verification for Edge translation popup.
function NxEdgeTranslateBubble($e, $top, $epid) {
  try {
    if ((NxPName $epid) -ine 'msedge' -or (NxType $e) -ne 'Button' -or
        (([string]$e.Current.Name) -notmatch '^(?:Закрыть|Close)$')) { return $null }
    if ($null -eq $top -or $top.Current.ClassName -ne 'Chrome_WidgetWin_1') { return $null }
    $mainHwnd = [int64]$top.Current.NativeWindowHandle
    if ($mainHwnd -le 0 -or [int]$top.Current.ProcessId -ne [int]$epid) { return $null }
    $cur = $e
    # FIRST ancestor with a native HWND must be the bubble. Never skip a foreign HWND.
    for ($depth = 1; $depth -le 6; $depth++) {
      $cur = $TW.GetParent($cur)
      if ($null -eq $cur) { return $null }
      $popupHwnd = [int64]$cur.Current.NativeWindowHandle
      if ($popupHwnd -le 0) { continue }
      $title = NxStr $cur.Current.Name 200
      if ($cur.Current.ClassName -ne 'Chrome_WidgetWin_1' -or $popupHwnd -eq $mainHwnd -or
          [int]$cur.Current.ProcessId -ne [int]$epid -or
          $title -notmatch '^(?:Перевести страницу с .+\?|Translate (?:this )?page(?: from .+)?\?)$') { return $null }
      # Explicit namespace is essential: Add-Type -Name alone uses an autogenerated namespace.
      if (-not ('Nx13.OwnerApi' -as [type])) {
        Add-Type -Namespace Nx13 -Name OwnerApi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetWindow(System.IntPtr hwnd, uint command);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint pid);
'@
      }
      $h = [IntPtr]$popupHwnd
      $ownerHwnd = [int64][Nx13.OwnerApi]::GetWindow($h, [uint32]4) # GW_OWNER
      $rootOwnerHwnd = [int64][Nx13.OwnerApi]::GetAncestor($h, [uint32]3) # GA_ROOTOWNER
      [uint32]$popupPid = 0
      [uint32]$mainPid = 0
      [void][Nx13.OwnerApi]::GetWindowThreadProcessId($h, [ref]$popupPid)
      [void][Nx13.OwnerApi]::GetWindowThreadProcessId([IntPtr]$mainHwnd, [ref]$mainPid)
      if ($ownerHwnd -ne $mainHwnd -or $rootOwnerHwnd -ne $mainHwnd -or
          $popupPid -ne [uint32]$epid -or $mainPid -ne [uint32]$epid) { return $null }
      return @{ verified = $true; hwnd = $popupHwnd; mainHwnd = $mainHwnd
        ownerHwnd = $ownerHwnd; rootOwnerHwnd = $rootOwnerHwnd; pid = [int]$popupPid
        mainPid = [int]$mainPid; depth = [int]$depth; name = $title
        className = 'Chrome_WidgetWin_1'; reason = 'edge_translate_win32_owner_verified' }
    }
  } catch { return $null } # UIA or Win32 failure MUST retain consent.
  return $null
}
# NX-26 read-only Win32 hit-test at the exact titlebar probe point.
# WindowFromPoint respects Z-order. GA_ROOT converts child HWND to the actual top-level window.
function Nx26NativeHit($x, $y) {
  try {
    if (-not ('Nx26.HitTest' -as [type])) {
      Add-Type -Namespace Nx26 -Name HitTest -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct POINT { public int X; public int Y; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr WindowFromPoint(POINT point);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hwnd, out uint processId);
public static long TopAt(int x, int y) {
  var child = WindowFromPoint(new POINT { X = x, Y = y });
  return child == System.IntPtr.Zero ? 0 : GetAncestor(child, 2).ToInt64();
}
'@
    }
    $nativeHwnd = [int64][Nx26.HitTest]::TopAt([int]$x, [int]$y)
    if ($nativeHwnd -le 0) { return @{ ok = $false } }
    [uint32]$hitProcessId = 0
    [void][Nx26.HitTest]::GetWindowThreadProcessId([IntPtr]$nativeHwnd, [ref]$hitProcessId)
    if ($hitProcessId -le 0) { return @{ ok = $false } }
    return @{ ok = $true; hwnd = $nativeHwnd; pid = [int]$hitProcessId }
  } catch { return @{ ok = $false } }
}
$res = @{ mode = $a.mode; root = (NxRect $AE::RootElement) }
if ($null -ne $a.pid) { $res.target = @{ pid = [int]$a.pid; process = (NxPName ([int]$a.pid)) } }
switch ($a.mode) {
  'focused' { $res.focused = NxFocused }
  'at' {
    $pt = New-Object System.Windows.Point ([double]$a.x), ([double]$a.y)
    $e = $AE::FromPoint($pt)
    $epid = $e.Current.ProcessId
    $res.at = @{ pid = $epid; process = (NxPName $epid); controlType = ('ControlType.' + (NxType $e)); elem = (NxElem $e) }
    $tab = NxTabOf $e
    if ($null -ne $tab) { $res.at.tab = @{ rid = (NxRid $tab); name = (NxStr $tab.Current.Name 120) } }
    $top = NxTopOf $e
    $res.at.window = NxWin $top
    if ($a.nativeHitTest -eq $true) { $res.at.nativeHit = Nx26NativeHit ([int]$a.x) ([int]$a.y) }
    try { $p = $TW.GetParent($e); if ($null -ne $p) { $res.at.parentType = (NxType $p); $res.at.parent = @{ name = (NxStr $p.Current.Name 200); className = $p.Current.ClassName; hwnd = [int64]$p.Current.NativeWindowHandle } } } catch { }
    $proof = NxEdgeTranslateBubble $e $top $epid
    if ($null -ne $proof) { $res.at.nativeBubble = $proof }
    try { $res.at.dialog = NxDlg $top } catch { }
    $res.focused = NxFocused
  }
  'minimize' {
    # NX-TM-01: WindowPattern only. The terminal's edit surface, mouse,
    # keyboard and process commands are NEVER used. HWND and process identity
    # are revalidated in this separate fixed UIA operation.
    $res.verified = $false
    $res.pid = [int]$a.pid
    $res.hwnd = [int64]$a.hwnd
    $res.isMinimizedAfter = $false
    $res.wasMinimized = $false
    if ($res.pid -gt 0 -and $res.hwnd -gt 0) {
      try {
        $w = $AE::FromHandle([IntPtr]$res.hwnd)
        if ($null -ne $w -and [int]$w.Current.ProcessId -eq $res.pid -and
            [int64]$w.Current.NativeWindowHandle -eq $res.hwnd -and
            (NxPName $res.pid) -ieq 'WindowsTerminal' -and
            (NxTopOf $w).Current.NativeWindowHandle -eq $res.hwnd) {
          $wp = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
          if ($null -ne $wp -and $wp.Current.CanMinimize) {
            $res.wasMinimized = $wp.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized
            if (-not $res.wasMinimized) {
              $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)
              Start-Sleep -Milliseconds 150
            }
            $v = $AE::FromHandle([IntPtr]$res.hwnd)
            if ($null -ne $v -and [int]$v.Current.ProcessId -eq $res.pid -and
                [int64]$v.Current.NativeWindowHandle -eq $res.hwnd) {
              $p2 = $v.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
              $res.isMinimizedAfter = $p2.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized
              $res.verified = [bool]$res.isMinimizedAfter
              $res.process = NxPName $res.pid
            }
          }
        }
      } catch { $res.error = 'WINDOW_PATTERN_UNAVAILABLE' }
    }
  }
  'activate' {
    $res.foregroundBefore = NxFocused
    $w = $null
    if ($a.hwnd) { try { $w = $AE::FromHandle([IntPtr]([int64]$a.hwnd)) } catch { $w = $null } }
    $res.windowFound = ($null -ne $w)
    $res.setFocus = $false; $res.wasMinimized = $false
    if ($null -ne $w) {
      try { $res.offscreen = [bool]$w.Current.IsOffscreen } catch { }
      try {
        $wp = $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        if ($wp.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
          $res.wasMinimized = $true; $wp.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal); Start-Sleep -Milliseconds 300
        }
      } catch { }
      try { $w.SetFocus(); $res.setFocus = $true } catch { $res.setFocusError = (NxStr $_.Exception.GetType().Name 60) }
      Start-Sleep -Milliseconds 300
    }
    $f = NxFocused
    $ws = New-Object -ComObject WScript.Shell
    $r1 = $false; $r2 = $false
    if (-not ($f.ok -and ($f.pid -eq [int]$a.pid -or ($a.hwnd -and $f.topHwnd -eq [int64]$a.hwnd)))) {
      try { $r1 = $ws.AppActivate([int]$a.pid) } catch { }
      Start-Sleep -Milliseconds 400
      $f = NxFocused
      if (-not ($f.ok -and $f.pid -eq [int]$a.pid) -and $a.title) {
        try { $r2 = $ws.AppActivate([string]$a.title) } catch { }
        Start-Sleep -Milliseconds 400
        $f = NxFocused
      }
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
      # 0.5.2: one unreadable/vanished element (Explorer views change while walked) must not fail the whole tree.
      try {
        $nm = NxStr $e.Current.Name 80
        $node = @{ type = (NxType $e); name = $nm; id = $e.Current.AutomationId; className = $e.Current.ClassName; rect = (NxRect $e); enabled = $e.Current.IsEnabled }
      } catch { return @{ type = 'Unknown'; name = ''; unreadable = $true } }
      if ($d -lt $depthMax) {
        $kids = New-Object System.Collections.ArrayList
        $k = $null; try { $k = $TW.GetFirstChild($e) } catch { }
        while ($null -ne $k -and $script:count -lt $max) { $w = NxWalk $k ($d + 1); if ($null -ne $w) { [void]$kids.Add($w) }; try { $k = $TW.GetNextSibling($k) } catch { $k = $null } }
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
      $top = NxTopOf $f
      $res.window = NxWin $top
      try { $p = $TW.GetParent($f); if ($null -ne $p) { $res.parentType = (NxType $p) } } catch { }
      try { $res.dialog = NxDlg $top } catch { }
    } catch { }
  }
  'apps' {
    $want = ([string]$a.name).ToLowerInvariant()
    $family = @(); $familyRoots = @{}
    if ($want -eq 'steam') {
      foreach ($sp in @(Get-Process -Name steam -ErrorAction SilentlyContinue)) {
        foreach ($member in @(NxSteamFamily $sp.Id)) { $family += $member; $familyRoots[[string]$member] = $sp.Id }
      }
    }
    $out = New-Object System.Collections.ArrayList
    $c = $TW.GetFirstChild($AE::RootElement); $n = 0
    while ($null -ne $c -and $n -lt 400) {
      $n++
      $pn = (NxPName $c.Current.ProcessId).ToLowerInvariant()
      if ($pn -eq $want -or $c.Current.ProcessId -in $family) {
        $w = NxWin $c
        if ($want -eq 'steam' -and $familyRoots.ContainsKey([string]$c.Current.ProcessId)) { $w.launchRootPid = $familyRoots[[string]$c.Current.ProcessId] }
        [void]$out.Add($w)
      }
      elseif ($pn -eq 'applicationframehost') {
        $k = $TW.GetFirstChild($c); $m = 0
        while ($null -ne $k -and $m -lt 50) {
          $m++
          $kp = $k.Current.ProcessId
          if ($kp -ne $c.Current.ProcessId -and (NxPName $kp).ToLowerInvariant() -eq $want) {
            $w = NxWin $c; $w.pid = $kp; $w.process = (NxPName $kp); $w.frameHost = $true; [void]$out.Add($w); break
          }
          $k = $TW.GetNextSibling($k)
        }
      }
      $c = $TW.GetNextSibling($c)
    }
    $res.apps = @($out)
  }
  'close' {
    $w = $null
    try { $w = $AE::FromHandle([IntPtr]([int64]$a.hwnd)) } catch { $w = $null }
    $res.found = $false; $res.invoked = $false
    if ($null -ne $w -and [int64]$w.Current.NativeWindowHandle -eq [int64]$a.hwnd) {
      if ($a.rid) {
        $tab = NxFindTab $w ([string]$a.rid)
        if ($null -ne $tab) {
          $res.found = $true
          try { $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() } catch { }
          # 0.5.1 live fix: Win11 Notepad (WinUI TabView) shows the close button only on the selected/hovered tab and it
          # can sit deeper than a direct child. Search all descendants (raw view) a few times after selecting.
          $RW = [System.Windows.Automation.TreeWalker]::RawViewWalker
          $btn = $null; $diag = New-Object System.Collections.ArrayList
          for ($try = 0; $try -lt 6 -and $null -eq $btn; $try++) {
            Start-Sleep -Milliseconds 250
            $cands = New-Object System.Collections.ArrayList
            $stack = New-Object System.Collections.Stack; $stack.Push(@($tab, 0)); $seen = 0
            while ($stack.Count -gt 0 -and $seen -lt 200) {
              $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $seen++
              if ($d -gt 0 -and $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button) { [void]$cands.Add($e) }
              if ($d -ge 5) { continue }
              $k = $RW.GetFirstChild($e); while ($null -ne $k) { $stack.Push(@($k, ($d + 1))); $k = $RW.GetNextSibling($k) }
            }
            foreach ($c in $cands) { if ($c.Current.AutomationId -imatch 'close' -or $c.Current.Name -imatch '(close|закрыть|chiudi|schlie)') { $btn = $c; break } }
            if ($null -eq $btn -and $cands.Count -eq 1) { $btn = $cands[0] }
            if ($try -eq 0) { foreach ($c in $cands) { [void]$diag.Add(@{ name = (NxStr $c.Current.Name 40); id = (NxStr $c.Current.AutomationId 40) }) } }
          }
          $res.tabButtons = @($diag)
          try { $res.tabSelected = [bool]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch { }
          if ($null -ne $btn) {
            try { $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $res.invoked = $true; $res.method = 'tab_close_button' } catch { $res.method = 'tab_close_button_not_invokable' }
          } else { $res.method = 'tab_close_button_missing' }
        }
      } else {
        $res.found = $true
        try { $w.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); $res.invoked = $true; $res.method = 'WindowPattern.Close' } catch { $res.method = 'window_pattern_failed' }
      }
    }
  }
  'dialog' {
    $w = $null
    try { $w = $AE::FromHandle([IntPtr]([int64]$a.hwnd)) } catch { $w = $null }
    $roots = New-Object System.Collections.ArrayList
    if ($null -ne $w) {
      [void]$roots.Add($w)
      $wp = $w.Current.ProcessId
      $c = $TW.GetFirstChild($AE::RootElement); $n = 0
      while ($null -ne $c -and $n -lt 400) { $n++; if ($c.Current.ProcessId -eq $wp -and [int64]$c.Current.NativeWindowHandle -ne [int64]$a.hwnd) { [void]$roots.Add($c) }; $c = $TW.GetNextSibling($c) }
    }
    $found = @{}
    foreach ($r in $roots) {
      $stack = New-Object System.Collections.Stack; $stack.Push(@($r, 0)); $seen = 0
      while ($stack.Count -gt 0 -and $seen -lt 600) {
        $item = $stack.Pop(); $e = $item[0]; $d = $item[1]; $seen++
        $ct = (NxType $e)
        $nm = [string]$e.Current.Name
        if (@('Button', 'Pane', 'Custom') -contains $ct -and $nm.Length -le 30) {
          $role = $null
          if ($nm -imatch '^(save|сохранить)$') { $role = 'save' }
          elseif ($nm -imatch "^(don.?t save|do not save|не сохранять)$") { $role = 'discard' }
          elseif ($nm -imatch '^(cancel|отмена)$') { $role = 'cancel' }
          if ($null -ne $role -and -not $found.ContainsKey($role)) { $found[$role] = $e }
        }
        if ($d -ge 12) { continue }
        $k = $TW.GetFirstChild($e); $kids = New-Object System.Collections.ArrayList
        while ($null -ne $k -and $kids.Count -lt 200) { [void]$kids.Add($k); $k = $TW.GetNextSibling($k) }
        for ($i = $kids.Count - 1; $i -ge 0; $i--) { $stack.Push(@($kids[$i], ($d + 1))) }
      }
      if ($found.ContainsKey('discard')) { break }
    }
    # A real save prompt always has «Don't save»; Save / Cancel alone can be ordinary toolbar buttons.
    $res.dialog = $null
    if ($found.ContainsKey('discard')) {
      $res.dialog = @{ buttons = @($found.Keys | ForEach-Object { @{ role = $_; name = (NxStr $found[$_].Current.Name 30); rect = (NxRect $found[$_]) } }) }
      if ($a.choice -and $found.ContainsKey([string]$a.choice)) {
        $b = $found[[string]$a.choice]
        $res.choice = [string]$a.choice
        try { $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); $res.invoked = $true } catch { $res.invoked = $false; $res.rect = (NxRect $b) }
      }
    }
  }
  default { throw 'bad_mode' }
}
ConvertTo-Json -InputObject $res -Depth 30 -Compress | Out-File -LiteralPath $env:NEXUS_UIA_OUT -Encoding utf8
`;
