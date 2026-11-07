# Fixed-purpose NEXUS Recovery Watchdog launcher. No arbitrary commands.
# Intended for the signed Windows PowerShell executable with -WindowStyle Hidden.
$ErrorActionPreference = 'Stop'
try {
    $homeRoot = [Environment]::GetFolderPath('UserProfile')
    $node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    $dir = Join-Path $homeRoot 'Documents\NEXUS\recovery-watchdog'
    $script = Join-Path $dir 'recovery-watchdog.mjs'
    if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $script -PathType Leaf)) { exit 21 }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $node
    $psi.Arguments = ('"' + $script + '" --once')
    $psi.WorkingDirectory = $dir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($null -eq $p) { exit 22 }
    if (-not $p.WaitForExit(41000)) { try { $p.Kill() } catch {}; exit 23 }
    exit $p.ExitCode
} catch { exit 24 }
