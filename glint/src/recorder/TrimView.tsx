/** TrimView.tsx — recording trim window (#/rec-trim): player + multi-cut timeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause, ZoomIn, ZoomOut, X, RotateCcw } from "lucide-react";
import { trimTarget, trimProbe, trimExport, trimWaveform, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, setSpeed, keepRanges, keptCount, keptSegments, outputDuration, type Clip } from "./trimModel";
import { TrimTimeline } from "./TrimTimeline";
import { TrimCamOverlay } from "./TrimCamOverlay";
import { type CamPlacement, DEFAULT_PLACEMENT, toPixels } from "./camOverlay";
import "./trim.css";

/** `<stem>.cam.webm` sibling of the recording — matches Rust `cam_sidecar_path`. */
const camSiblingPath = (p: string) => p.replace(/\.[^.\\/]+$/, ".cam.webm");

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

const EPS = 1e-4;
const ZOOMS = [1, 2, 4, 8];

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
  const [waveform, setWaveform] = useState<number[] | null>(null);
  // Which clip the speed/delete controls act on. STICKY: set on click, it stays put while
  // playback moves the playhead — so "set this section to 2×" hits the section you clicked,
  // not whatever the playhead has drifted onto.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1); // 1 | 2 | 4 | 8 — timeline magnification
  // Movable webcam overlay (only when the recording has a .cam.webm sidecar). Placement is
  // its own state — deliberately outside the clip undo/redo history.
  const [camSrc, setCamSrc] = useState<string | null>(null);
  const [cam, setCam] = useState<CamPlacement | null>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);

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
  // Latest clips/ranges for the rAF playback loop, so it reads current edits without
  // re-subscribing every frame.
  const clipsRef = useRef(clips); clipsRef.current = clips;
  const rangesRef = useRef(ranges); rangesRef.current = ranges;

  // Zoomed view window [viewStart, viewStart + duration/zoom], centred on the playhead so it
  // auto-follows during playback/stepping (no scrollbar needed). Frozen while dragging so the
  // timeline doesn't chase the cursor; viewStartRef holds the last settled value during a drag.
  const viewStartRef = useRef(0);
  const viewDur = duration / zoom;
  let viewStart: number;
  if (zoom <= 1) {
    viewStart = 0;
  } else if (draggingRef.current) {
    viewStart = viewStartRef.current;
  } else {
    viewStart = Math.min(Math.max(playhead - viewDur / 2, 0), Math.max(0, duration - viewDur));
    viewStartRef.current = viewStart;
  }
  const zoomIn = useCallback(() => setZoom((z) => ZOOMS[Math.min(ZOOMS.indexOf(z) + 1, ZOOMS.length - 1)] ?? z), []);
  const zoomOut = useCallback(() => setZoom((z) => ZOOMS[Math.max(ZOOMS.indexOf(z) - 1, 0)] ?? z), []);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05
    && clips.filter((c) => c.kept).every((c) => c.speed === 1) && fadeIn === 0 && fadeOut === 0;
  // A visible webcam overlay is itself an edit worth exporting, even with no cuts/speed/fades.
  const camEdit = !!(probe?.has_cam && cam?.visible);
  const canSave = clips.length > 0 && keptCount(clips) > 0 && (!noop || camEdit) && exporting === null;

  // The selected block: the clip clicked on the timeline (sticky). Falls back to none once
  // the id no longer exists (e.g. after undo/redo swaps in a different history state).
  const selected = clips.find((c) => c.id === selectedId) ?? null;
  const canDelete = selected != null && selected.kept && keptCount(clips) > 1 && exporting === null;
  // Pick the clip covering time `t` (any clip, kept or gap) — used to seat the sticky selection.
  const clipAt = useCallback(
    (t: number) => clips.find((c) => t >= c.start - EPS && t < c.end - EPS)
      ?? (t >= duration - EPS ? clips[clips.length - 1] : undefined),
    [clips, duration],
  );

  useEffect(() => {
    trimTarget().then(async (t) => {
      if (!t) { setErr("No recording to trim."); return; }
      setTarget(t);
      setSrc(convertFileSrc(t.path));
      try {
        const p = await trimProbe(t.path);
        setProbe(p);
        const clips0 = initClips(p.duration_secs);
        setEdit({ clips: clips0, fadeIn: 0, fadeOut: 0 });
        setSelectedId(clips0[0]?.id ?? null); // start with the whole clip selected
        if (p.has_audio) {
          // Extra buckets so zoomed-in detail resolves (at 8× ≈ 150 bars across the track).
          trimWaveform(t.path, 1200, p.duration_secs).then(setWaveform).catch(() => setWaveform(null));
        }
        if (p.has_cam) {
          setCamSrc(convertFileSrc(camSiblingPath(t.path)));
          setCam(DEFAULT_PLACEMENT);
        }
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
    const cv = camVideoRef.current; if (cv) { try { cv.currentTime = clamped; } catch { /* ignore */ } }
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
      const c = clipAt(clamped); // click seats the sticky selection
      setSelectedId(c ? c.id : null);
      const v = videoRef.current;
      if (v) {
        if (!v.paused) { v.pause(); setPlaying(false); }
        v.playbackRate = 1; // a paused seek previews at normal speed
      }
    }
    setPlayhead(clamped);
    applyVideoSeek(clamped);
    if (phase === "end") draggingRef.current = false;
  }, [duration, applyVideoSeek, clipAt]);

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
  const doSplit = useCallback(() => {
    const next = splitClips(clips, playhead);
    commit({ ...edit, clips: next });
    // Splitting replaces the parent with two fresh-id halves — reseat selection on the half
    // under the playhead so the sticky selection doesn't dangle on the vanished parent.
    const c = next.find((cc) => playhead >= cc.start - EPS && playhead < cc.end - EPS);
    if (c) setSelectedId(c.id);
  }, [commit, edit, clips, playhead]);
  const doDelete = useCallback(() => {
    if (!selected || !selected.kept || keptCount(clips) <= 1) return; // can't delete a gap or the last block
    commit({ ...edit, clips: setKept(clips, selected.id, false) });
  }, [commit, edit, clips, selected]);
  const SPEEDS = [0.5, 1, 1.5, 2];
  const selSpeed = selected?.speed ?? 1;
  const canSpeed = selected != null && selected.kept && exporting === null;
  const setSel = useCallback((k: number) => {
    if (selectedId == null) return;
    commit({ ...edit, clips: setSpeed(clips, selectedId, k) });
  }, [commit, edit, clips, selectedId]);
  const FADE_MAX = 2;
  const bump = (which: "fadeIn" | "fadeOut", delta: number) => {
    const cur = which === "fadeIn" ? fadeIn : fadeOut;
    const next = Math.max(0, Math.min(FADE_MAX, Math.round((cur + delta) * 2) / 2)); // 0.5s steps
    if (next === cur) return;
    commit({ ...edit, [which]: next });
  };
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

  // Playback engine: a rAF loop (~60 Hz) drives the playhead, skips removed gaps, and
  // switches playbackRate exactly at segment boundaries. Far tighter than the ~4 Hz
  // `timeupdate` event, which used to let a segment's speed bleed ~250 ms into its
  // neighbour ("other sections also get affected").
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !draggingRef.current) {
        let t = v.currentTime;
        const rs = rangesRef.current;
        const inKept = rs.some(([s, e]) => t >= s - 0.02 && t < e);
        if (!inKept) {
          const next = rs.find(([s]) => s > t);
          if (next) { v.currentTime = next[0]; t = next[0]; }
          else { v.pause(); }
        }
        const cur = clipsRef.current.find((c) => c.kept && t >= c.start - 0.02 && t < c.end);
        const rate = cur?.speed ?? 1;
        if (v.playbackRate !== rate) v.playbackRate = rate;
        // Slave the webcam overlay to the same time base (correct drift; match speed).
        const cv = camVideoRef.current;
        if (cv) {
          if (Math.abs(cv.currentTime - t) > 0.15) { try { cv.currentTime = t; } catch { /* ignore */ } }
          if (cv.playbackRate !== rate) cv.playbackRate = rate;
        }
        setPlayhead(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };

  // Keep the webcam overlay's play state mirrored to the main player (muted, so autoplay
  // is allowed). Time/rate are corrected in the rAF loop.
  useEffect(() => {
    const cv = camVideoRef.current; if (!cv) return;
    if (playing) cv.play().catch(() => {}); else cv.pause();
  }, [playing]);

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
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomIn(); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); }
      else if (e.key === "Escape") { requestClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSplit, doDelete, undo, redo, seek, playhead, fps, exporting, requestClose, zoomIn, zoomOut]);

  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0);
    // Bake the webcam overlay only when it's present and visible; else export as before.
    const useCam = probe.has_cam && !!cam?.visible;
    const camPath = useCam ? camSiblingPath(target.path) : null;
    const camOverlay = useCam && cam ? toPixels(cam, probe.width, probe.height) : null;
    trimExport(target.id, target.path, keptSegments(clips), probe.has_audio, duration, probe.width, probe.height, fadeIn, fadeOut, camPath, camOverlay, mode)
      .catch(() => setExporting(null)); // a toast already surfaced; window stays open
  };

  if (err) return <div className="trim-root"><div className="trim-error">{err}</div></div>;

  return (
    <div className="trim-root">
      <div className="trim-stage">
        {src && (
          <video
            ref={videoRef}
            className="trim-video"
            src={src}
            preload="auto"
            onSeeked={onSeeked}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {cam && camSrc && probe && (
          <TrimCamOverlay
            ref={camVideoRef}
            camSrc={camSrc}
            placement={cam}
            videoAspect={probe.height > 0 ? probe.width / probe.height : 16 / 9}
            onChange={setCam}
          />
        )}
      </div>

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
        <span className="trim-spacer" />
        <div className="trim-speedctl" role="group" aria-label="Segment speed">
          {SPEEDS.map((k) => (
            <button
              key={k}
              className={`trim-speedbtn${selSpeed === k ? " trim-speedbtn--on" : ""}`}
              disabled={!canSpeed}
              onClick={() => setSel(k)}
              title={`Play the selected section at ${k}×`}
            >{k}×</button>
          ))}
        </div>
      </div>

      {probe && (
        <TrimTimeline
          clips={clips} duration={duration} playhead={playhead}
          selectedId={selectedId} onScrub={scrub} waveform={waveform}
          zoom={zoom} viewStart={viewStart}
        />
      )}

      <div className="trim-actions">
        <span className="trim-out">Output: {fmt(outDur)} / {fmt(duration)}</span>
        <div className="trim-zoomctl" role="group" aria-label="Timeline zoom">
          <button className="trim-iconbtn" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out (−)"><ZoomOut size={16} /></button>
          <span className="trim-zoomval">{zoom}×</span>
          <button className="trim-iconbtn" onClick={zoomIn} disabled={zoom >= 8} title="Zoom in (+)"><ZoomIn size={16} /></button>
        </div>
        {probe?.has_cam && cam && (
          <div className="trim-camctl" role="group" aria-label="Webcam overlay">
            {cam.visible ? (
              <>
                <button className="trim-iconbtn" onClick={() => setCam(DEFAULT_PLACEMENT)} title="Reset webcam position & size"><RotateCcw size={15} /> Cam</button>
                <button className="trim-iconbtn" onClick={() => setCam((c) => (c ? { ...c, visible: false } : c))} title="Remove the webcam overlay"><X size={16} /></button>
              </>
            ) : (
              <button className="trim-iconbtn" onClick={() => setCam((c) => (c ? { ...c, visible: true } : DEFAULT_PLACEMENT))} title="Add the webcam overlay back">Add cam</button>
            )}
          </div>
        )}
        <div className="trim-fades">
          <FadeStepper label="Fade in" value={fadeIn} disabled={exporting !== null} onDelta={(d) => bump("fadeIn", d)} />
          <FadeStepper label="Fade out" value={fadeOut} disabled={exporting !== null} onDelta={(d) => bump("fadeOut", d)} />
        </div>
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

function FadeStepper({ label, value, disabled, onDelta }: {
  label: string; value: number; disabled: boolean; onDelta: (d: number) => void;
}) {
  return (
    <div className="trim-fade" title={`${label} (0–2s)`}>
      <span className="trim-fade-label">{label}</span>
      <button className="trim-fade-btn" disabled={disabled || value <= 0} onClick={() => onDelta(-0.5)}>−</button>
      <span className="trim-fade-val">{value === 0 ? "off" : `${value}s`}</span>
      <button className="trim-fade-btn" disabled={disabled || value >= 2} onClick={() => onDelta(0.5)}>+</button>
    </div>
  );
}
