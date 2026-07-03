/** TrimTimeline.tsx — the track of keep/gap clips + a draggable playhead. Pure
 *  presentational; state lives in TrimView. Press/drag anywhere to scrub the playhead
 *  (pointer-captured so a drag keeps tracking past the track edges). The clips are
 *  visual only (pointer-events: none) — the block under the playhead is the selected one. */
import { useRef } from "react";
import type { Clip } from "./trimModel";

export function TrimTimeline({
  clips, duration, playhead, selectedId, onScrub, waveform,
}: {
  clips: Clip[]; duration: number; playhead: number;
  selectedId: number | null;
  onScrub: (t: number, phase: "start" | "move" | "end") => void;
  waveform: number[] | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = (t: number) => `${(t / Math.max(duration, 0.001)) * 100}%`;

  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - r.left, r.width));
    return r.width > 0 ? (x / r.width) * duration : 0;
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    onScrub(timeAt(e.clientX), "start");
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onScrub(timeAt(e.clientX), "move");
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    onScrub(timeAt(e.clientX), "end");
  };

  return (
    <div
      ref={trackRef}
      className="trim-track"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {waveform && (
        <div className="trim-wave" aria-hidden>
          {waveform.map((p, i) => (
            <span
              key={i}
              className="trim-wave-bar"
              style={{ left: `${(i / waveform.length) * 100}%`, height: `${Math.max(6, p * 100)}%` }}
            />
          ))}
        </div>
      )}
      {clips.map((c) => (
        <div
          key={c.id}
          className={`trim-clip${c.kept ? "" : " trim-clip--gap"}${c.id === selectedId ? " trim-clip--sel" : ""}`}
          style={{ left: pct(c.start), width: pct(c.end - c.start) }}
        >
          {c.kept && c.speed !== 1 && <span className="trim-speed-badge">{c.speed}×</span>}
        </div>
      ))}
      <div className="trim-playhead" style={{ left: pct(playhead) }} />
    </div>
  );
}
