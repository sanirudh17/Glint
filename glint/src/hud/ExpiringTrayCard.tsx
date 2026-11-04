import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { trayDismiss, type TrayItem } from "../lib/hudIpc";
import { useAppStore } from "../store/useAppStore";
import { TrayCard } from "./TrayCard";
import { advanceExpiry, CARD_IDLE_MS } from "./expiry";

export function ExpiringTrayCard({ item, onChanged }: { item: TrayItem; onChanged: () => void }) {
  const storedEnabled = useAppStore(state => state.settings?.quick_access_auto_close ?? false);
  const enabled = storedEnabled;
  const remaining = useRef(CARD_IDLE_MS);
  const hovered = useRef(false), dragging = useRef(false);
  const last = useRef(performance.now());
  const [phase, setPhase] = useState<"active" | "leaving" | "collapsing">("active");
  useEffect(() => {
    const unlisten = listen<boolean>("capture-dragging", event => {
      if (!event.payload) { dragging.current = false; last.current = performance.now(); }
    });
    return () => { void unlisten.then(un => un()); };
  }, []);
  useEffect(() => {
    last.current = performance.now();
    if (!enabled || phase !== "active") return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      remaining.current = advanceExpiry({remaining:remaining.current,paused:hovered.current || dragging.current}, now-last.current).remaining;
      last.current = now;
      if (remaining.current === 0) setPhase("leaving");
    }, 100);
    return () => clearInterval(timer);
  }, [enabled, phase]);
  useEffect(() => {
    if (phase === "active") return;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0
      : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--duration-medium")) || 350;
    const timer = window.setTimeout(() => {
      if (phase === "leaving") setPhase("collapsing");
      else void trayDismiss(item.id).then(onChanged).catch(() => { remaining.current=CARD_IDLE_MS; setPhase("active"); });
    }, duration);
    return () => clearTimeout(timer);
  }, [phase, item.id, onChanged]);
  return <div data-capture-id={item.id} className={`tray-expiry ${phase}`} onPointerEnter={() => {hovered.current=true;}}
    onPointerLeave={() => {hovered.current=false;last.current=performance.now();}}
    onPointerDown={event => { if (event.button === 0) dragging.current=true; }}
    onPointerUp={() => {dragging.current=false;last.current=performance.now();}}
    onPointerCancel={() => {dragging.current=false;last.current=performance.now();}}>
    <div className="tray-expiry-inner"><div className="tray-expiry-slide">
      <TrayCard item={item} onChanged={onChanged}/>
    </div></div>
  </div>;
}
