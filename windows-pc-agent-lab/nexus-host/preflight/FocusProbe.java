// NEXUS 0.4.0 preflight #2 — window activation via Java FFM (JDK 22+), no extra DLLs, no Python.
// Opens Notepad, puts focus back on this console, then tries to bring Notepad to the foreground.
// Changes nothing except window focus; closes the Notepad it started.
import java.lang.foreign.*;
import java.lang.invoke.MethodHandle;
import java.nio.charset.StandardCharsets;
import static java.lang.foreign.ValueLayout.*;

public class FocusProbe {
  public static void main(String[] a) throws Throwable {
    System.out.println("java.version=" + System.getProperty("java.version"));
    Linker l = Linker.nativeLinker();
    SymbolLookup u = SymbolLookup.libraryLookup("user32", Arena.global());
    MethodHandle getFg = l.downcallHandle(u.find("GetForegroundWindow").orElseThrow(), FunctionDescriptor.of(ADDRESS));
    MethodHandle setFg = l.downcallHandle(u.find("SetForegroundWindow").orElseThrow(), FunctionDescriptor.of(JAVA_INT, ADDRESS));
    MethodHandle show = l.downcallHandle(u.find("ShowWindow").orElseThrow(), FunctionDescriptor.of(JAVA_INT, ADDRESS, JAVA_INT));
    MethodHandle findW = l.downcallHandle(u.find("FindWindowW").orElseThrow(), FunctionDescriptor.of(ADDRESS, ADDRESS, ADDRESS));
    MethodHandle keybd = l.downcallHandle(u.find("keybd_event").orElseThrow(), FunctionDescriptor.ofVoid(JAVA_BYTE, JAVA_BYTE, JAVA_INT, JAVA_LONG));

    MemorySegment console = (MemorySegment) getFg.invokeExact();
    Process np = new ProcessBuilder(System.getenv("SystemRoot") + "\\System32\\notepad.exe").start();
    MemorySegment hwnd = MemorySegment.NULL;
    try (Arena arena = Arena.ofConfined()) {
      byte[] b = "Notepad\0".getBytes(StandardCharsets.UTF_16LE);
      MemorySegment cls = arena.allocate(b.length);
      MemorySegment.copy(b, 0, cls, JAVA_BYTE, 0, b.length);
      for (int i = 0; i < 50 && hwnd.address() == 0; i++) { Thread.sleep(200); hwnd = (MemorySegment) findW.invokeExact(cls, MemorySegment.NULL); }
    }
    System.out.println("notepad_hwnd_found=" + (hwnd.address() != 0));
    if (hwnd.address() == 0) { System.out.println("FOCUS_PROBE_BLOCKED notepad window not found"); return; }
    Thread.sleep(800);
    int back = (int) setFg.invokeExact(console);          // give focus back to the console so the test is meaningful
    Thread.sleep(500);
    MemorySegment before = (MemorySegment) getFg.invokeExact();
    System.out.println("console_refocused=" + (back != 0) + " notepad_is_fg_before=" + (before.address() == hwnd.address()));

    int r1 = (int) show.invokeExact(hwnd, 9);             // SW_RESTORE
    int s1 = (int) setFg.invokeExact(hwnd);
    Thread.sleep(400);
    boolean plain = ((MemorySegment) getFg.invokeExact()).address() == hwnd.address();
    System.out.println("method_plain SetForegroundWindow=" + s1 + " foreground_ok=" + plain);
    boolean alt = plain;
    if (!plain) {                                          // documented workaround: synthetic ALT press unlocks foreground change
      keybd.invokeExact((byte) 0x12, (byte) 0, 0, 0L);
      keybd.invokeExact((byte) 0x12, (byte) 0, 2, 0L);
      int s2 = (int) setFg.invokeExact(hwnd);
      Thread.sleep(400);
      alt = ((MemorySegment) getFg.invokeExact()).address() == hwnd.address();
      System.out.println("method_alt SetForegroundWindow=" + s2 + " foreground_ok=" + alt);
    }
    np.destroy();
    System.out.println(plain || alt ? "FOCUS_PROBE_PASS" : "FOCUS_PROBE_FAIL");
  }
}
