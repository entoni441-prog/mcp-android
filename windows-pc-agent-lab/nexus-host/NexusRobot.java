// NEXUS Host 0.4.0 — Java Robot helper (JDK 17+, run in source mode: `java NexusRobot.java`).
// Long-lived child of NEXUS Host; reads ONE command per stdin line, answers ONE line on stdout:
//   "ok <json>"  or  "err <code>".
// Commands (all arguments validated again here — defence in depth; Node validates first):
//   info
//   capture <maxWidth> <base64(outFile)>            PNG of the primary screen, downscaled to maxWidth
//   move <x> <y> | click <x> <y> <left|right|middle> <1|2> | scroll <x> <y> <notches> | drag <x1> <y1> <x2> <y2>
//   key <combo>                                     e.g. ctrl+s, enter, shift+tab (Windows key never allowed)
//   paste <base64(utf8 text)>                       via clipboard + Ctrl+V; previous text clipboard restored
// Coordinates are Java logical screen points (same space as the capture before downscaling).
// No network, no files except the capture path given by NEXUS Host, no process launching.
import java.awt.*;
import java.awt.datatransfer.*;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.imageio.ImageIO;

public class NexusRobot {
  static Robot robot;

  public static void main(String[] a) throws Exception {
    robot = new Robot();
    robot.setAutoDelay(15);
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
    out.println("ok {\"ready\":true}");
    String line;
    while ((line = in.readLine()) != null) {
      String reply;
      try { reply = "ok " + handle(line.trim().split(" ")); }
      catch (IllegalArgumentException e) { reply = "err " + e.getMessage(); }
      catch (Throwable t) { reply = "err robot_failed"; }
      out.println(reply);
    }
  }

  static int num(String s, int min, int max) {
    int v;
    try { v = Integer.parseInt(s); } catch (Exception e) { throw new IllegalArgumentException("invalid_args"); }
    if (v < min || v > max) throw new IllegalArgumentException("out_of_range");
    return v;
  }

  static Rectangle primary() {
    return GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice().getDefaultConfiguration().getBounds();
  }

  static void inside(int x, int y) {
    if (!primary().contains(x, y)) throw new IllegalArgumentException("out_of_screen");
  }

