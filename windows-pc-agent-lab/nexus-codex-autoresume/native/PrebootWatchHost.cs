// Pre-reboot STANDBY observer launcher, not a Guardian recovery executor.
// Uses an OS-owned named mutex (automatically released on crash), verifies
// the monitor source SHA-256, and waits for one Node child. NO secrets,
// Scheduler changes, powershell, Codex, shell commands, or arbitrary scripts.
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Threading;

public static class PrebootWatchHost {
  const string MUTEX_NAME=@"Local\NEXUS-Guardian-Preboot-Watch";
  static bool IsRoot(string root) {
    if(String.IsNullOrWhiteSpace(root)||!Path.IsPathRooted(root))return false;
    string leaf=Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar));
    return Regex.IsMatch(leaf,@"^nexus-guardian-preboot-(watch|test-[a-f0-9]{8})$",
      RegexOptions.CultureInvariant);
  }
  static string Hash(string file){
    using(var sha=SHA256.Create())
    using(var stream=File.OpenRead(file)){
      return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
    }
  }
  static int Main(string[] args) {
    if(Environment.OSVersion.Platform!=PlatformID.Win32NT ||
       args.Length!=4||!Path.IsPathRooted(args[0])||
       !Path.IsPathRooted(args[1])||!IsRoot(args[2])||
       !Regex.IsMatch(args[3],@"^[a-f0-9]{64}$")||
       Path.GetFileName(args[0]).ToLowerInvariant()!="node.exe"||
       Path.GetFileName(args[1]).ToLowerInvariant()!="preboot-watch.mjs")return 64;
    string node=Path.GetFullPath(args[0]),
      script=Path.GetFullPath(args[1]),root=Path.GetFullPath(args[2]);
    if(!File.Exists(node)||!File.Exists(script)||Hash(script)!=args[3]){
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"WATCH_BINARY_MISMATCH\"}");
      return 17;
    }
    bool created=false;
    Mutex mutex=null;
    try {
      mutex=new Mutex(true,MUTEX_NAME,out created);
      if(!created){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"WATCH_ALREADY_OWNED\"}");
        return 11;
      }
      // Script/base Node are pinned to exact files, with fixed mode and root.
      // No shell interpolation, detached processes, or inherited credentials.
      if(script.Contains("\"")||root.Contains("\"")||node.Contains("\""))
        return 64;
      var start=new ProcessStartInfo {
        FileName=node,
        Arguments="\""+script+"\" --root \""+root+"\" --mode resident",
        WorkingDirectory=Path.GetDirectoryName(script),
        UseShellExecute=false,
        CreateNoWindow=true
      };
      using(Process child=new Process()){
        child.StartInfo=start;
        if(!child.Start())return 21;
        child.WaitForExit();
        return child.ExitCode;
      }
    }catch(Exception){
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"WATCH_LAUNCH_FAILED\"}");
      return 20;
    }finally{
      if(mutex!=null){
        if(created)mutex.ReleaseMutex();
        mutex.Dispose();
      }
    }
  }
}
