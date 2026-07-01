/** TrimView.tsx — recording trim window (#/rec-trim). Minimal player first. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { trimTarget, trimProbe, type ProbeResult } from "../lib/trim";
import "./trim.css";

export function TrimView() {
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    trimTarget()
      .then(async (t) => {
        if (!t) {
          setErr("No recording to trim.");
          return;
        }
        setSrc(convertFileSrc(t.path));
        try {
          setProbe(await trimProbe(t.path));
        } catch {
          setErr("Couldn't read the recording.");
        }
      })
      .catch(() => setErr("Couldn't open the recording."));
  }, []);

  return (
    <div className="trim-root">
      {err && <div className="trim-error">{err}</div>}
      {src && <video className="trim-video" src={src} controls autoPlay />}
      {probe && (
        <div className="trim-meta">
          {probe.width}×{probe.height} · {probe.duration_secs.toFixed(2)}s ·
          {probe.has_audio ? " audio" : " no audio"} · {probe.fps.toFixed(0)} fps
        </div>
      )}
    </div>
  );
}