  static String handle(String[] p) throws Exception {
    switch (p[0]) {
      case "info": {
        GraphicsDevice[] devs = GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices();
        GraphicsConfiguration gc = GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice().getDefaultConfiguration();
        Rectangle b = gc.getBounds();
        double sx = gc.getDefaultTransform().getScaleX(), sy = gc.getDefaultTransform().getScaleY();
        return String.format(Locale.ROOT, "{\"x\":%d,\"y\":%d,\"w\":%d,\"h\":%d,\"scaleX\":%.4f,\"scaleY\":%.4f,\"screens\":%d,\"java\":\"%s\"}",
          b.x, b.y, b.width, b.height, sx, sy, devs.length, System.getProperty("java.version"));
      }
      case "capture": {
        if (p.length != 3) throw new IllegalArgumentException("invalid_args");
        int maxW = num(p[1], 200, 4000);
        String file = new String(Base64.getDecoder().decode(p[2]), StandardCharsets.UTF_8);
        Rectangle b = primary();
        long t = System.nanoTime();
        BufferedImage img = robot.createScreenCapture(b);
        int w = img.getWidth(), h = img.getHeight();
        BufferedImage outImg = img;
        if (w > maxW) {
          int nh = (int) Math.round(h * (maxW / (double) w));
          outImg = new BufferedImage(maxW, nh, BufferedImage.TYPE_INT_RGB);
          Graphics2D g = outImg.createGraphics();
          g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
          g.drawImage(img, 0, 0, maxW, nh, null);
          g.dispose();
        }
        Set<Integer> colours = new HashSet<>();
        for (int y = 0; y < h; y += 37) for (int x = 0; x < w; x += 37) colours.add(img.getRGB(x, y));
        ImageIO.write(outImg, "png", new File(file));
        return String.format(Locale.ROOT, "{\"screenW\":%d,\"screenH\":%d,\"imageW\":%d,\"imageH\":%d,\"colours\":%d,\"ms\":%d}",
          b.width, b.height, outImg.getWidth(), outImg.getHeight(), colours.size(), (System.nanoTime() - t) / 1_000_000);
      }
      case "move": {
        int x = num(p[1], -100000, 100000), y = num(p[2], -100000, 100000);
        inside(x, y); robot.mouseMove(x, y);
        return "{\"moved\":true}";
      }
      case "click": {
        int x = num(p[1], -100000, 100000), y = num(p[2], -100000, 100000);
        inside(x, y);
        int mask;
        switch (p[3]) {
          case "left": mask = InputEvent.BUTTON1_DOWN_MASK; break;
          case "right": mask = InputEvent.BUTTON3_DOWN_MASK; break;
          case "middle": mask = InputEvent.BUTTON2_DOWN_MASK; break;
          default: throw new IllegalArgumentException("invalid_args");
        }
        int count = num(p[4], 1, 2);
        robot.mouseMove(x, y);
        for (int i = 0; i < count; i++) { robot.mousePress(mask); robot.mouseRelease(mask); }
        return "{\"clicked\":true}";
      }
      case "scroll": {
        int x = num(p[1], -100000, 100000), y = num(p[2], -100000, 100000), n = num(p[3], -20, 20);
        inside(x, y); robot.mouseMove(x, y); robot.mouseWheel(n);
        return "{\"scrolled\":true}";
      }
      case "drag": {
        int x1 = num(p[1], -100000, 100000), y1 = num(p[2], -100000, 100000), x2 = num(p[3], -100000, 100000), y2 = num(p[4], -100000, 100000);
        inside(x1, y1); inside(x2, y2);
        robot.mouseMove(x1, y1); robot.mousePress(InputEvent.BUTTON1_DOWN_MASK);
        for (int i = 1; i <= 10; i++) robot.mouseMove(x1 + (x2 - x1) * i / 10, y1 + (y2 - y1) * i / 10);
        robot.mouseRelease(InputEvent.BUTTON1_DOWN_MASK);
        return "{\"dragged\":true}";
      }
      case "key": {
        if (p.length != 2) throw new IllegalArgumentException("invalid_args");
        int[] codes = combo(p[1]);
        for (int c : codes) robot.keyPress(c);
        for (int i = codes.length - 1; i >= 0; i--) robot.keyRelease(codes[i]);
        return "{\"pressed\":true}";
      }
      case "paste": {
        if (p.length != 2) throw new IllegalArgumentException("invalid_args");
        String text = new String(Base64.getDecoder().decode(p[1]), StandardCharsets.UTF_8);
        if (text.length() > 4000) throw new IllegalArgumentException("too_long");
        Clipboard cb = Toolkit.getDefaultToolkit().getSystemClipboard();
        String previous = null;
        try { if (cb.isDataFlavorAvailable(DataFlavor.stringFlavor)) previous = (String) cb.getData(DataFlavor.stringFlavor); } catch (Exception ignored) { }
        cb.setContents(new StringSelection(text), null);
        robot.keyPress(KeyEvent.VK_CONTROL); robot.keyPress(KeyEvent.VK_V);
        robot.keyRelease(KeyEvent.VK_V); robot.keyRelease(KeyEvent.VK_CONTROL);
        robot.delay(400);
        if (previous != null) cb.setContents(new StringSelection(previous), null);
        return String.format(Locale.ROOT, "{\"pasted\":%d,\"clipboardRestored\":%b}", text.length(), previous != null);
      }
      default: throw new IllegalArgumentException("unknown_command");
    }
  }

  static final Map<String, Integer> KEYS = new HashMap<>();
  static {
    KEYS.put("ctrl", KeyEvent.VK_CONTROL); KEYS.put("shift", KeyEvent.VK_SHIFT); KEYS.put("alt", KeyEvent.VK_ALT);
    KEYS.put("enter", KeyEvent.VK_ENTER); KEYS.put("tab", KeyEvent.VK_TAB); KEYS.put("esc", KeyEvent.VK_ESCAPE);
    KEYS.put("backspace", KeyEvent.VK_BACK_SPACE); KEYS.put("delete", KeyEvent.VK_DELETE); KEYS.put("space", KeyEvent.VK_SPACE);
    KEYS.put("up", KeyEvent.VK_UP); KEYS.put("down", KeyEvent.VK_DOWN); KEYS.put("left", KeyEvent.VK_LEFT); KEYS.put("right", KeyEvent.VK_RIGHT);
    KEYS.put("home", KeyEvent.VK_HOME); KEYS.put("end", KeyEvent.VK_END); KEYS.put("pageup", KeyEvent.VK_PAGE_UP); KEYS.put("pagedown", KeyEvent.VK_PAGE_DOWN);
    for (int i = 1; i <= 12; i++) KEYS.put("f" + i, KeyEvent.VK_F1 + i - 1);
    for (char c = 'a'; c <= 'z'; c++) KEYS.put(String.valueOf(c), KeyEvent.VK_A + (c - 'a'));
    for (char c = '0'; c <= '9'; c++) KEYS.put(String.valueOf(c), KeyEvent.VK_0 + (c - '0'));
  }

  static int[] combo(String s) {
    String[] parts = s.toLowerCase(Locale.ROOT).split("\\+");
    if (parts.length < 1 || parts.length > 4) throw new IllegalArgumentException("invalid_key");
    int[] out = new int[parts.length];
    for (int i = 0; i < parts.length; i++) {
      Integer c = KEYS.get(parts[i]);
      if (c == null) throw new IllegalArgumentException("invalid_key");
      out[i] = c;
    }
    return out;
  }
}
