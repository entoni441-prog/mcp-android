// Isolated acceptance only. Never invoked by the Host or MCP.
// Exactly one synthetic tree per scenario, all processes self-expire.
// Observers retain and verify handles; only the helper started here is killed.
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Threading;

internal static class NexusJobAcceptance {
    static string Self { get { return Assembly.GetExecutingAssembly().Location; } }
    static string Q(string p) { return "\"" + p + "\""; }
    static void Need(bool ok,string why) { if(!ok) throw new Exception(why); }
    static long Ticks(Process p) { return p.StartTime.ToUniversalTime().Ticks; }
    static int Fixture(string role,string dir) {
        string next=role=="root"?"child":role=="child"?"leaf":null;
        if(role!="root"&&role!="child"&&role!="leaf")return 10;
        using(Process me=Process.GetCurrentProcess()) {
            File.WriteAllText(Path.Combine(dir,role+".id"),me.Id+" "+Ticks(me).ToString(CultureInfo.InvariantCulture));
        }
        if(next!=null) {
            using(Process sub=Process.Start(new ProcessStartInfo(Self,"fixture "+next+" "+Q(dir)){
                UseShellExecute=false,CreateNoWindow=true
            })) {
                // Every process is bounded, even if the containment test fails.
                Thread.Sleep(25000);
            }
        } else Thread.Sleep(25000);
        return 0;
    }
    static Process Observe(string dir,string role) {
        string file=Path.Combine(dir,role+".id");
        Stopwatch w=Stopwatch.StartNew();
        while(w.ElapsedMilliseconds<5000) {
            string value=null;
            try { value=File.ReadAllText(file); } catch(IOException) {}
            if(value!=null) {
                string[] a=value.Trim().Split(' ');
                int pid;long ticks;
                if(a.Length==2&&Int32.TryParse(a[0],out pid)&&Int64.TryParse(a[1],out ticks)) {
                    Process p=Process.GetProcessById(pid);
                    try {
                        IntPtr retained=p.Handle;
                        Need(retained!=IntPtr.Zero&&!p.HasExited&&Ticks(p)==ticks,"identity_mismatch_"+role);
                        return p;
                    } catch { p.Dispose();throw; }
                }
            }
            Thread.Sleep(25);
        }
        throw new Exception("fixture_not_ready_"+role);
    }
    static string Frame(BlockingCollection<string> queue,string prefix) {
        string s;
        Need(queue.TryTake(out s,6000),"missing_"+prefix);
        Need(s.StartsWith(prefix,StringComparison.Ordinal),"unexpected_frame:"+s);
        return s;
    }
    static void Scenario(string mode,string dir) {
        Directory.CreateDirectory(dir);
        string helper=Path.Combine(Path.GetDirectoryName(Self),"NexusJobHost.exe");
        var frames=new BlockingCollection<string>();
        var info=new ProcessStartInfo(helper,"task "+Q(Self)+" fixture root "+Q(dir)) {
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,
            RedirectStandardError=true,RedirectStandardOutput=true
        };
        Process root=null,child=null,leaf=null;
        using(Process p=new Process { StartInfo=info }) {
            p.ErrorDataReceived+=(sender,e)=>{if(e.Data!=null)frames.Add(e.Data);};
            p.OutputDataReceived+=(sender,e)=>{};
            Need(p.Start(),"helper_start");
            p.BeginErrorReadLine();p.BeginOutputReadLine();
            try {
                string prepared=Frame(frames,"NXJOB PREPARED ");
                p.StandardInput.WriteLine("RUN");p.StandardInput.Flush();
                string ready=Frame(frames,"NXJOB READY ");
                Need(prepared.Substring("NXJOB PREPARED ".Length)==ready.Substring("NXJOB READY ".Length),"ready_identity");
                root=Observe(dir,"root");child=Observe(dir,"child");leaf=Observe(dir,"leaf");
                string exact=root.Id+" "+Ticks(root).ToString(CultureInfo.InvariantCulture);
                Need(ready=="NXJOB READY "+exact,"root_identity_mismatch");
                Need(root.Id!=child.Id&&child.Id!=leaf.Id&&root.Id!=leaf.Id,"distinct_tree");
                Need(!root.HasExited&&!child.HasExited&&!leaf.HasExited,"tree_not_alive_before_stop");
                Stopwatch elapsed=Stopwatch.StartNew();
                bool empty=false;
                if(mode=="stop") {
                    p.StandardInput.Close();
                    string result=Frame(frames,"NXJOB EMPTY ");
                    Need(result=="NXJOB EMPTY 1","unexpected_root_exit:"+result);
                    empty=true;
                } else {
                    // Exact Process object returned by Start, not a PID lookup.
                    p.Kill();
                }
                Need(p.WaitForExit(7000),"helper_exit_timeout");
                if(mode=="stop")Need(p.ExitCode==0,"helper_exit_nonzero");
                Need(root.WaitForExit(6000),"root_survived");
                Need(child.WaitForExit(6000),"child_survived");
                Need(leaf.WaitForExit(6000),"grandchild_survived");
                Console.WriteLine("PASS "+mode+" three_live_before=true three_exited_after=true root_ticks_match=true helper_empty_frame="+empty.ToString().ToLowerInvariant()+" elapsed_ms="+elapsed.ElapsedMilliseconds);
            } finally {
                // On failure, stop only our own supervisor; the fixture also has
                // its own 25-second time limit. No kill by PID, name or sweep.
                try { if(!p.HasExited){p.StandardInput.Close();if(!p.WaitForExit(6000)){p.Kill();p.WaitForExit(3000);}} }catch{}
                if(root!=null)root.Dispose();if(child!=null)child.Dispose();if(leaf!=null)leaf.Dispose();
            }
        }
    }
    public static int Main(string[] args) {
        if(args.Length==3&&args[0]=="fixture")return Fixture(args[1],args[2]);
        if(args.Length!=0)return 11;
        string dir=Path.Combine(Path.GetDirectoryName(Self),"fixture-"+Guid.NewGuid().ToString("N"));
        try {
            Scenario("stop",Path.Combine(dir,"stop"));
            Scenario("helper_death",Path.Combine(dir,"helper-death"));
            Console.WriteLine("NATIVE_JOB_ACCEPTANCE PASS");
            return 0;
        } catch(Exception e) {
            Console.Error.WriteLine("NATIVE_JOB_ACCEPTANCE FAIL "+e.Message);return 1;
        }
    }
}
