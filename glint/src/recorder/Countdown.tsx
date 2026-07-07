/** Countdown.tsx — centered N·…·1 before capture/recording (route #/rec-countdown?n=).
 *
 * At zero it does NOT close itself: it holds on an "arming" dot until the backend closes
 * the window. For recording, the backend closes it the instant ffmpeg is genuinely
 * capturing, so the countdown vanishing is the user's real "go" signal (no lost first
 * second, no dead pre-roll). For delayed screenshot capture the backend closes it right
 * at zero. A safety timeout self-closes if the backend ever forgets. */
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
    if (n <= 0) return; // reached zero — hold; the backend closes us when capture is live
    const id = window.setTimeout(() => setN((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n]);
  // Safety net: never linger forever if the backend forgets to close us.
  useEffect(() => {
    const id = window.setTimeout(() => void getCurrentWindow().close(), 15000);
    return () => window.clearTimeout(id);
  }, []);
  // n>0: the big 3·2·1 digit. At zero we hold on a SMALL pulsing "arming" dot (not the
  // full-size digit) until the backend closes us the instant ffmpeg is truly capturing —
  // subtle enough not to read as a stray white blob, present enough to say "not yet".
  return (
    <div className="rec-countdown">
      {n > 0 ? n : <span className="rec-countdown-arming" aria-label="Starting recording" />}
    </div>
  );
}
