/** Countdown.tsx — centered N·…·1 before capture/recording (route #/rec-countdown?n=). */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./recorder.css";

function startFromHash(): number {
  // Hash looks like "#/rec-countdown?n=5".
  const q = window.location.hash.split("?")[1] ?? "";
  const n = Number(new URLSearchParams(q).get("n"));
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.floor(n) : 3;
}

export function Countdown() {
  const [n, setN] = useState(startFromHash);
  useEffect(() => {
    if (n <= 0) { getCurrentWindow().close(); return; }
    const id = window.setTimeout(() => setN((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n]);
  return <div className="rec-countdown">{n > 0 ? n : ""}</div>;
}
