/**
 * PinApp.tsx — root of a Pin-to-Screen window (route #/pin).
 *
 * A floating, always-on-top, chrome-free image. Drag the image to move it;
 * mouse-wheel or corner handles to resize (aspect locked); right-click for a
 * native OS menu (Copy / Save to Library / Opacity / Close). Ephemeral.
 *
 * The right-click menu is a NATIVE OS context menu (built + popped in Rust via
 * `pin_context_menu`), not HTML — an HTML menu is clamped to the image-sized
 * window and got clipped on short/narrow pins. Menu clicks are handled in Rust;
 * the only one that needs the frontend is Opacity (CSS state), delivered back as
 * a `pin-opacity` event. `pin-flash` carries copy/save confirmations. Both events
 * carry the target label because Tauri delivers events to every window's listeners.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPinData, pinClose, type PinData } from "../lib/pin";
import { X } from "lucide-react";
import "./pin.css";

const MIN = 80; // min logical px (any edge)

export function PinApp() {
  const [data, setData] = useState<PinData | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  // Max logical size = the window's monitor; filled in on mount.
  const maxRef = useRef<{ w: number; h: number }>({ w: 4000, h: 4000 });

  // Fetch this pin's image on mount; if it's gone, close the window.
  useEffect(() => {
    getPinData().then(setData).catch(() => pinClose());
  }, []);

  // Cache the monitor's logical size for resize clamping.
  useEffect(() => {
    currentMonitor()
      .then((m) => {
        if (m) {
          maxRef.current = {
            w: m.size.width / m.scaleFactor,
            h: m.size.height / m.scaleFactor,
          };
        }
      })
      .catch(() => {});
  }, []);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  }, []);

  // React to native-menu clicks routed back from Rust. Filter by label: Tauri
  // delivers an event to EVERY window's listeners, so another pin would otherwise
  // react to this pin's menu.
  useEffect(() => {
    const label = getCurrentWindow().label;
    const unsubs: Array<() => void> = [];
    listen<{ label: string; pct: number }>("pin-opacity", (e) => {
      if (e.payload.label === label) setOpacity(e.payload.pct / 100);
    }).then((un) => unsubs.push(un));
    listen<{ label: string; msg: string }>("pin-flash", (e) => {
      if (e.payload.label === label) showFlash(e.payload.msg);
    }).then((un) => unsubs.push(un));
    return () => unsubs.forEach((un) => un());
  }, [showFlash]);

  // Esc closes (works once the window has focus, e.g. after a click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aspect = data ? data.width / data.height : 1;

  // Clamp a desired WIDTH (logical) to [MIN, monitor], deriving height from the
  // locked aspect and re-clamping if height escapes its own bounds. Returns the
  // integer logical size to apply.
  const clampSize = useCallback(
    (rawW: number) => {
      const max = maxRef.current;
      let w = Math.max(MIN, Math.min(rawW, max.w));
      let h = w / aspect;
      if (h < MIN) { h = MIN; w = h * aspect; }
      if (h > max.h) { h = max.h; w = h * aspect; }
      return { w: Math.round(w), h: Math.round(h) };
    },
    [aspect],
  );

  // Resize anchored at the top-left (used by the wheel zoom).
  const applyWidth = useCallback(
    async (rawW: number) => {
      const { w, h } = clampSize(rawW);
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    },
    [clampSize],
  );

  // Move: drag the image (left button, not a handle).
  const onImgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    getCurrentWindow().startDragging().catch((err) => console.error("pin move failed", err));
  };

  // Scroll to scale (aspect locked).
  const onWheel = async (e: React.WheelEvent) => {
    const cur = await getCurrentWindow().innerSize();
    const scale = await getCurrentWindow().scaleFactor();
    const curW = cur.width / scale;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    applyWidth(curW * factor);
  };

  // Corner handle drag → resize with the OPPOSITE corner anchored, so the grabbed
  // corner tracks the cursor. We drive width from horizontal motion (aspect locks
  // height) and reposition the window's top-left so the anchored edges stay put:
  //   right corners (ne/se) keep the LEFT edge → x fixed; left corners keep RIGHT.
  //   bottom corners (se/sw) keep the TOP edge → y fixed; top corners keep BOTTOM.
  // Without the reposition the window only ever grew from its top-left origin, so
  // every corner but SE felt like it dragged the wrong corner.
  const onHandleDown = (e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    const win = getCurrentWindow();
    Promise.all([win.innerSize(), win.outerPosition(), win.scaleFactor()])
      .then(([sz, pos, scale]) => {
        const startW = sz.width / scale;
        const startH = sz.height / scale;
        const startLeft = pos.x / scale;
        const startTop = pos.y / scale;
        const right = corner === "ne" || corner === "se";
        const bottom = corner === "se" || corner === "sw";
        const onMove = (m: PointerEvent) => {
          const dx = m.screenX - startX;
          const rawW = right ? startW + dx : startW - dx;
          const { w, h } = clampSize(rawW);
          // Keep the anchored corner fixed: shift top-left by the size change on
          // the moving edges only.
          const left = right ? startLeft : startLeft - (w - startW);
          const top = bottom ? startTop : startTop - (h - startH);
          win.setSize(new LogicalSize(w, h));
          win.setPosition(new LogicalPosition(Math.round(left), Math.round(top)));
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      })
      .catch((err) => console.error("pin resize failed", err));
  };

  // Right-click → native OS context menu (built + shown in Rust, never clipped).
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    invoke("pin_context_menu").catch((err) => console.error("pin menu failed", err));
  };

  return (
    <div className="pin-root" onContextMenu={onContextMenu}>
      {data && (
        <img
          className="pin-img"
          src={data.imageDataUrl}
          alt=""
          draggable={false}
          style={{ opacity }}
          onPointerDown={onImgPointerDown}
          onWheel={onWheel}
        />
      )}

      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <div
          key={c}
          className={`pin-handle pin-handle--${c}`}
          onPointerDown={(e) => onHandleDown(e, c)}
        />
      ))}

      <button
        type="button"
        className="pin-close"
        aria-label="Close pin"
        title="Close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => pinClose()}
      >
        <X size={13} strokeWidth={2} />
      </button>

      <div className={`pin-flash${flash ? " pin-flash--show" : ""}`} aria-live="polite">{flash}</div>
    </div>
  );
}
