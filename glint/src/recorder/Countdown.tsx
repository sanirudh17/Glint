/** Countdown.tsx — centered 3·2·1 before recording (route #/rec-countdown). */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./recorder.css";

export function Countdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n <= 0) { getCurrentWindow().close(); return; }
    const id = window.setTimeout(() => setN((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n]);
  return <div className="rec-countdown">{n > 0 ? n : ""}</div>;
}
