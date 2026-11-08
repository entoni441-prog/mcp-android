// NEXUS Installer Broker — fixed Windows launcher (NOT installed).
// Owner first provisions in Program Files by genuine Windows UAC.
// No free-form commands, no inherited NODE_OPTIONS, no auto login.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;

internal static class BrokerLauncher {
    private const string Root = @"C:\Program Files\NEXUS\InstallerBroker";
    private const string Launcher = @"C:\Program Files\NEXUS\InstallerBroker\NEXUS-Broker-Launcher.exe";
    private const string Node = @"C:\Program Files\nodejs\node.exe";
    private const string Script = @"C:\Program Files\NEXUS\InstallerBroker\run-once.mjs";
    private const string Data = @"C:\ProgramData\NEXUS\InstallerBroker";

    // Owner-only Program Files code + Data ACL. Inbox is intentionally
    // untrusted: only individually signed envelopes may enter from there.
    private static readonly string[] ProtectedPaths = new string[] {
        @"C:\Program Files",
        @"C:\Program Files\nodejs",
        Node,
        @"C:\Program Files\NEXUS",
        Root,
        Launcher,
        Script,
        Root + @"\broker.mjs", Root + @"\contract.mjs",
        Root + @"\journal.mjs", Root + @"\windows-io.mjs",
        Root + @"\windows-package.mjs", Root + @"\acl-check.mjs",
        Root + @"\task-xml.mjs", Root + @"\trust.json",
        @"C:\ProgramData\NEXUS", Data,
        Data + @"\staging", Data + @"\journal"
    };

    private static bool IsAdmin() {
        var principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    private static bool TrustedAcl(string p) {
        if (!File.Exists(p) && !Directory.Exists(p)) return false;
        if ((File.GetAttributes(p) & FileAttributes.ReparsePoint) != 0) return false;
        FileSystemSecurity acl = Directory.Exists(p) ?
            (FileSystemSecurity)Directory.GetAccessControl(p, AccessControlSections.Owner | AccessControlSections.Access) :
            (FileSystemSecurity)File.GetAccessControl(p, AccessControlSections.Owner | AccessControlSections.Access);
        var owner = (SecurityIdentifier)acl.GetOwner(typeof(SecurityIdentifier));
        if (!TrustedSid(owner.Value)) return false;

        FileSystemRights unsafeRights =
            FileSystemRights.Write | FileSystemRights.Modify | FileSystemRights.FullControl |
            FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
            FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;

        var rules = acl.GetAccessRules(true, true, typeof(SecurityIdentifier));
        foreach (FileSystemAccessRule rule in rules) {
            if (rule.AccessControlType != AccessControlType.Allow) continue;
            var sid = ((SecurityIdentifier)rule.IdentityReference).Value;
            if (!TrustedSid(sid) && (rule.FileSystemRights & unsafeRights) != 0) return false;
        }
        return true;
    }

    private static bool TrustedSid(string sid) {
        return sid == "S-1-5-18" || sid == "S-1-5-32-544" ||
               sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    }

    private static bool VerifyAllAcls() {
        foreach (string p in ProtectedPaths) {
            if (!TrustedAcl(p)) return false;
        }
        return true;
    }

    private static bool IsPinned() {
        return String.Equals(Path.GetFullPath(Assembly.GetExecutingAssembly().Location),
            Launcher, StringComparison.OrdinalIgnoreCase);
    }

    private static int Main(string[] args) {
        try {
            if (!IsPinned()) return 41;
            if (!IsAdmin()) return 42;
            if (args.Length == 1 && args[0] == "--is-elevated") return 0;
            if (args.Length == 1 && args[0] == "--verify-acl") return VerifyAllAcls() ? 0 : 43;
            if (args.Length != 0) return 40;
            if (!VerifyAllAcls()) return 43;

            var start = new ProcessStartInfo {
                FileName = Node,
                Arguments = "\"" + Script + "\" --run-once",
                WorkingDirectory = Root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            // Replace, do not inherit: NODE_OPTIONS, NODE_PATH, npm/PATH preload.
            start.EnvironmentVariables.Clear();
            start.EnvironmentVariables["SystemRoot"] = @"C:\Windows";
            start.EnvironmentVariables["WINDIR"] = @"C:\Windows";
            start.EnvironmentVariables["PATH"] = @"C:\Windows\System32;C:\Windows";
            start.EnvironmentVariables["ComSpec"] = @"C:\Windows\System32\cmd.exe";
            string user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (String.IsNullOrEmpty(user)) return 44;
            start.EnvironmentVariables["USERPROFILE"] = user;
            var drive = Path.GetPathRoot(user);
            start.EnvironmentVariables["HOMEDRIVE"] = drive.TrimEnd('\\');
            start.EnvironmentVariables["HOMEPATH"] = user.Substring(drive.Length - 1);
            start.EnvironmentVariables["TEMP"] = @"C:\Windows\Temp";
            start.EnvironmentVariables["TMP"] = @"C:\Windows\Temp";

            using (Process child = Process.Start(start)) {
                if (child == null) return 45;
                if (!child.WaitForExit(5 * 60 * 1000)) {
                    try { child.Kill(); } catch { }
                    return 46;
                }
                return child.ExitCode;
            }
        } catch {
            return 47;
        }
    }
}
