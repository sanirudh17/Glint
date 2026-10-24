/** Separable box blur with clamped edges. Stable in WebView2, without canvas filters. */
export function blurPixels(source: Uint8ClampedArray, w: number, h: number, strength: number): Uint8ClampedArray {
  let input = new Uint8ClampedArray(source);
  const radius = Math.max(1, Math.min(32, Math.round(strength / 2)));
  const span = radius * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      const out = new Uint8ClampedArray(input.length), lines = horizontal ? h : w, length = horizontal ? w : h;
      const index = (line: number, pos: number) => (horizontal ? line * w + Math.max(0, Math.min(length - 1, pos)) : Math.max(0, Math.min(length - 1, pos)) * w + line) * 4;
      for (let line = 0; line < lines; line++) {
        const sums = [0, 0, 0];
        for (let p = -radius; p <= radius; p++) for (let c = 0; c < 3; c++) sums[c] += input[index(line, p) + c];
        for (let p = 0; p < length; p++) {
          const i = index(line, p); for (let c = 0; c < 3; c++) { out[i + c] = sums[c] / span; sums[c] += input[index(line, p + radius + 1) + c] - input[index(line, p - radius) + c]; }
          out[i + 3] = 255;
        }
      }
      input = out;
    }
  }
  return input;
}
