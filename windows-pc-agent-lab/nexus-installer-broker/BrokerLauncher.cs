// NEXUS Installer Broker — fixed environment native launcher.
// An administrator must explicitly provision this EXE in Program Files and
// register the corresponding HighAvailable task through genuine Windows UAC.
// Never run development copies with administrative privileges.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

internal static class BrokerLauncher {
    private const string Root = @"C:\Program Files\NEXUS\InstallerBroker";
    private const string Launcher = @"C:\Program Files\NEXUS\InstallerBroker\NEXUS-Broker-Launcher.exe";
    private const string Node = @"C:\Program Files\nodejs\node.exe";
    private const string Script = @"C:\Program Files\NEXUS\InstallerBroker\run-once.mjs";

    private static int Main(string[] args) {
        if (args.Length != 0) return 40;
        try {
            // A copy in a user-writable developer folder never elevates anything.
            if (!String.Equals(Path.GetFullPath(Assembly.GetExecutingAssembly().Location),
                               Launcher, StringComparison.OrdinalIgnoreCase)) return 41;
            if (!File.Exists(Node) || !File.Exists(Script)) return 42;
            if ((File.GetAttributes(Launcher) & FileAttributes.ReparsePoint) != 0) return 43;

            var p = new ProcessStartInfo();
            p.FileName = Node;
            p.Arguments = "\"" + Script + "\" --run-once";
            p.WorkingDirectory = Root;
            p.UseShellExecute = false;
            p.CreateNoWindow = true;
            p.WindowStyle = ProcessWindowStyle.Hidden;

            // Explicit environment replaces attacker-controlled NODE_OPTIONS,
            // NODE_PATH, NODE_EXTRA_CA_CERTS, npm hooks, PATH and runtime preload.
            p.EnvironmentVariables.Clear();
            p.EnvironmentVariables["SystemRoot"] = @"C:\Windows";
            p.EnvironmentVariables["WINDIR"] = @"C:\Windows";
            p.EnvironmentVariables["PATH"] = @"C:\Windows\System32;C:\Windows";
            p.EnvironmentVariables["ComSpec"] = @"C:\Windows\System32\cmd.exe";
            var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (String.IsNullOrEmpty(userProfile)) return 44;
            p.EnvironmentVariables["USERPROFILE"] = userProfile;
            p.EnvironmentVariables["HOMEDRIVE"] = Path.GetPathRoot(userProfile).TrimEnd('\\');
            p.EnvironmentVariables["HOMEPATH"] = userProfile.Substring(Path.GetPathRoot(userProfile).Length - 1);
            // Never inherit user-supplied TEMP/TMP paths for an admin operation.
            p.EnvironmentVariables["TEMP"] = @"C:\Windows\Temp";
            p.EnvironmentVariables["TMP"] = @"C:\Windows\Temp";

            using (Process child = Process.Start(p)) {
                if (child == null) return 45;
                // At most five minutes, independently of chat/tunnel/Host.
                if (!child.WaitForExit(5 * 60 * 1000)) {
                    // Do not silently relaunch on unknown installer state.
                    try { child.Kill(); } catch { }
                    return 46;
                }
                return child.ExitCode;
            }
        } catch {
            // Never echo secrets, command line or external output in task logs.
            return 47;
        }
    }
}
