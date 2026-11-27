// A menu-bar icon from a 16 × 16 pixel map ('#' is ink), so a game ships no image files for it. On a Mac it is a
// template image (black with alpha) that the menu bar tints for light and dark mode. For ShellConfig.icon.
export function pixelIcon(rows: readonly string[], scale: number): Buffer {
  const size = 16 * scale, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rows[Math.floor(y / scale)]?.[Math.floor(x / scale)] !== '#') continue;
      buf[(y * size + x) * 4 + 3] = 255; // BGRA: black, opaque
    }
  }
  return buf;
}
