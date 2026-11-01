// NEXUS 0.4.0 preflight #1 — Java Robot under Smart App Control. Read-only for the user's work:
// takes ONE screenshot into memory, reports only its size (image is not saved), moves the mouse to where it already is.
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import javax.imageio.ImageIO;

public class RobotProbe {
  public static void main(String[] a) throws Exception {
    System.out.println("java.version=" + System.getProperty("java.version") + " vendor=" + System.getProperty("java.vendor") + " home=" + System.getProperty("java.home"));
    System.out.println("headless=" + GraphicsEnvironment.isHeadless());
    Robot r = new Robot();
    Rectangle screen = new Rectangle(Toolkit.getDefaultToolkit().getScreenSize());
    long t = System.nanoTime();
    BufferedImage img = r.createScreenCapture(screen);
    ByteArrayOutputStream png = new ByteArrayOutputStream();
    ImageIO.write(img, "png", png);
    System.out.println("capture=" + img.getWidth() + "x" + img.getHeight() + " png_bytes=" + png.size() + " ms=" + (System.nanoTime() - t) / 1_000_000);
    // Uniform black image would mean capture is blocked; count distinct sampled colours.
    java.util.Set<Integer> colours = new java.util.HashSet<>();
    for (int y = 0; y < img.getHeight(); y += 37) for (int x = 0; x < img.getWidth(); x += 37) colours.add(img.getRGB(x, y));
    System.out.println("distinct_sampled_colours=" + colours.size());
    Point p = MouseInfo.getPointerInfo().getLocation();
    r.mouseMove(p.x, p.y);
    System.out.println("mouse_move_noop=ok at " + p.x + "," + p.y);
    System.out.println("ROBOT_PROBE_PASS");
  }
}
