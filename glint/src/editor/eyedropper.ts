/** Format an 8-bit RGB triple as a lowercase #rrggbb string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Read the pixel at (x,y) from a row-major RGBA buffer. Null if out of bounds. */
export function pixelToHex(data: Uint8ClampedArray, width: number, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= width) return null;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 2 >= data.length) return null;
  return rgbToHex(data[i], data[i + 1], data[i + 2]);
}

/** Draw the image to an offscreen canvas and read the pixel at (x,y) in image
 *  pixels. Impure (needs a DOM canvas) — not unit-tested; the pixel math is in
 *  pixelToHex. Returns null out of bounds or if a 2D context is unavailable. */
export function sampleColorAt(
  image: CanvasImageSource, iw: number, ih: number, x: number, y: number,
): string | null {
  if (x < 0 || y < 0 || x >= iw || y >= ih) return null;
  const canvas = document.createElement("canvas");
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, iw, ih);
  return pixelToHex(data, iw, x, y);
}
