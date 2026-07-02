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
    // Cursor hide/size: when active, gdigrab's own cursor is off (draw_mouse 0) and
    // we render our own pointer. `size`: 0 off, 1 large, 2 xl. Seeded from status too
    // (not only the fx-cursor-mode event) so it's correct even if the overlay cold-
    // loads after both emits — this is why an enlarged/hidden cursor reliably shows.
    let cursorMode = { hide: false, size: 0 };
    recorderStatus().then((s) => {
      if (s) {
        cfg.click_viz = s.click_viz; cfg.keystrokes = s.keystrokes; cfg.spotlight = s.spotlight;
        cursorMode = { hide: s.cursor_hide, size: s.cursor_size === "xl" ? 2 : s.cursor_size === "large" ? 1 : 0 };
      }
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
      listen<{ hide: boolean; size: number }>("fx-cursor-mode", (e) => { cursorMode = e.payload; }),
    ];

    const draw = () => {
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // The mouse hook reports the cursor HOTSPOT (the arrow's tip), so effects
      // centered there sit up-and-left of the cursor's visible body. Nudge them
      // toward the pointer's centroid so the halo/ripple wrap the cursor evenly.
      const offX = 8 * scale, offY = 11 * scale;

      // Cursor spotlight — a compact warm halo hugging the pointer.
      if (cfg.spotlight && cursor) {
        const { x, y } = toCanvasXY(cursor.x, cursor.y, originX, originY);
        const cx = x + offX, cy = y + offY;
        const r = 48 * scale;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(255,246,214,0.40)");
        g.addColorStop(0.5, "rgba(255,238,176,0.18)");
        g.addColorStop(1, "rgba(255,238,176,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      }

      // Overlay-drawn pointer for cursor hide/size. gdigrab's own cursor is off
      // (draw_mouse 0) in these modes; `hide` draws nothing, a size draws an enlarged
      // one. (hide implies size 0 in our config, so this stays a clean either/or.)
      if (cursorMode.size > 0 && cursor) {
        const { x, y } = toCanvasXY(cursor.x, cursor.y, originX, originY);
        const mag = cursorMode.size === 2 ? 2.4 : 1.7;
        drawPointer(ctx, x, y, scale * mag);
      }

      // Click ripples — expanding, fading rings.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = now - rp.born;
        if (age > RIPPLE_MS) { ripples.splice(i, 1); continue; }
        const { x, y } = toCanvasXY(rp.x, rp.y, originX, originY);
        const rad = rippleRadius(age, RIPPLE_MS, 36 * scale);
        ctx.globalAlpha = rippleAlpha(age, RIPPLE_MS);
        ctx.strokeStyle = rp.button === "right" ? "#ffb454" : "#5b7cfa";
        ctx.lineWidth = 3 * scale;
        ctx.beginPath(); ctx.arc(x + offX, y + offY, rad, 0, Math.PI * 2); ctx.stroke();
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
  // Sit the strip well above the floating control pill (which hugs ~60px from the
  // bottom, ~44px tall) so the two never overlap on screen. Clamp for short regions.
  const y = Math.max(20 * scale, h - 168 * scale);
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

/** A stylized arrow pointer (device px), tip at x,y. Shape-agnostic fallback for
 * cursor hide/size when the OS cursor is turned off in the capture. */
function drawPointer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16 * s);
  ctx.lineTo(4 * s, 12 * s);
  ctx.lineTo(7 * s, 18 * s);
  ctx.lineTo(9 * s, 17 * s);
  ctx.lineTo(6 * s, 11 * s);
  ctx.lineTo(11 * s, 11 * s);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.2 * s;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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
