// The menu-bar icon: a small ant drawn from a pixel map, so the app ships no image files. On a Mac it is a
// template image (black with alpha) that the menu bar tints for light and dark mode.

// 16 × 16, '#' is ink.
const ANT = [
  '................',
  '................',
  '...#........#...',
  '....#......#....',
  '.....#....#.....',
  '......####......',
  '.....######.....',
  '..#...####...#..',
  '...#..####..#...',
  '....#######.....',
  '...#..####..#...',
  '..#..######..#..',
  '....########....',
  '...#..####..#...',
  '..#....##....#..',
  '................',
];

// BGRA pixels at `scale` times 16 px, for nativeImage.createFromBitmap.
export function antBitmap(scale: number, rgb: [number, number, number] = [0, 0, 0]): Buffer {
  const size = 16 * scale, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (ANT[Math.floor(y / scale)][Math.floor(x / scale)] !== '#') continue;
      const i = (y * size + x) * 4;
      buf[i] = rgb[2]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[0]; buf[i + 3] = 255;
    }
  }
  return buf;
}
