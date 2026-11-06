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
using System.Security.Cryptography;

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
  const int ERROR_FILE_NOT_FOUND = 2;
  const uint JOB_OBJECT_QUERY = 0x0004;
  const uint JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x00000800;
  const uint JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x00001000;

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
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="OpenJobObjectW")]
  static extern IntPtr OpenJobObject(uint access, bool inheritHandle, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass,
      ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool QueryInformationJobObject(IntPtr job, int infoClass,
      out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int length, IntPtr returnLength);
  [DllImport("kernel32.dll", SetLastError=true, EntryPoint="QueryInformationJobObject")]
  static extern bool QueryJobLimits(IntPtr job, int infoClass,
      out JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length, IntPtr returnLength);
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

  static bool LimitsSafe(IntPtr job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION x;
    if(!QueryJobLimits(job,JobObjectExtendedLimitInformation,out x,
      Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)),IntPtr.Zero))
      return false;
    uint flags=x.BasicLimitInformation.LimitFlags;
    return (flags&JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)!=0 &&
      (flags&(JOB_OBJECT_LIMIT_BREAKAWAY_OK|JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK))==0;
  }
  // Read-only, same-Windows-session OS lifecycle probe for an exact test job.
  // NOT a recovery authorization; all outcomes remain observational.
  static int Probe(string[] args) {
    bool holding=args.Length>0&&args[0]=="probe-hold";
    int holdMs=0;
    if(!holding && (args.Length!=3||args[0]!="probe"))return 64;
    if(holding && (args.Length!=4||!Int32.TryParse(args[3],out holdMs)||
       holdMs<300||holdMs>6500))return 64;
    if(!Regex.IsMatch(args[1],@"^[A-Za-z0-9_-]{1,48}$")||
       !Path.IsPathRooted(args[2])||!IsTestPath(args[2]))return 64;
    string task=args[1],dir=Path.GetFullPath(args[2]);
    try {
      string file=Path.Combine(dir,"native-job-identity-e0.txt");
      if(!File.Exists(file)) {
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_IDENTITY_MISSING\"}");
        return 30;
      }
      string[] v=File.ReadAllLines(file);
      string prefix="Local\\NEXUS-Codex-Proof-"+task+"-";
      int pid, session;long ticks;
      if(v.Length!=7||v[0]!="taskId="+task||
         !Int32.TryParse(v[1].Replace("ownerPid=",""),out pid)||v[1]!="ownerPid="+pid||
         !Int64.TryParse(v[2].Replace("ownerStartTicks=",""),out ticks)||v[2]!="ownerStartTicks="+ticks||
         !v[3].StartsWith("jobName="+prefix,StringComparison.Ordinal)||
         !Regex.IsMatch(v[3].Substring(("jobName="+prefix).Length),@"^[a-f0-9]{32}$")||
         v[4]!="killOnClose=1"||v[5]!="noBreakaway=1"||
         !Int32.TryParse(v[6].Replace("sessionId=",""),out session)||
         v[6]!="sessionId="+session||pid<1||ticks<1||session!=Process.GetCurrentProcess().SessionId) {
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_IDENTITY_INVALID\"}");
        return 31;
      }
      string[] assignment=File.ReadAllLines(Path.Combine(dir,"native-job-assigned-e0.txt"));
      if(assignment.Length!=8||assignment[0]!="taskId="+task||
         assignment[1]!="ownerPid="+pid||
         assignment[2]!="ownerStartTicks="+ticks||
         assignment[5]!="jobAssigned=1"||
         assignment[6]!="inheritedHandles=0"||assignment[7]!="breakaway=0"){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_ASSIGNMENT_INVALID\"}");
        return 32;
      }
      int childPid;long childTicks;
      if(!Int32.TryParse(assignment[3].Replace("childPid=",""),out childPid) ||
         assignment[3]!="childPid="+childPid||
         !Int64.TryParse(assignment[4].Replace("childStartTicks=",""),out childTicks)||
         assignment[4]!="childStartTicks="+childTicks||
         childPid<1||childTicks<1){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_CHILD_IDENTITY_INVALID\"}");
        return 36;
      }
      IntPtr h=OpenJobObject(JOB_OBJECT_QUERY,false,prefix+v[3].Substring(("jobName="+prefix).Length));
      int err=Marshal.GetLastWin32Error();
      if(h==IntPtr.Zero) {
        if(err==ERROR_FILE_NOT_FOUND) {
          // An absent Job name alone is insufficient: the original owner or
          // exact first child may still exist, or a reused PID may be present.
          // Require BOTH identities to be gone, with original start ticks.
          if(!PriorInstanceGone(pid,ticks)||!PriorInstanceGone(childPid,childTicks)){
            Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"PRIOR_PROCESS_STILL_ALIVE\"}");
            return 37;
          }
          // Named object absent in THIS session, and exact first processes
          // gone. Observation only: external effects still need reconciliation.
          Console.WriteLine("{\"status\":\"NOT_FOUND\",\"authorization\":\"NONE\"}");
          return 0;
        }
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_QUERY_UNCERTAIN\"}");
        return 33;
      }
      try {
        if(!LimitsSafe(h)) {
          Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_LIMITS_UNSAFE\"}");
          return 34;
        }
        uint active=Active(h);
        Console.WriteLine("{\"status\":\"PRESENT\",\"active\":"+active+",\"authorization\":\"NONE\"}");
        Console.Out.Flush();
        // TEST ONLY: leave a second OS handle open briefly. The native owner
        // may die, yet KILL_ON_JOB_CLOSE must NOT be assumed until *all* handles
        // including this observer have closed. No execution is authorized.
        if(holding)Thread.Sleep(holdMs);
        return 0;
      }finally{CloseHandle(h);}
    }catch{
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"JOB_EVIDENCE_UNREADABLE\"}");
      return 35;
    }
  }

  // STRICTLY TEST-ONLY epoch-one reservation, WITHOUT a recovery worker.
  // No effect may have begun, all evidence is the synthetic PREPARED fixture,
  // and the original named Job must be gone at the kernel boundary.
  static int ReserveShadow(string[] args) {
    if(args.Length!=3||args[0]!="reserve-shadow"||
       !Regex.IsMatch(args[1],@"^[A-Za-z0-9_-]{1,48}$")||
       !Path.IsPathRooted(args[2])||!Directory.Exists(args[2])||
       !IsTestPath(args[2]))return 64;
    string task=args[1],dir=Path.GetFullPath(args[2]);
    string mutexName="Global\\NEXUS-Codex-JobTest-"+task;
    IntPtr mutex=IntPtr.Zero;
    bool owned=false;
    try{
      mutex=CreateMutex(IntPtr.Zero,true,mutexName);
      int mutexErr=Marshal.GetLastWin32Error();
      if(mutex==IntPtr.Zero)throw new InvalidOperationException("MUTEX_CREATE_FAILED");
      if(mutexErr==ERROR_ALREADY_EXISTS){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"DUPLICATE_OWNER\"}");
        return 12;
      }
      owned=true;
      if(File.Exists(Path.Combine(dir,"native-epoch-001-shadow.json"))||
         File.Exists(Path.Combine(dir,"native-epoch-001.json"))){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"SHADOW_EPOCH_ALREADY_CLAIMED\"}");
        return 17;
      }
      if(!RecoveryPreflight(dir,task)){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"PREVIOUS_OWNER_UNVERIFIED\"}");
        return 24;
      }
      string[] v=File.ReadAllLines(Path.Combine(dir,"native-job-identity-e0.txt"));
      string prefix="Local\\NEXUS-Codex-Proof-"+task+"-";
      int priorOwner,session;long priorTicks;
      if(v.Length!=7||v[0]!="taskId="+task||
         !Int32.TryParse(v[1].Replace("ownerPid=",""),out priorOwner)||
         v[1]!="ownerPid="+priorOwner||
         !Int64.TryParse(v[2].Replace("ownerStartTicks=",""),out priorTicks)||
         v[2]!="ownerStartTicks="+priorTicks||
         !v[3].StartsWith("jobName="+prefix,StringComparison.Ordinal)||
         !Regex.IsMatch(v[3].Substring(("jobName="+prefix).Length),@"^[a-f0-9]{32}$")||
         v[4]!="killOnClose=1"||v[5]!="noBreakaway=1"||
         !Int32.TryParse(v[6].Replace("sessionId=",""),out session)||
         v[6]!="sessionId="+session||session!=Process.GetCurrentProcess().SessionId){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"KERNEL_IDENTITY_INVALID\"}");
        return 31;
      }
      string priorEpoch=File.ReadAllText(Path.Combine(dir,"native-epoch-000.json"));
      if(!priorEpoch.Contains("\"ownerPid\":"+priorOwner+",\"ownerStartTicks\":"+priorTicks+"}")){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"PRIOR_OWNER_MISMATCH\"}");
        return 31;
      }
      IntPtr old=OpenJobObject(JOB_OBJECT_QUERY,false,v[3].Substring("jobName=".Length));
      int openErr=Marshal.GetLastWin32Error();
      if(old!=IntPtr.Zero){
        CloseHandle(old);
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"OLD_KERNEL_JOB_STILL_PRESENT\"}");
        return 32;
      }
      if(openErr!=ERROR_FILE_NOT_FOUND){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"OLD_KERNEL_JOB_UNCERTAIN\"}");
        return 33;
      }
      // PREPARED means no irreversible action has been dispatched in this
      // STRICT synthetic fixture. Any IN_FLIGHT/COMMITTED => absolute STOP.
      string state=Path.Combine(dir,"state");
      string baseOp=task+"-local_effect_001-e0-";
      string prepared="{\"taskId\":\""+task+
        "\",\"operationId\":\"local_effect_001\",\"epoch\":0,\"stage\":\"PREPARED\"}\n";
      string thread="019a8f9b-1452-71c0-8a17-6915a0904d67";
      string expectedState="{\"taskId\":\""+task+"\",\"threadId\":\""+thread+
        "\",\"status\":\"RUNNING\",\"attempt\":0,\"recordedStatus\":null,\"childPid\":null}";
      string expectedReady="{\"taskId\":\""+task+"\",\"threadId\":\""+thread+
        "\",\"noExternalEffect\":true,\"guardianStarted\":false}";
      if(File.Exists(Path.Combine(state,baseOp+"IN_FLIGHT.json"))||
         File.Exists(Path.Combine(state,baseOp+"COMMITTED.json"))||
         File.Exists(Path.Combine(state,"effect-once.txt"))||
         File.Exists(Path.Combine(state,"complete.json"))||
         File.ReadAllText(Path.Combine(state,baseOp+"PREPARED.json"))!=prepared||
         File.ReadAllText(Path.Combine(state,"state.json"))!=expectedState||
         File.ReadAllText(Path.Combine(dir,"synthetic-prepared-ready.json"))!=expectedReady){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"OPERATION_EFFECT_BOUNDARY_UNPROVEN\"}");
        return 34;
      }
      string anchorText="{\"version\":1,\"taskId\":\""+task+"\",\"baseEpoch\":0,\"maxAttempts\":5}";
      if(File.ReadAllText(Path.Combine(dir,"budget-anchor.json"))!=anchorText+"\n"){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"BUDGET_ANCHOR_UNVERIFIED\"}");
        return 35;
      }
      string previousHash;
      using(var sha=SHA256.Create()){
        previousHash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(anchorText)))
          .Replace("-","").ToLowerInvariant();
      }
      string expectedAttempt="{\"version\":1,\"taskId\":\""+task+
        "\",\"attempt\":1,\"epoch\":1,\"prevHash\":\""+previousHash+"\"}\n";
      if(File.ReadAllText(Path.Combine(dir,"budget-attempt-001.json"))!=expectedAttempt||
         File.Exists(Path.Combine(dir,"budget-attempt-002.json"))){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"DURABLE_FENCE_UNVERIFIED\"}");
        return 36;
      }
      // Never use native-epoch-001.json here: this is NOT an accepted real
      // recovery. The shadow receipt cannot be mistaken for an enabled epoch.
      string shadow="{\"taskId\":\""+task+"\",\"epoch\":1,\"shadowOnly\":true,"+
        "\"canResume\":false,\"oldKernelJobGone\":true,\"budgetAttempt\":1}\n";
      CreateReceipt(Path.Combine(dir,"native-epoch-001-shadow.json"),shadow);
      Console.WriteLine("{\"status\":\"SHADOW_EPOCH_RESERVED\",\"epoch\":1,\"canResume\":false}");
      return 0;
    }catch{
      Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"SHADOW_EVIDENCE_UNREADABLE\"}");
      return 40;
    }finally{
      if(owned)ReleaseMutex(mutex);
      if(mutex!=IntPtr.Zero)CloseHandle(mutex);
    }
  }


  // A strictly isolated REAL CLI READ-ONLY test. This is NOT production
  // recover: it only accepts the exact synthetic PREPARED local test boundary.
  // Called AFTER native singleton mutex acquisition and BEFORE e1 claim/Job.
  static bool ReadOnlyRecoveryPreflight(string dir,string task) {
    try {
      if(!RecoveryPreflight(dir,task)||
         File.Exists(Path.Combine(dir,"native-epoch-001-shadow.json"))||
         File.Exists(Path.Combine(dir,"native-job-identity-e1.txt"))||
         File.Exists(Path.Combine(dir,"native-job-assigned-e1.txt")))return false;
      string[] proof=File.ReadAllLines(Path.Combine(dir,"native-job-identity-e0.txt"));
      string prefix="Local\\NEXUS-Codex-Proof-"+task+"-";
      int pid, session;long ticks;
      if(proof.Length!=7||proof[0]!="taskId="+task||
         !Int32.TryParse(proof[1].Replace("ownerPid=",""),out pid)||
         proof[1]!="ownerPid="+pid||
         !Int64.TryParse(proof[2].Replace("ownerStartTicks=",""),out ticks)||
         proof[2]!="ownerStartTicks="+ticks||
         !proof[3].StartsWith("jobName="+prefix,StringComparison.Ordinal)||
         !Regex.IsMatch(proof[3].Substring(("jobName="+prefix).Length),@"^[a-f0-9]{32}$")||
         proof[4]!="killOnClose=1"||proof[5]!="noBreakaway=1"||
         !Int32.TryParse(proof[6].Replace("sessionId=",""),out session)||
         proof[6]!="sessionId="+session||
         session!=Process.GetCurrentProcess().SessionId)return false;
      string[] assigned=File.ReadAllLines(Path.Combine(dir,"native-job-assigned-e0.txt"));
      if(assigned.Length!=8||assigned[0]!="taskId="+task||
         assigned[1]!="ownerPid="+pid||
         assigned[2]!="ownerStartTicks="+ticks||
         assigned[5]!="jobAssigned=1"||
         assigned[6]!="inheritedHandles=0"||assigned[7]!="breakaway=0")
         return false;
      // An OS Job still existing, including one kept alive by a third-party
      // handle after owner death, ALWAYS blocks resumption.
      IntPtr previous=OpenJobObject(JOB_OBJECT_QUERY,false,
        proof[3].Substring("jobName=".Length));
      int osError=Marshal.GetLastWin32Error();
      if(previous!=IntPtr.Zero){CloseHandle(previous);return false;}
      if(osError!=ERROR_FILE_NOT_FOUND)return false;

      string ready=File.ReadAllText(Path.Combine(dir,"real-readonly-ready.json"));
      Match tid=Regex.Match(ready,@"""threadId"":""(?<id>[0-9a-fA-F-]{36})""");
      if(!tid.Success||!Regex.IsMatch(tid.Groups["id"].Value,
        @"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"))
        return false;
      string thread=tid.Groups["id"].Value;
      string expectedReady="{\"taskId\":\""+task+"\",\"threadId\":\""+thread+
        "\",\"readOnly\":true,\"baselineCompleted\":true,\"guardianStarted\":false,"+
        "\"noFilesystemEffect\":true}";
      string state="{\"taskId\":\""+task+"\",\"threadId\":\""+thread+
        "\",\"status\":\"RUNNING\",\"attempt\":0,\"recordedStatus\":null,\"childPid\":null}";
      if(ready!=expectedReady||
         File.ReadAllText(Path.Combine(dir,"state","state.json"))!=state)
        return false;
      string turn=File.ReadAllText(Path.Combine(dir,"real-readonly-turn-started.json"));
      Match child=Regex.Match(turn,@"""pid"":(?<pid>[1-9][0-9]*)");
      int childPid;
      if(!child.Success||!Int32.TryParse(child.Groups["pid"].Value,out childPid)||
         turn!="{\"taskId\":\""+task+"\",\"threadId\":\""+thread+
           "\",\"pid\":"+childPid+",\"turnStarted\":true}")
        return false;
      try{using(Process p=Process.GetProcessById(childPid)){return false;}}
      catch(ArgumentException){} // exact test second-turn Codex is gone
      // All evidence is ONLY a prepared receipt. Nothing irreversible started.
      string stateDir=Path.Combine(dir,"state");
      string first=task+"-local_effect_001-e0-";
      string prepared="{\"taskId\":\""+task+
        "\",\"operationId\":\"local_effect_001\",\"epoch\":0,\"stage\":\"PREPARED\"}\n";
      if(File.ReadAllText(Path.Combine(stateDir,first+"PREPARED.json"))!=prepared||
         File.Exists(Path.Combine(stateDir,first+"IN_FLIGHT.json"))||
         File.Exists(Path.Combine(stateDir,first+"COMMITTED.json"))||
         File.Exists(Path.Combine(stateDir,"effect-once.txt"))||
         File.Exists(Path.Combine(stateDir,"complete.json"))||
         File.Exists(Path.Combine(dir,"owner","owner-stop.json"))||
         File.Exists(Path.Combine(dir,"owner","host-off")))
        return false;
      string anchor="{\"version\":1,\"taskId\":\""+task+"\",\"baseEpoch\":0,\"maxAttempts\":5}";
      if(File.ReadAllText(Path.Combine(dir,"budget-anchor.json"))!=anchor+"\n")
        return false;
      string priorHash;
      using(var sh=SHA256.Create()){
        priorHash=BitConverter.ToString(sh.ComputeHash(Encoding.UTF8.GetBytes(anchor)))
          .Replace("-","").ToLowerInvariant();
      }
      string attempt="{\"version\":1,\"taskId\":\""+task+
        "\",\"attempt\":1,\"epoch\":1,\"prevHash\":\""+priorHash+"\"}\n";
      if(File.ReadAllText(Path.Combine(dir,"budget-attempt-001.json"))!=attempt)
        return false;
      string[] budgets=Directory.GetFiles(dir,"budget-*");
      if(budgets.Length!=2 ||
         budgets.Any(x=>Path.GetFileName(x)!="budget-anchor.json"&&
           Path.GetFileName(x)!="budget-attempt-001.json"))
        return false;
      return true;
    }catch{return false;}
  }

  static int Main(string[] args) {
    if (Environment.OSVersion.Platform != PlatformID.Win32NT) return 64;
    if (args.Length>0 && args[0]=="reserve-shadow") return ReserveShadow(args);
    if (args.Length>0 && (args[0]=="probe"||args[0]=="probe-hold")) return Probe(args);
    // EXPLICITLY TEST-ONLY: no arbitrary executable, no production manifest.
    // run <taskId> <nodeExe> <testScript> <tempStateDir> <mode> <heartbeatTimeoutMs> <runtimeMs>
    if (args.Length != 8 || args[0] != "run" ||
        !Regex.IsMatch(args[1], @"^[A-Za-z0-9_-]{1,48}$") ||
        !Path.IsPathRooted(args[2]) || !File.Exists(args[2]) ||
        !String.Equals(Path.GetFileName(args[2]), "node.exe", StringComparison.OrdinalIgnoreCase) ||
        !Path.IsPathRooted(args[3]) || !File.Exists(args[3]) ||
        !new [] {"job-fixture.mjs", "guardian-integration-fixture.mjs", "real-readonly-fixture.mjs", "real-readonly-resume-fixture.mjs"}.Contains(Path.GetFileName(args[3]),StringComparer.OrdinalIgnoreCase) ||
        !Path.IsPathRooted(args[4]) || !Directory.Exists(args[4]) ||
        !IsTestPath(args[4]) ||
        !(String.Equals(Path.GetFileName(args[3]),"guardian-integration-fixture.mjs",StringComparison.OrdinalIgnoreCase)
            ? new [] {"normal","hang","prepared","recover","committed"}.Contains(args[5])
            : String.Equals(Path.GetFileName(args[3]),"real-readonly-fixture.mjs",StringComparison.OrdinalIgnoreCase)
              ? args[5]=="real-readonly"
              : String.Equals(Path.GetFileName(args[3]),"real-readonly-resume-fixture.mjs",StringComparison.OrdinalIgnoreCase)
                ? args[5]=="resume-readonly"
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
    string jobName=null;
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
      bool integration=String.Equals(Path.GetFileName(script),"guardian-integration-fixture.mjs",StringComparison.OrdinalIgnoreCase)||
        String.Equals(Path.GetFileName(script),"real-readonly-fixture.mjs",StringComparison.OrdinalIgnoreCase)||
        String.Equals(Path.GetFileName(script),"real-readonly-resume-fixture.mjs",StringComparison.OrdinalIgnoreCase);
      bool recovering=integration && mode=="recover";
      bool readonlyE1=String.Equals(Path.GetFileName(script),"real-readonly-resume-fixture.mjs",StringComparison.OrdinalIgnoreCase)&&mode=="resume-readonly";
      // The exact-thread recovery child has NOT passed acceptance yet.
      // Do not burn epoch 1 or launch anything until that gate is delivered.
      if(recovering){
        Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"RECOVERY_NOT_ENABLED\"}");
        return 25;
      }
      if(integration){
        if(readonlyE1 && !ReadOnlyRecoveryPreflight(dir,task)){
          Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"E1_READONLY_PREFLIGHT_DENIED\"}");
          return 24;
        }
        if(recovering && !RecoveryPreflight(dir,task)){
          Console.WriteLine("{\"status\":\"STOP\",\"reason\":\"NATIVE_RECOVERY_UNSAFE\"}");
          return 24;
        }
        string receiptPath=Path.Combine(dir,(recovering||readonlyE1)?"native-epoch-001.json":"native-epoch-000.json");
        try{
          // Task restart budget is currently ONE per exact saved session.
          // This durable record is burned BEFORE the recovery child can run.
          string receipt="{\"taskId\":\""+task+"\",\"epoch\":"+(recovering||readonlyE1?1:0)+
            ",\"restartCount\":"+(recovering||readonlyE1?1:0)+",\"ownerPid\":"+ownerPid+
            ",\"ownerStartTicks\":"+ownerStartTicks+"}\n";
          CreateReceipt(receiptPath,receipt);
          // Start the durable restart budget under the SAME native mutex, before
          // the first worker is resumed. Child runners cannot initialize it.
          // An interrupted creation fails closed; no receipt is overwritten.
          if(!recovering&&!readonlyE1){
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
      // An owner-generated, non-reused name allows another process to check
      // real kernel existence rather than trusting PID or a mutable heartbeat.
      jobName=integration?"Local\\NEXUS-Codex-Proof-"+task+"-"+Guid.NewGuid().ToString("N"):null;
      job=CreateJobObject(IntPtr.Zero,jobName);
      int jobErr=Marshal.GetLastWin32Error();
      if (job==IntPtr.Zero) throw new InvalidOperationException("JOB_CREATE_FAILED");
      if (integration && jobErr==ERROR_ALREADY_EXISTS)
        throw new InvalidOperationException("JOB_NAME_ALREADY_USED");
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
      limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (!SetInformationJobObject(job,JobObjectExtendedLimitInformation,ref limits,
        Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
        throw new InvalidOperationException("JOB_CONFIG_FAILED");
      if(integration){
        if(!LimitsSafe(job))throw new InvalidOperationException("JOB_LIMITS_UNVERIFIED");
        string proof="taskId="+task+"\nownerPid="+ownerPid+
          "\nownerStartTicks="+ownerStartTicks+"\njobName="+jobName+
          "\nkillOnClose=1\nnoBreakaway=1\nsessionId="+
          Process.GetCurrentProcess().SessionId+"\n";
        CreateReceipt(Path.Combine(dir,readonlyE1?"native-job-identity-e1.txt":"native-job-identity-e0.txt"),proof);
      }
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
      bool inExactJob=false;
      if(!IsProcessInJob(pi.hProcess,job,out inExactJob)||!inExactJob)
        throw new InvalidOperationException("JOB_MEMBERSHIP_UNVERIFIED");
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
        CreateReceipt(Path.Combine(dir,(recovering||readonlyE1)?"native-job-assigned-e1.txt":"native-job-assigned-e0.txt"),assignedReceipt);
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
