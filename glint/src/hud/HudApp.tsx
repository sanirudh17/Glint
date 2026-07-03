/**
 * HudApp.tsx — root of the Quick Access Overlay (route #/hud). An accumulating
 * bottom-left stack of recent captures (newest at the bottom). Refetches on the
 * `tray-updated` event, and resizes its own window to the stack's height.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
