/** FxOverlay (route #/rec-fx) — a transparent, click-through canvas the recorder
 * draws effects on; gdigrab records it. Listens for fx-* events from the input
 * hooks and animates click ripples, a cursor spotlight, and keystroke chips. */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recorderStatus } from "../lib/recorder";
import { EMPTY_COMBO, reduceKey, visibleChips, type ComboState } from "./fxKeystrokeModel";
import { toCanvasXY, rippleRadius, rippleAlpha } from "./fxRender";
import "./recfx.css";

interface Ripple { x: number; y: number; born: number; button: string }
const RIPPLE_MS = 550;
const CHIP_TTL_MS = 1500;

export function FxOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let scale = 1, originX = 0, originY = 0;

    // Overlay covers the recording area; its window origin (physical) is our coord
    // origin, and the scale factor maps physical → canvas device px.
    const win = getCurrentWindow();
    const syncGeom = async () => {
      scale = await win.scaleFactor();
      const pos = await win.outerPosition(); // physical, top-left of the overlay
      originX = pos.x; originY = pos.y;
      canvas.width = Math.round(window.innerWidth * scale);
      canvas.height = Math.round(window.innerHeight * scale);
    };
    void syncGeom();

    // Seed the active effects from the live recording (the overlay is built fresh
    // when the session starts, so this is the source of truth on mount).
    const cfg = { click_viz: true, keystrokes: true, spotlight: true };
    recorderStatus().then((s) => {
      if (s) { cfg.click_viz = s.click_viz; cfg.keystrokes = s.keystrokes; cfg.spotlight = s.spotlight; }
    }).catch(() => {});

    const ripples: Ripple[] = [];
    let cursor: { x: number; y: number } | null = null;
    let combo: ComboState = EMPTY_COMBO;

    const unlisteners: Array<Promise<() => void>> = [
      listen<{ x: number; y: number; button: string }>("fx-click", (e) => {
        if (cfg.click_viz) ripples.push({ ...e.payload, born: performance.now() });
      }),
      listen<{ x: number; y: number }>("fx-cursor", (e) => { cursor = e.payload; }),
      listen<{ text: string; isModifier: boolean; down: boolean }>("fx-key", (e) => {
        if (cfg.keystrokes) combo = reduceKey(combo, e.payload, performance.now());
      }),
      listen<{ click_viz: boolean; keystrokes: boolean; spotlight: boolean }>("fx-config", (e) => {
        cfg.click_viz = e.payload.click_viz;
        cfg.keystrokes = e.payload.keystrokes;
        cfg.spotlight = e.payload.spotlight;
      }),
    ];

    const draw = () => {
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Cursor spotlight — a soft radial halo under the pointer.
      if (cfg.spotlight && cursor) {
        const { x, y } = toCanvasXY(cursor.x, cursor.y, originX, originY, scale);
        const r = 60 * scale;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.28)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      // Click ripples — expanding, fading rings.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = now - rp.born;
        if (age > RIPPLE_MS) { ripples.splice(i, 1); continue; }
        const { x, y } = toCanvasXY(rp.x, rp.y, originX, originY, scale);
        const rad = rippleRadius(age, RIPPLE_MS, 42 * scale);
        ctx.globalAlpha = rippleAlpha(age, RIPPLE_MS);
        ctx.strokeStyle = rp.button === "right" ? "#ffb454" : "#5b7cfa";
        ctx.lineWidth = 3 * scale;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Keystroke chips — a fixed bottom-center strip.
      const chips = cfg.keystrokes ? visibleChips(combo, now, CHIP_TTL_MS) : null;
      if (chips) drawChips(ctx, chips, canvas.width, canvas.height, scale);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onResize = () => { void syncGeom(); };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      unlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, []);

  return <canvas ref={canvasRef} className="fx-canvas" />;
}

/** Draw the key-cap chip strip centered near the bottom of the recording area. */
function drawChips(ctx: CanvasRenderingContext2D, chips: string[], w: number, h: number, scale: number) {
  ctx.font = `${20 * scale}px ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  const padX = 14 * scale, gap = 8 * scale, chipH = 40 * scale;
  const widths = chips.map((c) => ctx.measureText(c).width + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
  let x = (w - total) / 2;
  const y = h - 70 * scale;
  chips.forEach((c, i) => {
    const cw = widths[i];
    ctx.fillStyle = "rgba(18,20,28,0.86)";
    roundRect(ctx, x, y, cw, chipH, 8 * scale); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1 * scale;
    roundRect(ctx, x, y, cw, chipH, 8 * scale); ctx.stroke();
    ctx.fillStyle = "#e8e8ee";
    ctx.fillText(c, x + padX, y + chipH / 2);
    x += cw + gap;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
