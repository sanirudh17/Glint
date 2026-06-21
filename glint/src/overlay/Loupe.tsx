/**
 * Loupe.tsx — Pixel-peeping magnifier for precise capture aiming.
 *
 * A small canvas that magnifies the FROZEN image ~8× around the cursor with
 * nearest-neighbour sampling (no blur), a faint pixel grid, and a highlighted
 * centre cell marking the exact pixel under the cursor. Below the glass sits a
 * monospace hex readout of that centre pixel's colour, with a colour swatch.
 *
 * Coordinate model: the cursor arrives in logical/CSS px (cx, cy); the frozen
 * bitmap is in PHYSICAL px, so we multiply by `scale` to find the source pixel.
 * SAMPLE is odd so there is a true centre pixel.
 *
 * Design: "instrument glass" — a crisp rounded square, 1px accent ring, dark
 * translucent backing. No glow. pointer-events:none so it never eats input.
 */

import { useEffect, useRef, useState } from "react";

// On-screen canvas edge (logical px) and how many physical px we sample across.
// CANVAS / SAMPLE must be an integer for crisp, grid-aligned magnification.
const CANVAS = 120;
const SAMPLE = 15; // odd → a real centre pixel
const ZOOM = CANVAS / SAMPLE; // 8× exactly
const HALF = Math.floor(SAMPLE / 2); // 7

// Loupe footprint (canvas + readout) for edge-flip math.
const LOUPE_W = CANVAS;
const LOUPE_H = CANVAS + 26;
const OFFSET = 22; // gap between cursor and loupe

interface LoupeProps {
  bitmap: ImageBitmap | null;
  /** Cursor position in logical/CSS px. */
  cx: number;
  cy: number;
  /** Monitor scale factor — logical × scale = physical px in the frozen bitmap. */
  scale: number;
}

export function Loupe({ bitmap, cx, cy, scale }: LoupeProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hex, setHex] = useState("#000000");

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !bitmap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // Centre physical pixel under the cursor.
    const centerX = Math.floor(cx * scale);
    const centerY = Math.floor(cy * scale);
    const sx = centerX - HALF;
    const sy = centerY - HALF;

    ctx.clearRect(0, 0, CANVAS, CANVAS);
    ctx.imageSmoothingEnabled = false;
    // Nearest-neighbour magnification of the SAMPLE×SAMPLE source window.
    ctx.drawImage(bitmap, sx, sy, SAMPLE, SAMPLE, 0, 0, CANVAS, CANVAS);

    // Faint pixel grid — sells the "examining individual pixels" feel.
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < SAMPLE; i++) {
      const p = Math.round(i * ZOOM) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, CANVAS);
      ctx.moveTo(0, p);
      ctx.lineTo(CANVAS, p);
    }
    ctx.stroke();

    // Centre cell — the exact pixel that will be the selection corner.
    const cell = HALF * ZOOM;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cell + 0.5, cell + 0.5, ZOOM - 1, ZOOM - 1);
    // Accent ring just outside the centre cell (hard-coded: canvas can't read CSS vars).
    ctx.strokeStyle = "#5B7CFA";
    ctx.lineWidth = 1;
    ctx.strokeRect(cell - 0.5, cell - 0.5, ZOOM + 1, ZOOM + 1);

    // Read the centre pixel for the hex label.
    const data = ctx.getImageData(CANVAS / 2, CANVAS / 2, 1, 1).data;
    const next =
      "#" +
      [data[0], data[1], data[2]]
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("");
    setHex((prev) => (prev === next ? prev : next));
  }, [bitmap, cx, cy, scale]);

  // ── Position: offset from cursor, flipping near viewport edges ───────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = cx + OFFSET;
  let top = cy + OFFSET;
  if (left + LOUPE_W > vw) left = cx - OFFSET - LOUPE_W;
  if (top + LOUPE_H > vh) top = cy - OFFSET - LOUPE_H;

  return (
    <div className="ov-loupe" style={{ left, top }} aria-hidden>
      <canvas
        ref={ref}
        width={CANVAS}
        height={CANVAS}
        className="ov-loupe-canvas"
      />
      <div className="ov-loupe-readout">
        <span className="ov-loupe-swatch" style={{ background: hex }} />
        <span className="ov-loupe-hex">{hex.toUpperCase()}</span>
      </div>
    </div>
  );
}
