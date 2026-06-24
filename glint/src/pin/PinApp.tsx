/**
 * PinApp.tsx — root of a Pin-to-Screen window (route #/pin).
 *
 * A floating, always-on-top, chrome-free image. Drag the image to move it;
 * mouse-wheel or corner handles to resize (aspect locked); right-click for
 * Copy / Save to Library / Opacity / Close. Ephemeral — closing clears it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getPinData, pinSave, pinCopy, pinClose, type PinData } from "../lib/pin";
import { X } from "lucide-react";
import "./pin.css";

const MIN = 80;          // min logical px (any edge)
const OPACITIES = [100, 75, 50, 25];

type Menu = { x: number; y: number } | null;

export function PinApp() {
  const [data, setData] = useState<PinData | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [menu, setMenu] = useState<Menu>(null);
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

  // Esc closes (works once the window has focus, e.g. after a click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aspect = data ? data.width / data.height : 1;

  // Apply a new WIDTH (logical), deriving height from the locked aspect, clamped.
  const applyWidth = useCallback(
    async (rawW: number) => {
      const max = maxRef.current;
      let w = Math.max(MIN, Math.min(rawW, max.w));
      let h = w / aspect;
      if (h < MIN) { h = MIN; w = h * aspect; }
      if (h > max.h) { h = max.h; w = h * aspect; }
      await getCurrentWindow().setSize(new LogicalSize(Math.round(w), Math.round(h)));
    },
    [aspect],
  );

  // Move: drag the image (left button, not a handle).
  const onImgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  // Scroll to scale (aspect locked).
  const onWheel = async (e: React.WheelEvent) => {
    const cur = await getCurrentWindow().innerSize();
    const scale = await getCurrentWindow().scaleFactor();
    const curW = cur.width / scale;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    applyWidth(curW * factor);
  };

  // Corner handle drag → resize from the width delta.
  const onHandleDown = (e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    getCurrentWindow().innerSize().then(async (sz) => {
      const scale = await getCurrentWindow().scaleFactor();
      const startW = sz.width / scale;
      const grows = corner === "ne" || corner === "se"; // dragging right edge outward grows
      const onMove = (m: PointerEvent) => {
        const dx = (m.screenX - startX) * (grows ? 1 : -1);
        applyWidth(startW + dx);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const doCopy = () => { setMenu(null); pinCopy().then(() => showFlash("Copied")).catch(() => showFlash("Couldn't copy")); };
  const doSave = () => { setMenu(null); pinSave().then(() => showFlash("Saved to Library")).catch(() => showFlash("Couldn't save")); };

  return (
    <div className="pin-root" onContextMenu={onContextMenu} onClick={() => menu && setMenu(null)}>
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

      {menu && (
        <div className="pin-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="pin-menu-item" onClick={doCopy}>Copy</button>
          <button className="pin-menu-item" onClick={doSave}>Save to Library</button>
          <div className="pin-menu-sep" />
          <div className="pin-menu-row">
            <span className="pin-menu-row-label">Opacity</span>
            {OPACITIES.map((p) => (
              <button
                key={p}
                className={`pin-opacity-btn${Math.round(opacity * 100) === p ? " pin-opacity-btn--active" : ""}`}
                onClick={() => { setOpacity(p / 100); setMenu(null); }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="pin-menu-sep" />
          <button className="pin-menu-item" onClick={() => pinClose()}>Close</button>
        </div>
      )}

      <div className={`pin-flash${flash ? " pin-flash--show" : ""}`} aria-live="polite">{flash}</div>
    </div>
  );
}
