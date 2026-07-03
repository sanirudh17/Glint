/** TrimView.tsx — recording trim window (#/rec-trim): player + multi-cut timeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause } from "lucide-react";
import { trimTarget, trimProbe, trimExport, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, keepRanges, keptCount, keptSegments, outputDuration, type Clip } from "./trimModel";
import { TrimTimeline } from "./TrimTimeline";
import "./trim.css";

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

const EPS = 1e-4;

export function TrimView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [target, setTarget] = useState<{ id: number; path: string } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  type EditState = { clips: Clip[]; fadeIn: number; fadeOut: number };
  const [edit, setEdit] = useState<EditState>({ clips: [], fadeIn: 0, fadeOut: 0 });
  const [undoStack, setUndoStack] = useState<EditState[]>([]);
  const [redoStack, setRedoStack] = useState<EditState[]>([]);
  const { clips, fadeIn, fadeOut } = edit;
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null); // percent or null

  // Scrub plumbing: the pointer drives the playhead instantly (so the red line is
  // always glued to the cursor), while the <video> catches up via *coalesced* seeks —
  // at most one seek is ever in flight; the latest requested time is remembered and
  // applied when the previous seek finishes. This keeps a fast drag responsive instead
  // of flooding the decoder with seeks it silently drops.
  const draggingRef = useRef(false);
  const seekingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);

  const duration = probe?.duration_secs ?? 0;
  const fps = probe?.fps && probe.fps > 0 ? probe.fps : 30;
  const ranges = keepRanges(clips);
  const outDur = outputDuration(clips);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05
    && clips.filter((c) => c.kept).every((c) => c.speed === 1) && fadeIn === 0 && fadeOut === 0;
  const canSave = clips.length > 0 && keptCount(clips) > 0 && !noop && exporting === null;

  // The "selected" block is simply the kept clip under the playhead — position the line
  // in a section and Delete removes it. (At the very end, fall back to the last kept.)
  const selected =
    clips.find((c) => c.kept && playhead >= c.start - EPS && playhead < c.end - EPS) ??
    (playhead >= duration - EPS ? [...clips].reverse().find((c) => c.kept) : undefined);
  const selectedId = selected?.id ?? null;
  const canDelete = selectedId != null && keptCount(clips) > 1 && exporting === null;

  useEffect(() => {
    trimTarget().then(async (t) => {
      if (!t) { setErr("No recording to trim."); return; }
      setTarget(t);
      setSrc(convertFileSrc(t.path));
      try {
        const p = await trimProbe(t.path);
        setProbe(p);
        setEdit({ clips: initClips(p.duration_secs), fadeIn: 0, fadeOut: 0 });
      } catch { setErr("Couldn't read the recording."); }
    }).catch(() => setErr("Couldn't open the recording."));
  }, []);

  useEffect(() => {
    const un = listen<number>("rec-trim-progress", (e) => setExporting(Math.round(e.payload)));
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  // ── video seek coalescing ───────────────────────────────────────────────────
  const applyVideoSeek = useCallback((t: number) => {
    const v = videoRef.current; if (!v) return;
    const clamped = Math.max(0, Math.min(t, duration || t));
    if (seekingRef.current) { pendingRef.current = clamped; return; }
    seekingRef.current = true;
    try { v.currentTime = clamped; } catch { seekingRef.current = false; }
  }, [duration]);
  const onSeeked = () => {
    seekingRef.current = false;
    if (pendingRef.current != null) {
      const t = pendingRef.current; pendingRef.current = null;
      applyVideoSeek(t);
    }
  };

  // Drag scrub from the timeline: instant playhead + coalesced video seek. Pauses
  // playback on grab so seeking and playback don't fight.
  const scrub = useCallback((t: number, phase: "start" | "move" | "end") => {
    const clamped = Math.max(0, Math.min(t, duration));
    if (phase === "start") {
      draggingRef.current = true;
      const v = videoRef.current;
      if (v && !v.paused) { v.pause(); setPlaying(false); }
    }
    setPlayhead(clamped);
    applyVideoSeek(clamped);
    if (phase === "end") draggingRef.current = false;
  }, [duration, applyVideoSeek]);

  // Programmatic seek (frame-step keys).
  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, duration));
    setPlayhead(clamped);
    applyVideoSeek(clamped);
  }, [duration, applyVideoSeek]);

  const commit = useCallback((next: EditState) => {
    setUndoStack((s) => [...s, edit]);
    setRedoStack([]);
    setEdit(next);
  }, [edit]);
  const doSplit = useCallback(() => { commit({ ...edit, clips: splitClips(clips, playhead) }); }, [commit, edit, clips, playhead]);
  const doDelete = useCallback(() => {
    if (selectedId == null || keptCount(clips) <= 1) return; // can't delete the last block
    commit({ ...edit, clips: setKept(clips, selectedId, false) });
  }, [commit, edit, clips, selectedId]);
  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (!s.length) return s;
      setRedoStack((r) => [...r, edit]);
      setEdit(s[s.length - 1]);
      return s.slice(0, -1);
    });
  }, [edit]);
  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      setUndoStack((u) => [...u, edit]);
      setEdit(r[r.length - 1]);
      return r.slice(0, -1);
    });
  }, [edit]);

  // Gap-skipping playback: while playing, jump the playhead past removed regions.
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    if (draggingRef.current) return; // the pointer owns the playhead while scrubbing
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

  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };

  // Cancel/close: confirm first if there are unsaved cuts (each split/delete pushes
  // history; undoing back to the start empties it). Never closes mid-export.
  const requestClose = useCallback(() => {
    if (exporting !== null) return;
    if (undoStack.length > 0 && !window.confirm("Discard your trim edits?")) return;
    getCurrentWindow().close().catch(() => {});
  }, [exporting, undoStack.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting !== null) return; // export is modal — ignore edit/transport keys
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === "s") { e.preventDefault(); doSplit(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(playhead - 1 / fps); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(playhead + 1 / fps); }
      else if (e.key === "Escape") { requestClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSplit, doDelete, undo, redo, seek, playhead, fps, exporting, requestClose]);

  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0);
    trimExport(target.id, target.path, keptSegments(clips), probe.has_audio, duration, probe.width, probe.height, fadeIn, fadeOut, mode)
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
          preload="auto"
          onTimeUpdate={onTimeUpdate}
          onSeeked={onSeeked}
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
        <button className="trim-iconbtn" onClick={doDelete} disabled={!canDelete} title="Remove the section at the playhead (Del)"><Trash2 size={16} /></button>
        <button className="trim-iconbtn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="trim-iconbtn" onClick={redo} disabled={!redoStack.length} title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>
      </div>

      {probe && (
        <TrimTimeline
          clips={clips} duration={duration} playhead={playhead}
          selectedId={selectedId} onScrub={scrub}
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
