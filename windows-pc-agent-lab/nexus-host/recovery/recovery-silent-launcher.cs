// Independent Windows GUI-subsystem launch shim for the existing fixed NEXUS Recovery Watchdog.
// Compiled with the Windows .NET Framework C# compiler /target:winexe, so Task Scheduler
// does not open a console. Starts ONLY the already-installed local watchdog, no arbitrary CLI.
using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
internal static class RecoverySilentLauncher {
  private static int Main(string[] args) {
    if (args.Length != 0) return 64;
    try {
      string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
      string node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
      string dir = Path.Combine(home, "Documents", "NEXUS", "recovery-watchdog");
      string script = Path.Combine(dir, "recovery-watchdog.mjs");
      if (!File.Exists(node) || !File.Exists(script)) return 21;
      if (WindowsIdentity.GetCurrent() == null || WindowsIdentity.GetCurrent().IsSystem) return 22;
      var psi = new ProcessStartInfo {
        FileName = node,
        Arguments = "\\"" + script + "\\" --once",
        WorkingDirectory = dir,
        UseShellExecute = false,
        CreateNoWindow = true,
        WindowStyle = ProcessWindowStyle.Hidden,
        RedirectStandardOutput = false,
        RedirectStandardError = false
      };
      using (var p = Process.Start(psi)) {
        if (p == null) return 23;
        if (!p.WaitForExit(41000)) { try { p.Kill(); } catch {} return 24; }
        return p.ExitCode;
      }
    } catch { return 25; }
  }
}
