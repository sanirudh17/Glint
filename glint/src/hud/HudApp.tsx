/**
 * HudApp.tsx — root of the Quick Access Overlay (route #/hud). An accumulating
 * bottom-left stack of recent captures (newest at the bottom). Refetches on the
 * `tray-updated` event, and resizes its own window to the stack's height.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { trayList, trayClear, trayResize, type TrayItem } from "../lib/hudIpc";
import { TrayCard } from "./TrayCard";
import "./hud.css";

export function HudApp() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);

  const refetch = useCallback(() => {
    // Retry once on failure — under load the IPC channel can be momentarily
    // saturated and the first tray_list may fail or return empty.
    trayList()
      .then((list) => {
        if (list.length === 0) {
          // Could be a race where the tray was updated just after our fetch;
          // retry shortly.
          setTimeout(() => {
            trayList().then(setItems).catch(() => {});
          }, 120);
        }
        setItems(list);
      })
      .catch(() => {
        // Retry after a beat
        setTimeout(() => {
          trayList().then(setItems).catch(() => setItems([]));
        }, 200);
      });
  }, []);

  // Initial load + refetch whenever a new capture lands.
  // Also do an immediate second fetch shortly after mount — if the window
  // was built and shown before JS subscribed, the initial tray-updated emit
  // may have been missed (race under load). The backend also re-emits, but
  // double-safe here.
  useEffect(() => {
    refetch();
    const t = setTimeout(refetch, 400);
    const p = listen("tray-updated", refetch);
    // Also listen for a generic retry ping from the backend
    const p2 = listen("tray-updated-retry", refetch);
    return () => {
      clearTimeout(t);
      p.then((un) => un());
      p2.then((un) => un());
    };
  }, [refetch]);

  // Paint handshake: on a COLD build the Rust side keeps the window hidden and shows it
  // only after this fires, so WebView2 never composites its unpainted first frame (a brief
  // accent-tinted flash on the very first capture). Mirrors the region selector's
  // `rec-select-ready`. Double-rAF = "React has committed AND the browser has painted".
  // A warm reuse (HUD already open) never rebuilds, so this simply goes unheard.
  // Under load rAF may be throttled while hidden; the Rust fallback timers guarantee
  // show() even if this never fires — but when it does fire it makes the first frame crisp.
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        emit("hud-ready").catch(() => {});
        // After painting, ensure the stack height is reported even if ResizeObserver
        // missed the first layout (observer may not fire if height was 0 at observe time).
        const el = stackRef.current;
        if (el) {
          const h = Math.ceil(el.getBoundingClientRect().height);
          if (h > 0) void trayResize(h);
        }
      });
    });
    return () => cancelAnimationFrame(r);
  }, []);

  // Esc clears the whole tray (mirrors the old HUD dismiss).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void trayClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resize the window to fit the stack's rendered height (bottom-anchored in Rust).
  // Use both ResizeObserver and a layout-effect fallback so that even if the
  // observer is throttled under load, the height still gets reported.
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    let lastH = 0;
    const report = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0 && h !== lastH) {
        lastH = h;
        void trayResize(h);
      }
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    // Immediate + delayed fallbacks
    report();
    const t1 = setTimeout(report, 80);
    const t2 = setTimeout(report, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [items]);

  return (
    <div className="tray-root" ref={stackRef}>
      {items.length >= 2 && (
        <button type="button" className="tray-clear" onClick={() => void trayClear()}>
          Clear all
        </button>
      )}
      <div className="tray-stack">
        {items.map((it) => (
          <TrayCard key={it.id} item={it} onChanged={refetch} />
        ))}
      </div>
    </div>
  );
}
