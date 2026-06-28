/** ControlBar.tsx — the floating REC indicator (route #/rec-bar). */
import { useEffect, useState } from "react";
import { recorderStop } from "../lib/recorder";
import { Square } from "lucide-react";
import "./recorder.css";

export function mmss(total: number): string {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ControlBar() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="rec-bar">
      <span className="rec-dot" aria-hidden />
      <span className="rec-time">{mmss(secs)}</span>
      <button className="rec-stop" onClick={() => recorderStop()} title="Stop recording" aria-label="Stop">
        <Square size={13} strokeWidth={2.5} fill="currentColor" />
      </button>
    </div>
  );
}
