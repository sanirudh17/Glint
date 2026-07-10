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
    trayList().then(setItems).catch(() => setItems([]));
  }, []);

  // Initial load + refetch whenever a new capture lands.
  useEffect(() => {
    refetch();
    const p = listen("tray-updated", refetch);
    return () => { p.then((un) => un()); };
  }, [refetch]);

  // Paint handshake: on a COLD build the Rust side keeps the window hidden and shows it
  // only after this fires, so WebView2 never composites its unpainted first frame (a brief
  // accent-tinted flash on the very first capture). Mirrors the region selector's
  // `rec-select-ready`. Double-rAF = "React has committed AND the browser has painted".
  // A warm reuse (HUD already open) never rebuilds, so this simply goes unheard.
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => { emit("hud-ready").catch(() => {}); });
    });
    return () => cancelAnimationFrame(r);
  }, []);

  // Esc clears the whole tray (mirrors the old HUD dismiss).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void trayClear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resize the window to fit the stack's rendered height (bottom-anchored in Rust).
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) void trayResize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
