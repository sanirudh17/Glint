/** TrimTimeline.tsx — the track of keep/gap clips + playhead. Pure presentational;
 *  state lives in TrimView. Click a clip to select; click the ruler to seek. */
import type { Clip } from "./trimModel";

export function TrimTimeline({
  clips, duration, playhead, selectedId, onSelect, onSeek,
}: {
  clips: Clip[]; duration: number; playhead: number;
  selectedId: number | null; onSelect: (id: number) => void; onSeek: (t: number) => void;
}) {
  const pct = (t: number) => `${(t / Math.max(duration, 0.001)) * 100}%`;
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };
  return (
    <div className="trim-track" onPointerDown={seekFromEvent}>
      {clips.map((c) => (
        <div
          key={c.id}
          className={`trim-clip${c.kept ? "" : " trim-clip--gap"}${c.id === selectedId ? " trim-clip--sel" : ""}`}
          style={{ left: pct(c.start), width: pct(c.end - c.start) }}
          onPointerDown={(e) => { e.stopPropagation(); if (c.kept) onSelect(c.id); }}
          title={c.kept ? "Click to select · Del to remove" : "Removed"}
        />
      ))}
      <div className="trim-playhead" style={{ left: pct(playhead) }} />
    </div>
  );
}
