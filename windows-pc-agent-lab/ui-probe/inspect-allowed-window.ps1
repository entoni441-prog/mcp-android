#Requires -Version 5.1
<#
  Safe local UI Automation read-only feasibility probe.
  - No cloud network, no task polling, no remote control or file writes.
  - Requires visible per-invocation local consent.
  - Only existing Notepad or Calculator foreground windows are eligible.
  - Emits structural metadata only (NO titles, text, values or screenshots).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('notepad', 'calculator')]
    [string]$App,

    [switch]$IApproveLocalInspection,

    [ValidateRange(1, 40)]
    [int]$MaxControls = 24
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Result([string]$Status, [string]$Reason, [object]$Metadata) {
    $result = [ordered]@{
        status = $Status
        reason = $Reason
        mode = 'local_read_only'
        app = $App
        metadata = $Metadata
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
}

# No inspection before the local user supplies explicit consent.
if (-not $IApproveLocalInspection) {
    Write-Result 'blocked' 'explicit_local_consent_required' $null
    exit 2
}
if (-not [Environment]::UserInteractive -or
    [System.Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
    Write-Result 'blocked' 'interactive_user_session_required' $null
    exit 2
}

try {
    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
    Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop

    # Fixed allowlist, independent of untrusted window names/titles.
    $allowed = switch ($App) {
        'notepad' { @('notepad') }
        'calculator' { @('CalculatorApp') }
    }

    # Read ONLY the foreground window selected by the local user.
    # No enumeration or inspection of unrelated desktop windows.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LocalForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@ -ErrorAction Stop
    $hwnd = [LocalForegroundWindow]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) {
        Write-Result 'blocked' 'no_foreground_window' $null
        exit 2
    }
    $target = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $target) {
        Write-Result 'blocked' 'foreground_uia_unavailable' $null
        exit 2
    }
    $targetProcessId = [int]$target.Current.ProcessId
    if ($targetProcessId -le 0) {
        Write-Result 'blocked' 'foreground_identity_unknown' $null
        exit 2
    }
    $targetProcess = Get-Process -Id $targetProcessId -ErrorAction Stop
    if ($allowed -notcontains $targetProcess.ProcessName) {
        Write-Result 'blocked' 'foreground_app_not_allowlisted' $null
        exit 2
    }
    if ($target.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
        Write-Result 'blocked' 'foreground_element_is_not_window' $null
        exit 2
    }

    $items = [System.Collections.ArrayList]::new()
    $controls = $target.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $count = [Math]::Min($controls.Count, $MaxControls)
    for ($i = 0; $i -lt $count; $i++) {
        try {
            $control = $controls[$i].Current
            $type = [string]$control.ControlType.ProgrammaticName
            # Do NOT inspect control.Name, ValuePattern, text or bounding rectangle.
            $id = [string]$control.AutomationId
            if ($id.Length -gt 48 -or $id -notmatch '^[a-zA-Z0-9_.-]*$') {
                $id = ''
            }
            [void]$items.Add([ordered]@{
                controlType = $type
                automationId = $id
                isEnabled = [bool]$control.IsEnabled
            })
        } catch {
            # A control can disappear between enumeration and property read.
            continue
        }
    }
    Write-Result 'ok' 'inspection_completed' ([ordered]@{
        observedControls = $items.Count
        truncated = ($controls.Count -gt $count)
        controls = @($items.ToArray())
    })
    exit 0
} catch {
    # No exception or window title is emitted: they can contain private content.
    Write-Result 'error' 'uia_unavailable_or_access_denied' $null
    exit 3
}
