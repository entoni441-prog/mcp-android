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

    # Microsoft recommends Children, NEVER Descendants, at desktop root.
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $desktop.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition
    )

    $matches = [System.Collections.ArrayList]::new()
    foreach ($window in $windows) {
        try {
            $current = $window.Current
            if ($current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
                continue
            }
            $pid = [int]$current.ProcessId
            if ($pid -le 0) {
                continue
            }
            $proc = Get-Process -Id $pid -ErrorAction Stop
            if ($allowed -contains $proc.ProcessName) {
                [void]$matches.Add($window)
            }
        } catch {
            # Other applications are never queried for control names or values.
            continue
        }
    }

    if ($matches.Count -ne 1) {
        Write-Result 'blocked' 'target_window_not_unique_or_not_found' ([ordered]@{
            targetCount = $matches.Count
        })
        exit 2
    }

    $target = $matches[0]
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
