// Experimental Windows-only native Job Object owner. No production registration.
// Compile with the Windows built-in .NET Framework csc.exe, without new SDKs.
// The executable accepts only a test fixture, under a fresh user Temp directory.
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
using System.Linq;

class GuardianJobHost {
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectExtendedLimitInformation = 9;
  const int JobObjectBasicAccountingInformation = 1;
  const uint WAIT_OBJECT_0 = 0;
  const uint WAIT_TIMEOUT = 0x102;
  const uint WAIT_FAILED = 0xFFFFFFFF;
  const int ERROR_ALREADY_EXISTS = 183;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
    public int dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2;
    public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public uint dwProcessId, dwThreadId;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public IntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public IntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public IntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }

  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateMutexW")]
  static extern IntPtr CreateMutex(IntPtr attributes, bool initialOwner, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool ReleaseMutex(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateJobObjectW")]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass,
      ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass,
      out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int length, IntPtr returnLength);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessW")]
  static extern bool CreateProcess(string app, StringBuilder commandLine, IntPtr processAttributes,
      IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
      ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint timeoutMs);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateProcess(IntPtr process, uint exitCode);

  static string Quote(string arg) {
    return "\"" + arg.Replace("\"", "\\\"") + "\"";
  }
  static bool IsTestPath(string directory) {
    string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    string full = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    return full.StartsWith(temp, StringComparison.OrdinalIgnoreCase) &&
           Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar)).StartsWith("nexus-job-test-", StringComparison.Ordinal);
  }
  static void WriteState(string dir, string task, string status, string reason, int owner, uint child, uint active) {
    // All dynamic text except taskId comes from fixed enums in this file.
    string data = "{\"taskId\":\"" + task + "\",\"status\":\"" + status +
      "\",\"reason\":\"" + reason + "\",\"ownerPid\":" + owner +
      ",\"childPid\":" + child + ",\"jobActive\":" + active +
      ",\"utc\":\"" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") + "\"}\n";
    string target = Path.Combine(dir, "job-host-status.json");
    string tmp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
    using (FileStream s = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
      byte[] bytes = Encoding.UTF8.GetBytes(data);
      s.Write(bytes, 0, bytes.Length);
      s.Flush(true);
    }
    if (File.Exists(target)) File.Replace(tmp, target, null);
    else File.Move(tmp, target);
  }
  static uint Active(IntPtr job) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION a;
    if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation,
        out a, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero))
      throw new InvalidOperationException("JOB_QUERY_FAILED");
    return a.ActiveProcesses;
  }
  static bool EmptyAfterTerminate(IntPtr job) {
    if (!TerminateJobObject(job, 53)) return false;
    Stopwatch timer = Stopwatch.StartNew();
    while (timer.ElapsedMilliseconds < 5000) {
      try { if (Active(job) == 0) return true; } catch { return false; }
      Thread.Sleep(50);
    }
    return false;
  }

  // Durable, create-only evidence. Never overwrite a previous generation.
  static void CreateReceipt(string file,string data) {
    byte[] bytes=Encoding.UTF8.GetBytes(data);
    using(FileStream h=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
      h.Write(bytes,0,bytes.Length);h.Flush(true);
    }
  }
  static long ProcessStartTicks(int pid) {
    using(Process p=Process.GetProcessById(pid))
      return p.StartTime.ToUniversalTime().Ticks;
  }
  // A reused PID is NOT proof the previous instance is still alive.
  // Any error other than a confirmed nonexistent PID fails closed.
  static bool PriorInstanceGone(int pid,long startTicks) {
    try { return ProcessStartTicks(pid)!=startTicks; }
    catch(ArgumentException) { return true; }
    catch { return false; }
  }
  static bool RecoveryPreflight(string dir,string task) {
    try {
      if(File.Exists(Path.Combine(dir,"owner","owner-stop.json")) ||
         File.Exists(Path.Combine(dir,"owner","host-off")) ||
         File.Exists(Path.Combine(dir,"state","complete.json")) ||
         File.Exists(Path.Combine(dir,"native-epoch-001.json")))return false;
      string[] fields=File.ReadAllLines(Path.Combine(dir,"native-job-assigned-e0.txt"));
      if(fields.Length!=8||fields[0]!="taskId="+task||
         fields[5]!="jobAssigned=1"||fields[6]!="inheritedHandles=0"||
         fields[7]!="breakaway=0")return false;
      int owner,child;long ownerTicks,childTicks;
      if(!Int32.TryParse(fields[1].Replace("ownerPid=",""),out owner) ||
         fields[1]!="ownerPid="+owner ||
         !Int64.TryParse(fields[2].Replace("ownerStartTicks=",""),out ownerTicks) ||
         fields[2]!="ownerStartTicks="+ownerTicks ||
         !Int32.TryParse(fields[3].Replace("childPid=",""),out child) ||
         fields[3]!="childPid="+child ||
         !Int64.TryParse(fields[4].Replace("childStartTicks=",""),out childTicks) ||
         fields[4]!="childStartTicks="+childTicks ||
         owner<1||child<1||ownerTicks<1||childTicks<1)return false;
      string expectedEpoch="{\"taskId\":\""+task+"\",\"epoch\":0,\"restartCount\":0,\"ownerPid\":"+owner+",\"ownerStartTicks\":"+ownerTicks+"}\n";
      if(File.ReadAllText(Path.Combine(dir,"native-epoch-000.json"))!=expectedEpoch)return false;
      // A previous owner with a live kernel job may not be replaced.
      if(!PriorInstanceGone(owner,ownerTicks)||!PriorInstanceGone(child,childTicks))return false;
      string previousStatus=File.ReadAllText(Path.Combine(dir,"job-host-status.json"));
      if(!previousStatus.Contains("\"taskId\":\""+task+"\",\"status\":\"RUNNING\"")||
         !previousStatus.Contains("\"ownerPid\":"+owner+",\"childPid\":"+child))return false;
      return true;
    }catch{return false;}
  }

  static int Main(string[] args) {
    if (Environment.OSVersion.Platform != PlatformID.Win32NT) return 64;
    // EXPLICITLY TEST-ONLY: no arbitrary executable, no production manifest.
    // run <taskId> <nodeExe> <testScript> <tempStateDir> <mode> <heartbeatTimeoutMs> <runtimeMs>
    if (args.Length != 8 || args[0] != "run" ||
        !Regex.IsMatch(args[1], @"^[A-Za-z0-9_-]{1,48}$") ||
        !Path.IsPathRooted(args[2]) || !File.Exists(args[2]) ||
        !String.Equals(Path.GetFileName(args[2]), "node.exe", StringComparison.OrdinalIgnoreCase) ||
        !Path.IsPathRooted(args[3]) || !File.Exists(args[3]) ||
        !new [] {"job-fixture.mjs", "guardian-integration-fixture.mjs"}.Contains(Path.GetFileName(args[3]),StringComparer.OrdinalIgnoreCase) ||
        !Path.IsPathRooted(args[4]) || !Directory.Exists(args[4]) ||
        !IsTestPath(args[4]) ||
        !(String.Equals(Path.GetFileName(args[3]),"guardian-integration-fixture.mjs",StringComparison.OrdinalIgnoreCase)
            ? new [] {"normal","hang","recover","committed"}.Contains(args[5])
            : new [] {"normal", "hold", "hang", "tree"}.Contains(args[5]))) {
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"INVALID_TEST_ARGS\"}");
      return 64;
    }
    int heartbeatMs, runtimeMs;
    if (!Int32.TryParse(args[6], out heartbeatMs) || heartbeatMs < 600 || heartbeatMs > 30000 ||
        !Int32.TryParse(args[7], out runtimeMs) || runtimeMs < 1000 || runtimeMs > 120000) {
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"INVALID_TIMEOUT\"}");
      return 64;
    }
    string task = args[1], node=Path.GetFullPath(args[2]), script=Path.GetFullPath(args[3]);
    string dir=Path.GetFullPath(args[4]), mode=args[5];
    string mutexName = "Global\\NEXUS-Codex-JobTest-" + task;
    IntPtr mutex=IntPtr.Zero, job=IntPtr.Zero;
    PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
    bool owned=false, childCreated=false, assigned=false;
    int ownerPid = Process.GetCurrentProcess().Id;
    long ownerStartTicks=ProcessStartTicks(ownerPid);
    try {
      mutex=CreateMutex(IntPtr.Zero, true, mutexName);
      int mutexErr = Marshal.GetLastWin32Error();
      if (mutex==IntPtr.Zero) throw new InvalidOperationException("MUTEX_CREATE_FAILED");
      if (mutexErr==ERROR_ALREADY_EXISTS) {
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"DUPLICATE_OWNER\"}");
        return 12;
      }
      owned=true;
      bool integration=String.Equals(Path.GetFileName(script),"guardian-integration-fixture.mjs",StringComparison.OrdinalIgnoreCase);
      bool recovering=integration && mode=="recover";
      // The exact-thread recovery child has NOT passed acceptance yet.
      // Do not burn epoch 1 or launch anything until that gate is delivered.
      if(recovering){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"RECOVERY_NOT_ENABLED\"}");
        return 25;
      }
      if(integration){
        if(recovering && !RecoveryPreflight(dir,task)){
          Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"NATIVE_RECOVERY_UNSAFE\"}");
          return 24;
        }
        string receiptPath=Path.Combine(dir,recovering?"native-epoch-001.json":"native-epoch-000.json");
        try{
          // Task restart budget is currently ONE per exact saved session.
          // This durable record is burned BEFORE the recovery child can run.
          string receipt="{\"taskId\":\""+task+"\",\"epoch\":"+(recovering?1:0)+
            ",\"restartCount\":"+(recovering?1:0)+",\"ownerPid\":"+ownerPid+
            ",\"ownerStartTicks\":"+ownerStartTicks+"}\n";
          CreateReceipt(receiptPath,receipt);
          // Start the durable restart budget under the SAME native mutex, before
          // the first worker is resumed. Child runners cannot initialize it.
          // An interrupted creation fails closed; no receipt is overwritten.
          if(!recovering){
            string budget="{\"version\":1,\"taskId\":\""+task+"\",\"baseEpoch\":0,\"maxAttempts\":5}\n";
            CreateReceipt(Path.Combine(dir,"budget-anchor.json"),budget);
          }
        }catch(IOException){
          if(File.Exists(receiptPath)){
            Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"NATIVE_EPOCH_ALREADY_CLAIMED\"}");
            return 17;
          }
          throw new InvalidOperationException("NATIVE_EPOCH_IO_ERROR");
        }
      }
      job=CreateJobObject(IntPtr.Zero,null);
      if (job==IntPtr.Zero) throw new InvalidOperationException("JOB_CREATE_FAILED");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!SetInformationJobObject(job,JobObjectExtendedLimitInformation,ref limits,
        Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
        throw new InvalidOperationException("JOB_CONFIG_FAILED");

      STARTUPINFO si = new STARTUPINFO();
      si.cb=Marshal.SizeOf(typeof(STARTUPINFO));
      StringBuilder cmd = new StringBuilder(Quote(node)+" "+Quote(script)+" "+Quote(dir)+" "+Quote(mode));
      if (!CreateProcess(node,cmd,IntPtr.Zero,IntPtr.Zero,false,
          CREATE_SUSPENDED|CREATE_NO_WINDOW,IntPtr.Zero,Path.GetDirectoryName(script),ref si,out pi))
        throw new InvalidOperationException("CHILD_CREATE_FAILED");
      childCreated=true;
      // Test-only fault injection: the suspended child must never execute.
      if (Environment.GetEnvironmentVariable("NEXUS_TEST_BEFORE_ASSIGN")=="1") {
        WriteState(dir,task,"STOP","TEST_BEFORE_ASSIGN",ownerPid,pi.dwProcessId,Active(job));
        throw new InvalidOperationException("JOB_ASSIGN_INJECTED");
      }
      if (!AssignProcessToJobObject(job,pi.hProcess))
        throw new InvalidOperationException("JOB_ASSIGN_FAILED");
      assigned=true;
      if(integration){
        // Assignment is acknowledged durably BEFORE the child can execute.
        // Only the native owner holds the Job handle. InheritHandles=false,
        // no breakaway flags, KILL_ON_JOB_CLOSE => owner death empties the Job.
        string assignedReceipt="taskId="+task+"\nownerPid="+ownerPid+
          "\nownerStartTicks="+ownerStartTicks+
          "\nchildPid="+pi.dwProcessId+
          "\nchildStartTicks="+ProcessStartTicks((int)pi.dwProcessId)+
          "\njobAssigned=1\ninheritedHandles=0\nbreakaway=0\n";
        CreateReceipt(Path.Combine(dir,recovering?"native-job-assigned-e1.txt":"native-job-assigned-e0.txt"),assignedReceipt);
      }
      if (ResumeThread(pi.hThread)==WAIT_FAILED)
        throw new InvalidOperationException("CHILD_RESUME_FAILED");
      WriteState(dir,task,"RUNNING","JOB_ASSIGNED",ownerPid,pi.dwProcessId,Active(job));
      Console.WriteLine("{\"status\":\"RUNNING\",\"ownerPid\":"+ownerPid+",\"childPid\":"+pi.dwProcessId+"}");
      Console.Out.Flush();

      string heartbeat=Path.Combine(dir,"heartbeat-"+pi.dwProcessId+".txt");
      DateTime started=DateTime.UtcNow, last=started;
      Stopwatch clock=Stopwatch.StartNew();
      while (clock.ElapsedMilliseconds < runtimeMs) {
        uint result=WaitForSingleObject(pi.hProcess,100);
        if (result==WAIT_FAILED) throw new InvalidOperationException("PROCESS_WAIT_FAILED");
        if (result==WAIT_OBJECT_0) {
          uint exitCode;
          if (!GetExitCodeProcess(pi.hProcess,out exitCode))
            throw new InvalidOperationException("EXIT_CODE_UNKNOWN");
          bool empty = EmptyAfterTerminate(job);
          WriteState(dir,task,empty && exitCode==0 ? "COMPLETED":"STOP",
            !empty?"JOB_NONEMPTY":exitCode==0?"CHILD_EXITED":"CHILD_NONZERO",
            ownerPid,pi.dwProcessId,Active(job));
          return empty && exitCode==0 ? 0 : 21;
        }
        if (File.Exists(heartbeat)) {
          DateTime modified=File.GetLastWriteTimeUtc(heartbeat);
          if (modified>last && modified <= DateTime.UtcNow.AddSeconds(1)) last=modified;
        }
        if ((DateTime.UtcNow-last).TotalMilliseconds>heartbeatMs) {
          bool empty=EmptyAfterTerminate(job);
          WriteState(dir,task,"STOP",empty?"HEARTBEAT_STALE_JOB_EMPTY":"HEARTBEAT_STALE_JOB_NONEMPTY",
            ownerPid,pi.dwProcessId,Active(job));
          Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"HEARTBEAT_STALE\",\"jobEmpty\":"+empty.ToString().ToLowerInvariant()+"}");
          return empty?20:22;
        }
      }
      bool timedOutEmpty=EmptyAfterTerminate(job);
      WriteState(dir,task,"STOP",timedOutEmpty?"RUNTIME_LIMIT_JOB_EMPTY":"RUNTIME_LIMIT_JOB_NONEMPTY",
        ownerPid,pi.dwProcessId,Active(job));
      return timedOutEmpty?23:22;
    } catch (Exception ex) {
      // Do not print external process arguments or secrets.
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\""+(ex is InvalidOperationException?ex.Message:"NATIVE_IO_ERROR")+"\"}");
      return 70;
    } finally {
      // If CreateProcess succeeded but Job assignment did not, kill only the
      // EXACT suspended process handle returned to this owner. No PID lookup.
      // The child cannot have executed code yet (CREATE_SUSPENDED).
      if (childCreated && !assigned && pi.hProcess!=IntPtr.Zero)
        TerminateProcess(pi.hProcess, 54);
      // After assignment, closing the Job handles ALL descendants.
      if (job!=IntPtr.Zero) CloseHandle(job);
      if (childCreated) {
        if (pi.hThread!=IntPtr.Zero) CloseHandle(pi.hThread);
        if (pi.hProcess!=IntPtr.Zero) CloseHandle(pi.hProcess);
      }
      if (owned) ReleaseMutex(mutex);
      if (mutex!=IntPtr.Zero) CloseHandle(mutex);
    }
  }
}
