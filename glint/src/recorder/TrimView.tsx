/** TrimView.tsx — recording trim window (#/rec-trim): player + multi-cut timeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Scissors, Trash2, Undo2, Play, Pause } from "lucide-react";
import { trimTarget, trimProbe, trimExport, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, keepRanges, keptCount, type Clip } from "./trimModel";
import { TrimTimeline } from "./TrimTimeline";
import "./trim.css";

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export function TrimView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [target, setTarget] = useState<{ id: number; path: string } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [history, setHistory] = useState<Clip[][]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null); // percent or null

  const duration = probe?.duration_secs ?? 0;
  const fps = probe?.fps && probe.fps > 0 ? probe.fps : 30;
  const ranges = keepRanges(clips);
  const outDur = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05;
  const canSave = clips.length > 0 && keptCount(clips) > 0 && !noop && exporting === null;

  useEffect(() => {
    trimTarget().then(async (t) => {
      if (!t) { setErr("No recording to trim."); return; }
      setTarget(t);
      setSrc(convertFileSrc(t.path));
      try {
        const p = await trimProbe(t.path);
        setProbe(p);
        setClips(initClips(p.duration_secs));
      } catch { setErr("Couldn't read the recording."); }
    }).catch(() => setErr("Couldn't open the recording."));
  }, []);

  useEffect(() => {
    const un = listen<number>("rec-trim-progress", (e) => setExporting(Math.round(e.payload)));
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  const pushHistory = useCallback(() => setHistory((h) => [...h, clips]), [clips]);
  const doSplit = useCallback(() => { pushHistory(); setClips((c) => splitClips(c, playhead)); }, [pushHistory, playhead]);
  const doDelete = useCallback(() => {
    if (selectedId == null) return;
    if (keptCount(clips) <= 1) return; // can't delete the last block
    pushHistory(); setClips((c) => setKept(c, selectedId, false)); setSelectedId(null);
  }, [selectedId, clips, pushHistory]);
  const doUndo = useCallback(() => {
    setHistory((h) => { if (!h.length) return h; setClips(h[h.length - 1]); return h.slice(0, -1); });
  }, []);

  // Gap-skipping playback: while playing, jump the playhead past removed regions.
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    let t = v.currentTime;
    if (playing) {
      const inKept = ranges.some(([s, e]) => t >= s - 0.02 && t < e);
      if (!inKept) {
        const next = ranges.find(([s]) => s > t);
        if (next) { v.currentTime = next[0]; t = next[0]; }
        else { v.pause(); }
      }
    }
    setPlayhead(t);
  };

  const seek = (t: number) => { const v = videoRef.current; if (v) { v.currentTime = Math.max(0, Math.min(t, duration)); setPlayhead(v.currentTime); } };
  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };

  // Cancel/close: confirm first if there are unsaved cuts (each split/delete pushes
  // history; undoing back to the start empties it). Never closes mid-export.
  const requestClose = useCallback(() => {
    if (exporting !== null) return;
    if (history.length > 0 && !window.confirm("Discard your trim edits?")) return;
    getCurrentWindow().close().catch(() => {});
  }, [exporting, history.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting !== null) return; // export is modal — ignore edit/transport keys
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === "s") { e.preventDefault(); doSplit(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(playhead - 1 / fps); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(playhead + 1 / fps); }
      else if (e.key === "Escape") { requestClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSplit, doDelete, doUndo, playhead, fps, exporting, requestClose]);

  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0);
    trimExport(target.id, target.path, ranges, probe.has_audio, duration, probe.width, probe.height, mode)
      .catch(() => setExporting(null)); // a toast already surfaced; window stays open
  };

  if (err) return <div className="trim-root"><div className="trim-error">{err}</div></div>;

  return (
    <div className="trim-root">
      {src && (
        <video
          ref={videoRef}
          className="trim-video"
          src={src}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}

      <div className="trim-transport">
        <button className="trim-iconbtn" onClick={togglePlay} title="Play/Pause (Space)">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="trim-time">{fmt(playhead)} / {fmt(duration)}</span>
        <span className="trim-spacer" />
        <button className="trim-iconbtn" onClick={doSplit} title="Split at playhead (S)"><Scissors size={16} /></button>
        <button className="trim-iconbtn" onClick={doDelete} disabled={selectedId == null || keptCount(clips) <= 1} title="Remove selected (Del)"><Trash2 size={16} /></button>
        <button className="trim-iconbtn" onClick={doUndo} disabled={!history.length} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
      </div>

      {probe && (
        <TrimTimeline
          clips={clips} duration={duration} playhead={playhead}
          selectedId={selectedId} onSelect={setSelectedId} onSeek={seek}
        />
      )}

      <div className="trim-actions">
        <span className="trim-out">Output: {fmt(outDur)} / {fmt(duration)}</span>
        <span className="trim-spacer" />
        {exporting !== null ? (
          <div className="trim-progress"><div className="trim-progress-fill" style={{ width: `${exporting}%` }} /><span>Exporting… {exporting}%</span></div>
        ) : (
          <>
            <button className="trim-btn" onClick={requestClose}>Cancel</button>
            <button className="trim-btn" disabled={!canSave} onClick={() => save("overwrite")}>Overwrite</button>
            <button className="trim-btn trim-btn--primary" disabled={!canSave} onClick={() => save("copy")}>Save copy</button>
          </>
        )}
      </div>
    </div>
  );
}
