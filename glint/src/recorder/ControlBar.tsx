/** ControlBar.tsx — the floating REC indicator (route #/rec-bar). */
import { useEffect, useState } from "react";
import { recorderStop, recorderPause, recorderResume } from "../lib/recorder";
import { Square, Pause, Play } from "lucide-react";
import "./recorder.css";

export function mmss(total: number): string {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ControlBar() {
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  // The timer counts only while running — paused time is excised from the video,
  // so the elapsed shown here matches the final recording's duration.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  // Flip state only on a successful pause/resume — backend toasts on failure.
  async function togglePause() {
    if (busy) return;
    setBusy(true);
    try {
      if (paused) { await recorderResume(); setPaused(false); }
      else { await recorderPause(); setPaused(true); }
    } catch { /* a failure toast already reached the user */ }
    finally { setBusy(false); }
  }

  return (
    <div className="rec-bar">
      <span className={`rec-dot${paused ? " rec-dot--paused" : ""}`} aria-hidden />
      <span className="rec-time">{mmss(secs)}</span>
      <button
        className="rec-pause"
        onClick={togglePause}
        disabled={busy}
        title={paused ? "Resume recording" : "Pause recording"}
        aria-label={paused ? "Resume recording" : "Pause recording"}
      >
        {paused
          ? <Play size={13} strokeWidth={2.5} fill="currentColor" />
          : <Pause size={13} strokeWidth={2.5} fill="currentColor" />}
      </button>
      <button className="rec-stop" onClick={() => recorderStop()} title="Stop recording" aria-label="Stop">
        <Square size={13} strokeWidth={2.5} fill="currentColor" />
      </button>
    </div>
  );
}
