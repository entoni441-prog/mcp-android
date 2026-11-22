// Experiment only. Build and review as an installed helper before live use.
// One unnamed Job Object, no PID-based attachment, no shell, no breakaway.
// Windows 10+: PROC_THREAD_ATTRIBUTE_JOB_LIST assigns at CreateProcess time.
// Protocol: stderr is supervisor-only. Child stdout AND stderr go to stdout;
// child receives NUL stdin, never the supervisor control pipe or job handle.
// Parent sends RUN after PREPARED; any EOF or other input means STOP.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Diagnostics;

internal static class NexusJobHost {
    const uint KILL_ON_JOB_CLOSE = 0x2000;
    const uint CREATE_SUSPENDED = 0x4, EXTENDED_STARTUPINFO_PRESENT = 0x80000, CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x100, DUPLICATE_SAME_ACCESS = 2;
    static readonly IntPtr JOB_LIST = new IntPtr(0x0002000d), HANDLE_LIST = new IntPtr(0x00020002);
    static readonly IntPtr INVALID_HANDLE = new IntPtr(-1);
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct SecurityAttributes { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct StartupInfo {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits value, uint len);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting value, uint len, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcessW(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfoEx si, out ProcessInformation pi);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out FileTime created,out FileTime exited,out FileTime kernel,out FileTime user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr p1, IntPtr source, IntPtr p2, out IntPtr dest, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attrs, uint disposition, uint flags, IntPtr template);
    static bool Valid(IntPtr h) { return h != IntPtr.Zero && h != INVALID_HANDLE; }
    static void Close(ref IntPtr h) { if (Valid(h)) CloseHandle(h); h=IntPtr.Zero; }
    static void Require(bool ok, string stage) { if (!ok) throw new Failure(stage, Marshal.GetLastWin32Error()); }
    sealed class Failure : Exception {
        internal readonly string Stage; internal readonly int Code;
        internal Failure(string stage, int code) { Stage=stage; Code=code; }
    }
    // Standard Windows argv quoting, always quote every argument.
    internal static string Quote(string s) {
        StringBuilder b = new StringBuilder("\""); int slash=0;
        foreach (char ch in s) {
            if (ch=='\\') { slash++; continue; }
            if (ch=='"') { b.Append('\\',slash*2+1); b.Append('"'); }
            else { b.Append('\\',slash); b.Append(ch); }
            slash=0;
        }
        b.Append('\\',slash*2); b.Append('"'); return b.ToString();
    }
    static uint Active(IntPtr job) {
        Accounting a;
        Require(QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"query");
        return a.ActiveProcesses;
    }
    static void Signal(string s) { Console.Error.WriteLine("NXJOB "+s); Console.Error.Flush(); }
    public static int Main(string[] args) {
        // This executable is NOT an MCP command: only existing validated task/browser
        // launch sites in the Host call it. No attaching to existing processes.
        if (args.Length<2 || args.Length>128 || (args[0]!="task" && args[0]!="browser") ||
            !System.Text.RegularExpressions.Regex.IsMatch(args[1], @"^[A-Za-z]:\\") ||
            !String.Equals(Path.GetExtension(args[1]),".exe",StringComparison.OrdinalIgnoreCase)) {
            Signal("ERROR invalid_args 0"); return 120;
        }
        IntPtr job=IntPtr.Zero, output=IntPtr.Zero, input=IntPtr.Zero, attrs=IntPtr.Zero, jobs=IntPtr.Zero, handles=IntPtr.Zero;
        ProcessInformation pi=new ProcessInformation(); bool initialized=false;
        try {
            job=CreateJobObjectW(IntPtr.Zero,null); Require(Valid(job),"create_job");
            ExtendedLimits limits=new ExtendedLimits(); limits.BasicLimitInformation.LimitFlags=KILL_ON_JOB_CLOSE;
            Require(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"set_limits");
            Require(DuplicateHandle(GetCurrentProcess(),GetStdHandle(-11),GetCurrentProcess(),out output,0,true,DUPLICATE_SAME_ACCESS),"duplicate_output");
            SecurityAttributes sa=new SecurityAttributes(); sa.nLength=Marshal.SizeOf(typeof(SecurityAttributes)); sa.bInheritHandle=true;
            input=CreateFileW("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero); Require(Valid(input),"null_input");
            IntPtr size=IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
            Require(size.ToInt64()>0,"attribute_size");
            attrs=Marshal.AllocHGlobal(size);
            Require(InitializeProcThreadAttributeList(attrs,2,0,ref size),"attribute_init"); initialized=true;
            jobs=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs,job);
            handles=Marshal.AllocHGlobal(IntPtr.Size*2); Marshal.WriteIntPtr(handles,input); Marshal.WriteIntPtr(handles,IntPtr.Size,output);
            Require(UpdateProcThreadAttribute(attrs,0,JOB_LIST,jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job_attribute");
            Require(UpdateProcThreadAttribute(attrs,0,HANDLE_LIST,handles,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero),"handle_attribute");
            StartupInfoEx si=new StartupInfoEx(); si.StartupInfo.cb=Marshal.SizeOf(typeof(StartupInfoEx));
            si.StartupInfo.dwFlags=STARTF_USESTDHANDLES; si.StartupInfo.hStdInput=input;
            si.StartupInfo.hStdOutput=output; si.StartupInfo.hStdError=output; si.AttributeList=attrs;
            StringBuilder cmd=new StringBuilder();
            for(int i=1;i<args.Length;i++) { if(i>1)cmd.Append(' '); cmd.Append(Quote(args[i])); }
            Require(cmd.Length<32767,"command_length");
            uint flags=CREATE_SUSPENDED|EXTENDED_STARTUPINFO_PRESENT|(args[0]=="task"?CREATE_NO_WINDOW:0);
            // Atomic assignment; no AssignProcessToJobObject AFTER an uncontained spawn.
            Require(CreateProcessW(args[1],cmd,IntPtr.Zero,IntPtr.Zero,true,flags,IntPtr.Zero,null,ref si,out pi),"create_contained");
            Close(ref input); Close(ref output);
            FileTime created, exited, kernel, user;
            Require(GetProcessTimes(pi.hProcess,out created,out exited,out kernel,out user),"process_times");
            ulong ticks=(((ulong)created.High<<32)|created.Low)+504911232000000000UL;
            string lifetime=pi.dwProcessId+" "+ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
            Signal("PREPARED "+lifetime);
            if(Console.In.ReadLine()!="RUN") {
                Require(TerminateJobObject(job,1),"cancel_prepared");
            } else {
                Require(ResumeThread(pi.hThread)!=0xffffffff,"resume");
                Signal("READY "+lifetime);
                // EOF (including Host crash) or any line requests STOP.
                ManualResetEvent stop=new ManualResetEvent(false);
                Thread watcher=new Thread(delegate() { try { Console.In.ReadLine(); } catch {} finally { stop.Set(); } });
                watcher.IsBackground=true; watcher.Start();
                while(Active(job)!=0) {
                    if(stop.WaitOne(50)) { Require(TerminateJobObject(job,1),"terminate_job"); break; }
                }
            }
            Stopwatch deadline=Stopwatch.StartNew();
            while(Active(job)!=0) {
                if(deadline.ElapsedMilliseconds>=5000) throw new Failure("job_not_empty",0);
                Thread.Sleep(25);
            }
            uint code; Require(GetExitCodeProcess(pi.hProcess,out code),"exit_code");
            Signal("EMPTY "+code); return 0;
        } catch(Failure e) { try { Signal("ERROR "+e.Stage+" "+e.Code); } catch {} return 121; }
        catch { try { Signal("ERROR internal 0"); } catch {} return 122; }
        finally {
            // Closing the last non-inherited job handle kills all members even on error.
            Close(ref job); Close(ref pi.hThread); Close(ref pi.hProcess); Close(ref input); Close(ref output);
            if(initialized) DeleteProcThreadAttributeList(attrs);
            if(attrs!=IntPtr.Zero) Marshal.FreeHGlobal(attrs);
            if(jobs!=IntPtr.Zero) Marshal.FreeHGlobal(jobs);
            if(handles!=IntPtr.Zero) Marshal.FreeHGlobal(handles);
        }
    }
}
