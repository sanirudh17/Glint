import { WindowControls } from "../components/Titlebar";
import { StudioPanel } from "./StudioPanel";
import {EditorCommands} from './EditorCommands';
import {prepareCaptions,estimateExportBytes} from './studioPolish';
import {studioLayout} from './studioLayout';
import {useAppStore} from '../store/useAppStore';
import {GifExportControls,type GifOptions} from './GifExportControls';
import { StudioEffectTrack } from "./StudioEffectTrack";
import { StudioMaskOverlay } from "./StudioMaskOverlay";
import { newMask,setMaskKeyframe } from "./studioMasks";
import {setZoomFocus,type FocusPoint} from './studioFocus';
import {smoothPath,followSourcePoint} from './studioCursor';
import "../look/look.css";
import { StudioPreview } from "./StudioPreview";
import { studioLoad, studioImport, studioSave, studioExport, studioExportCancel,studioDiscardSource } from "../lib/studio";
import {confirm} from '@tauri-apps/plugin-dialog';
import { hydrateProject, type StudioData, type StudioProject } from "./studioModel";
/** TrimView.tsx — recording trim window (#/rec-trim): player + multi-cut timeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc,invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Scissors, Trash2, Undo2, Redo2, Play, Pause, SkipBack, ZoomIn, ZoomOut, X, RotateCcw } from "lucide-react";
import { trimTarget, trimProbe, trimExport, trimWaveform, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, setSpeed, keepRanges, keptCount, keptSegments, reorderKept, segmentIndexAtSource, outputDuration, type Clip } from "./trimModel";
import { TrimTimeline } from "./TrimTimeline";
import { TrimFilmstrip } from "./TrimFilmstrip";
import { TrimCamOverlay } from "./TrimCamOverlay";
import { type CamPlacement, type CamShape, DEFAULT_PLACEMENT, toPixels, clampPlacement } from "./camOverlay";

/** Cycle order for the webcam shape control. */
const CAM_SHAPES: CamShape[] = ["circle", "rounded", "square", "rect"];
const nextShape = (s: CamShape): CamShape => CAM_SHAPES[(CAM_SHAPES.indexOf(s) + 1) % CAM_SHAPES.length];
const SHAPE_LABEL: Record<CamShape, string> = { circle: "Circle", rounded: "Rounded", square: "Square", rect: "Rectangle" };
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
  const [selectedZoom,setSelectedZoom]=useState<string|null>(null);
  const [pickingFocus,setPickingFocus]=useState(false);
  const [focusAim,setFocusAim]=useState<FocusPoint|null>(null);
  const [selectedMask,setSelectedMask]=useState<string|null>(null);
  const [drawingMask,setDrawingMask]=useState(false);
  const [studio, setStudio] = useState<StudioData | null>(null);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const autosaveRef = useRef<{ path: string; project: StudioProject } | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const loadGeneration = useRef(0);
  const flushSave = useCallback(() => {
    const pending = autosaveRef.current; if (!pending) return Promise.resolve();
    autosaveRef.current = null;
    setSaveStatus("Saving…");
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => studioSave(pending.path, pending.project))
      .then(() => { setSaveStatus("Saved"); }).catch((error) => { autosaveRef.current = autosaveRef.current ?? pending; setSaveStatus(`Save failed: ${String(error)}`); });
    return saveQueueRef.current;
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [target, setTarget] = useState<{ id: number; path: string } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // First-paint gate: the window opens instantly, but its contents stay hidden
  // until the video's first frame is actually decodable (onCanPlay). Without this
  // the chrome/timeline/waveform pop in BEFORE the video on a cold first open,
  // which reads as "loads the visualizer and then the video". Everything then
  // appears together, once. A safety timeout covers pathological media that never
  // reaches canplay so the UI can never stay hidden.
  const [mediaReady, setMediaReady] = useState(false);
  type EditState = { clips: Clip[]; fadeIn: number; fadeOut: number; action?:string };
  const [edit, setEdit] = useState<EditState>({ clips: [], fadeIn: 0, fadeOut: 0 });
  const [undoStack, setUndoStack] = useState<EditState[]>([]);
  const [redoStack, setRedoStack] = useState<EditState[]>([]);
  const { clips, fadeIn, fadeOut } = edit;
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null); // percent or null
  const [exportingGif,setExportingGif]=useState(false);
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
  const selectedZoomMode=studio?.project.zoomSegments.find(s=>s.id===selectedZoom)?.mode;
  useEffect(()=>{setPickingFocus(false);setFocusAim(null);},[selectedZoom,selectedZoomMode,target?.path,playhead]);
  useEffect(()=>{
    if(!pickingFocus)return;
    const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setPickingFocus(false);setFocusAim(null);}};
    window.addEventListener('keydown',cancel,true);return()=>window.removeEventListener('keydown',cancel,true);
  },[pickingFocus]);
  const fps = probe?.fps && probe.fps > 0 ? probe.fps : 30;
  const ranges = keepRanges(clips);
  const outDur = outputDuration(clips);
  // Latest clips for the rAF playback loop, so it reads current edits (and their play order)
  // without re-subscribing every frame.
  const clipsRef = useRef(clips); clipsRef.current = clips;

  // Zoomed view window [viewStart, viewStart + duration/zoom], centred on the playhead so it
  // auto-follows during playback/stepping (no scrollbar needed). Frozen while dragging so the
  // timeline doesn't chase the cursor; viewStartRef holds the last settled value during a drag.
  const viewStartRef = useRef(0);
  // Which play-order segment the preview is currently in (index into keptSegments).
  const segCursorRef = useRef(0);
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
  // Reordered when the kept clips no longer play in ascending source-time order — this is a
  // real edit even with no cuts/speed/fades (keepRanges merges by source time and would miss it).
  const orderedSegs = keptSegments(clips);
  const reordered = orderedSegs.some((s, i) => i > 0 && s.start < orderedSegs[i - 1].start - EPS);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05
    && clips.filter((c) => c.kept).every((c) => c.speed === 1) && fadeIn === 0 && fadeOut === 0
    && !reordered;
  // A visible webcam overlay is itself an edit worth exporting, even with no cuts/speed/fades.
  const camEdit = !!(probe?.has_cam && cam?.visible);
  // Any real edit (cuts / speed / fades / reorder / cam) — gates both Save and the
  // "play from start" affordance, which is pointless with nothing changed.
  const hasEdit = !noop || camEdit || studio !== null;
  const canSave = clips.length > 0 && keptCount(clips) > 0 && hasEdit && exporting === null;

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

  // Load (or reload) the trim target. Runs on mount AND on `rec-trim-reload` — the
  // Load (or reload) the trim target. Runs on mount AND on `rec-trim-reload` — the
  // window is pre-warmed hidden at startup and REUSED across opens, so Rust retargets
  // RecorderTrimState and emits this event instead of rebuilding the webview. Each run
  // resets the full edit state for the new recording.
  const loadTarget = useCallback(() => {
    void flushSave();
    const generation = ++loadGeneration.current;
    setStudio(null); setExportMessage(null);
    setSelectedZoom(null);setPickingFocus(false);
    setSelectedMask(null);setDrawingMask(false);
    setUndoStack([]); setRedoStack([]); setPlayhead(0); setPlaying(false);
    setSrc(null);
    setTarget(null);
    setProbe(null);
    setWaveform(null);
    setCam(null);
    setCamSrc(null);
    setErr(null);
    setExporting(null);
    setMediaReady(false);
    setEdit({ clips: [], fadeIn: 0, fadeOut: 0 });
    trimTarget().then(async (t) => {
      if (!t || generation !== loadGeneration.current) { return; }
      setTarget(t);
      setSrc(convertFileSrc(t.path));
      try {
        const p = await trimProbe(t.path);
        const data = await studioLoad(t.path) ?? await studioImport(t.path);
        if (generation !== loadGeneration.current) return;
        const project = data ? hydrateProject(data.project, p.duration_secs, data.events, p) : null;
        if (data && project) setStudio({ ...data, project });
        setProbe(p);
        const clips0 = project?.clips ?? initClips(p.duration_secs);
        setEdit({ clips: clips0, fadeIn: project?.fadeIn ?? 0, fadeOut: project?.fadeOut ?? 0 });
        setSelectedId(clips0[0]?.id ?? null); // start with the whole clip selected
        if (p.has_audio) {
          // Extra buckets so zoomed-in detail resolves (at 8× ≈ 150 bars across the track).
          trimWaveform(t.path, 1200, p.duration_secs).then(setWaveform).catch(() => setWaveform(null));
        }
        if (p.has_cam) {
          setCamSrc(convertFileSrc(camSiblingPath(t.path)));
          // Start the overlay where the webcam actually was during recording (same size +
          // above-taskbar position); fall back to the default for older recordings.
          const shape = (CAM_SHAPES.includes(p.cam_shape as CamShape) ? p.cam_shape : "circle") as CamShape;
          const placed = p.cam_d > 0
            ? clampPlacement({ x: p.cam_x, y: p.cam_y, diameter: p.cam_d, visible: true, shape })
            : { ...DEFAULT_PLACEMENT, shape };
          setCam(project?.cam ?? placed);
        }
      } catch (error) { if (generation === loadGeneration.current) setErr(`Couldn't read the recording: ${String(error)}`); }
    }).catch(() => { if (generation === loadGeneration.current) setErr("Couldn't open the recording."); });
  }, [flushSave]);

  useEffect(() => {
    void loadTarget();
  }, [loadTarget]);

  useEffect(() => { void getCurrentWindow().setTitle(studio ? "Glint Studio" : "Glint — Trim recording").catch(() => {}); }, [studio !== null]);

  // Safety valve: if the video never reaches canplay (corrupt file edge cases),
  // reveal the UI anyway after a grace period so it can't stay blank.
  useEffect(() => {
    if (mediaReady) return;
    const t = window.setTimeout(() => setMediaReady(true), 3000);
    return () => window.clearTimeout(t);
  }, [mediaReady]);

  // Reopen path: the window already exists (pre-warmed / previously opened), so Rust
  // re-stashes the target and asks us to reload it in place — instant, no rebuild.
  useEffect(() => {
    const un = listen("rec-trim-reload", () => { void loadTarget(); });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [loadTarget]);

  // When closed/hidden, wipe previous video and media state from DOM buffer.
  useEffect(() => {
    const un = listen("rec-trim-close", () => {
      void flushSave(); ++loadGeneration.current;
      setStudio(null);
      setSrc(null);
      setTarget(null);
      setProbe(null);
      setWaveform(null);
      setCam(null);
      setCamSrc(null);
      setMediaReady(false);
      setEdit({ clips: [], fadeIn: 0, fadeOut: 0 });
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (!studio || !target || !edit.clips.length) return;
    const project = { ...studio.project, ...edit, cam };
    autosaveRef.current = { path: target.path, project };
    setSaveStatus("Unsaved");
    const timeout = window.setTimeout(() => { void flushSave(); }, 350);
    return () => window.clearTimeout(timeout);
  }, [studio, target, edit, cam, flushSave]);
  useEffect(() => () => { void flushSave(); }, [flushSave]);

  useEffect(() => {
    const un = listen<number>("rec-trim-progress", (e) => setExporting(current =>
      current === null || !Number.isFinite(e.payload) ? current : Math.max(current,Math.min(99,Math.round(e.payload)))));
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

  const commit = useCallback((next: EditState, action='Change timing') => {
    setUndoStack((s) => [...s.slice(-29), {...edit,action}]);
    setRedoStack([]);
    setEdit(next);
  }, [edit]);
  const doSplit = useCallback(() => {
    const next = splitClips(clips, playhead);
    commit({ ...edit, clips: next },'Split clip');
    // Splitting replaces the parent with two fresh-id halves — reseat selection on the half
    // under the playhead so the sticky selection doesn't dangle on the vanished parent.
    const c = next.find((cc) => playhead >= cc.start - EPS && playhead < cc.end - EPS);
    if (c) setSelectedId(c.id);
  }, [commit, edit, clips, playhead]);
  const doDelete = useCallback(() => {
    if (!selected || !selected.kept || keptCount(clips) <= 1) return; // can't delete a gap or the last block
    commit({ ...edit, clips: setKept(clips, selected.id, false) },'Remove clip');
  }, [commit, edit, clips, selected]);
  const doReorder = useCallback((from: number, to: number) => {
    const next = reorderKept(clips, from, to);
    if (next !== clips) commit({ ...edit, clips: next },'Reorder clips');
  }, [commit, edit, clips]);
  // Clicking a filmstrip tile seats the sticky timeline selection on that clip (so the speed
  // buttons/keys act on it) and jumps the playhead there for a clear visual indication.
  const selectClip = useCallback((id: number) => {
    setSelectedId(id);
    const c = clips.find((x) => x.id === id);
    if (c) seek(c.start);
  }, [clips, seek]);
  const SPEEDS = [0.5, 1, 1.5, 2];
  const selSpeed = selected?.speed ?? 1;
  const canSpeed = selected != null && selected.kept && exporting === null;
  const setSel = useCallback((k: number) => {
    if (selectedId == null) return;
    commit({ ...edit, clips: setSpeed(clips, selectedId, k) },'Change clip speed');
  }, [commit, edit, clips, selectedId]);
  const FADE_MAX = 2;
  const bump = (which: "fadeIn" | "fadeOut", delta: number) => {
    const cur = which === "fadeIn" ? fadeIn : fadeOut;
    const next = Math.max(0, Math.min(FADE_MAX, Math.round((cur + delta) * 2) / 2)); // 0.5s steps
    if (next === cur) return;
    commit({ ...edit, [which]: next },which==='fadeIn'?'Change fade in':'Change fade out');
  };
  const undo = useCallback(() => {
    const last=undoStack[undoStack.length-1];if(!last)return;const {action,...previous}=last;
    setRedoStack(r=>[...r,{...edit,action}]);setEdit(previous);setUndoStack(s=>s.slice(0,-1));useAppStore.getState().pushToast(`Undid: ${action??'Change timing'}`);
  }, [edit,undoStack]);
  const redo = useCallback(() => {
    const last=redoStack[redoStack.length-1];if(!last)return;const {action,...next}=last;
    setUndoStack(u=>[...u,{...edit,action}]);setEdit(next);setRedoStack(r=>r.slice(0,-1));useAppStore.getState().pushToast(`Redid: ${action??'Change timing'}`);
  }, [edit,redoStack]);

  // Playback engine: a rAF loop (~60 Hz) walks the KEPT segments in PLAY order. Within a
  // segment the <video> plays naturally; at a segment boundary it seeks to the next segment's
  // source start (covers reordered jumps and deleted gaps uniformly) and switches playbackRate.
  // Far tighter than the ~4 Hz `timeupdate` event, which used to let a segment's speed bleed
  // ~250 ms into its neighbour ("other sections also get affected").
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !draggingRef.current) {
        const segs = keptSegments(clipsRef.current); // play order
        if (segs.length === 0) { v.pause(); setPlaying(false); return; }
        let idx = segCursorRef.current;
        if (idx < 0 || idx >= segs.length) idx = 0;
        let seg = segs[idx];
        let t = v.currentTime;
        // Reached the end of this segment's SOURCE span → advance to the next play-order segment.
        if (t >= seg.end - 0.02) {
          if (idx + 1 >= segs.length) { v.pause(); setPlaying(false); raf = requestAnimationFrame(tick); return; }
          idx += 1;
          segCursorRef.current = idx;
          seg = segs[idx];
          try { v.currentTime = seg.start; } catch { /* ignore */ }
          t = seg.start;
        }
        const rate = seg.speed;
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

  // Seat the play-order cursor from the current source position when playback starts, so Play
  // resumes from the segment under the playhead (or the first segment if it's in a gap).
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      const segs = keptSegments(clipsRef.current);
      if (segs.length === 0) return;
      let idx = segmentIndexAtSource(segs, v.currentTime);
      if (idx < 0) { idx = 0; try { v.currentTime = segs[0].start; } catch { /* ignore */ } }
      segCursorRef.current = idx;
      v.play(); setPlaying(true);
    } else { v.pause(); setPlaying(false); }
  };

  // Play the whole reordered flow from the very first segment (in play order), so the user can
  // preview the updated sequence start-to-finish instead of resuming mid-way from the playhead.
  const playFromStart = () => {
    const v = videoRef.current; if (!v) return;
    const segs = keptSegments(clipsRef.current);
    if (segs.length === 0) return;
    segCursorRef.current = 0;
    try { v.currentTime = segs[0].start; } catch { /* ignore */ }
    setPlayhead(segs[0].start);
    v.play(); setPlaying(true);
  };

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
    if (studio) { void flushSave().then(() => { if (!autosaveRef.current) void getCurrentWindow().close(); }); return; }
    if (undoStack.length > 0 && !window.confirm("Discard your trim edits?")) return;
    getCurrentWindow().close().catch(() => {});
  }, [exporting, undoStack.length, studio, flushSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.closest("[data-editor-control]"))) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (exporting !== null) return; // export is modal — ignore edit/transport keys
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void flushSave();return;}
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

  const saveGif=async(options:GifOptions)=>{
    if(!target||!probe||exporting!==null)return;
    setExporting(0);setExportingGif(true);setExportMessage(null);
    try{
      await flushSave();
      const camOverlay=probe.has_cam&&cam?.visible?{...toPixels(cam,probe.width,probe.height,probe.width/probe.height),shape:cam.shape}:null;
      const path=await invoke<string>('recorder_gif_export',{path:target.path,project:studio?await prepareCaptions({...studio.project,...edit,cam}):null,segments:keptSegments(clips),fadeIn,fadeOut,camOverlay,options});
      setExportMessage(`Exported: ${path}`);
    }catch(error){setExportMessage(String(error));}finally{setExporting(null);setExportingGif(false);}
  };
  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0); setExportMessage(null);
    if (studio) {
      const project = { ...studio.project, ...edit, cam };
      void flushSave().then(() => prepareCaptions(project)).then(project=>studioExport(target.path, project)).then(async(path) => {
        setExportMessage(`Exported: ${path}`);
        if(project.deleteSourceAfterExport&&await confirm('Your exported MP4 is saved. Delete the unmasked recording, camera track and input events? The original recording cannot be restored.',{title:'Delete unmasked source?',kind:'warning',okLabel:'Delete source',cancelLabel:'Keep source'})) {
          videoRef.current?.pause();videoRef.current?.removeAttribute('src');videoRef.current?.load();
          camVideoRef.current?.pause();camVideoRef.current?.removeAttribute('src');camVideoRef.current?.load();
          await studioDiscardSource(target.path,path);await getCurrentWindow().close();
        }
      })
        .catch((error) => setExportMessage(String(error))).finally(() => setExporting(null));
      return;
    }
    // Bake the webcam overlay only when it's present and visible; else export as before.
    const useCam = probe.has_cam && !!cam?.visible;
    const camPath = useCam ? camSiblingPath(target.path) : null;
    const camAspect = probe.height > 0 ? probe.width / probe.height : 16 / 9;
    const camOverlay = useCam && cam ? { ...toPixels(cam, probe.width, probe.height, camAspect), shape: cam.shape } : null;
    trimExport(target.id, target.path, keptSegments(clips), probe.has_audio, duration, probe.width, probe.height, fadeIn, fadeOut, camPath, camOverlay, mode)
      .catch(() => setExporting(null)); // a toast already surfaced; window stays open
  };

  if (err) return <div className="trim-root"><div className="trim-error">{err}</div></div>;

  // Contents stay mounted (the <video> must be in the DOM to load/decode) but
  // invisible until its first frame is ready — then everything appears together.
  const booting = !mediaReady;
  const outputSize=probe&&studio?studioLayout(probe.width,probe.height,studio.project.crop,studio.project.look):probe;
  const estimated=outputSize?estimateExportBytes(outDur,outputSize.width,outputSize.height):null;

  return (
    <div className={`trim-root${booting ? " is-booting" : ""}`}>
      <EditorCommands actions={[
        {id:'play',label:playing?'Pause playback':'Play video',run:togglePlay,disabled:exporting!==null},
        {id:'split',label:'Split clip at playhead',run:doSplit,disabled:exporting!==null},
        {id:'delete',label:'Remove selected clip',run:doDelete,disabled:!canDelete},
        {id:'undo',label:`Undo ${undoStack[undoStack.length-1]?.action??'timing edit'}`,run:undo,disabled:!undoStack.length||exporting!==null},
        {id:'redo',label:`Redo ${redoStack[redoStack.length-1]?.action??'timing edit'}`,run:redo,disabled:!redoStack.length||exporting!==null},
        {id:'save',label:'Save Studio project',run:()=>void flushSave(),disabled:!studio||exporting!==null},
        {id:'export',label:'Export MP4',run:()=>save('copy'),disabled:!canSave},
        {id:'notes',label:'Open speaker notes',run:()=>void invoke('studio_speaker_notes').catch(e=>setExportMessage(String(e)))},
        {id:'close',label:'Close editor',run:requestClose,disabled:exporting!==null},
      ]}/>
      {!studio && <div className="trim-window-toolbar" data-tauri-drag-region>
        <span className="trim-window-context">Trim recording</span>
        <WindowControls onClose={requestClose} />
      </div>}
      <div className="trim-preview-row">
      <div className={`trim-stage${studio ? " studio-stage" : ""}`}>
        {studio && probe && <StudioPreview studio={studio} video={videoRef} camVideo={camVideoRef} cam={cam} width={probe.width} height={probe.height} pickingFocus={pickingFocus}
          onAim={setFocusAim} onFocus={focus=>{
            const t=videoRef.current?.currentTime??playhead;
            setStudio(data=>{if(!data)return data;const cursor=followSourcePoint(smoothPath(data.events.events,data.project.cursor.smoothing),t,data.events,probe.width,probe.height);
              return {...data,project:{...data.project,zoomSegments:data.project.zoomSegments.map(s=>s.id===selectedZoom?setZoomFocus(s,focus,cursor,probe.width,probe.height):s)}};});setPickingFocus(false);setFocusAim(null);
          }} />}
        {studio&&probe&&<StudioMaskOverlay studio={studio} width={probe.width} height={probe.height} time={playhead} selected={selectedMask} drawing={drawingMask} video={videoRef}
          onPause={()=>{videoRef.current?.pause();setPlaying(false);}}
          onDraw={rect=>{const mask=newMask(rect,playhead,duration);setStudio(data=>data&&({...data,project:{...data.project,masks:[...data.project.masks,mask]}}));setSelectedMask(mask.id);setDrawingMask(false);}}
          onRect={rect=>setStudio(data=>data&&({...data,project:{...data.project,masks:data.project.masks.map(m=>m.id===selectedMask?setMaskKeyframe(m,rect,playhead):m)}}))}/>}
        {src && (
          <video
            ref={videoRef}
            className="trim-video"
            src={src}
            preload="auto"
            onLoadedData={() => setMediaReady(true)}
            onLoadedMetadata={() => setMediaReady(true)}
            onCanPlay={() => setMediaReady(true)}
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

      {studio && probe && target && <StudioPanel onClose={requestClose} project={{...studio.project,...edit}} path={target.path} width={probe.width} height={probe.height}
        time={playhead} duration={duration} events={studio.events} selectedZoom={selectedZoom} onSelectZoom={setSelectedZoom} focusAim={focusAim} pickingFocus={pickingFocus} onPickZoom={()=>{videoRef.current?.pause();setPlaying(false);setSelectedMask(null);setDrawingMask(false);setFocusAim(null);setPickingFocus(value=>!value);}}
        selectedMask={selectedMask} onSelectMask={setSelectedMask} drawingMask={drawingMask} onDrawMask={()=>{videoRef.current?.pause();setPickingFocus(false);setSelectedMask(null);setDrawingMask(value=>!value);}} onSeek={time=>{scrub(time,'start');scrub(time,'end');}}
        saveStatus={saveStatus} exportMessage={exportMessage} exporting={exporting !== null} cam={cam} onCamChange={setCam}
        onChange={(patch,action) => {if(patch.clips)commit({...edit,clips:patch.clips},action);if(patch.zoomSegments){setPickingFocus(false);setFocusAim(null);}setStudio((data) => data && ({ ...data, project: { ...data.project, ...patch } }));}}
        onSave={() => void flushSave()} />}

      </div>
      <div className="trim-transport">
        <button className="trim-iconbtn" onClick={togglePlay} title="Play/Pause (Space)">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        {hasEdit && (
          <button className="trim-iconbtn" onClick={playFromStart} title="Play the updated sequence from the start">
            <SkipBack size={16} />
          </button>
        )}
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

      {studio&&probe&&<StudioEffectTrack label="Zoom" segments={studio.project.zoomSegments} duration={duration} zoom={zoom} viewStart={viewStart} selected={selectedZoom} disabled={exporting!==null}
        onSelect={setSelectedZoom} onDelete={id=>setStudio(data=>data&&({...data,project:{...data.project,zoomSegments:data.project.zoomSegments.filter(s=>s.id!==id)}}))}
        onRange={(id,start,end)=>setStudio(data=>data&&({...data,project:{...data.project,zoomSegments:data.project.zoomSegments.map(s=>s.id===id?{...s,start,end,edited:true,transitionStart:undefined,transitionEnd:undefined}:s)}}))}/>}
      {studio&&probe&&<StudioEffectTrack label="Masks" segments={studio.project.masks} duration={duration} zoom={zoom} viewStart={viewStart} selected={selectedMask} disabled={exporting!==null}
        onSelect={setSelectedMask} onDelete={id=>setStudio(data=>data&&({...data,project:{...data.project,masks:data.project.masks.filter(m=>m.id!==id)}}))}
        onRange={(id,start,end)=>setStudio(data=>data&&({...data,project:{...data.project,masks:data.project.masks.map(m=>m.id===id?{...m,start,end}:m)}}))}/>}

      <TrimFilmstrip clips={clips} disabled={exporting !== null} selectedId={selectedId} onReorder={doReorder} onSelect={selectClip} />

      <GifExportControls disabled={exporting!==null||!probe||keptCount(clips)===0} duration={outDur} onExport={options=>void saveGif(options)}/>
      <div className="trim-actions">
        <span className="trim-out">Output: {fmt(outDur)} / {fmt(duration)}{estimated&&<span className="trim-export-estimate" title="Approximate MP4 size; actual size depends on the content."> · ≈ {(estimated.low/1048576).toFixed(1)}–{(estimated.high/1048576).toFixed(1)} MiB</span>}</span>
        <div className="trim-zoomctl" role="group" aria-label="Timeline zoom">
          <button className="trim-zoombtn" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out (−)"><ZoomOut size={13} /></button>
          <span className="trim-zoomval">{zoom}×</span>
          <button className="trim-zoombtn" onClick={zoomIn} disabled={zoom >= 8} title="Zoom in (+)"><ZoomIn size={13} /></button>
        </div>
        {probe?.has_cam && cam && (
          <div className="trim-camctl" role="group" aria-label="Webcam overlay">
            {cam.visible ? (
              <>
                <button className="trim-iconbtn" onClick={() => setCam((c) => (c ? { ...c, shape: nextShape(c.shape) } : c))} title="Change the webcam shape">{SHAPE_LABEL[cam.shape]}</button>
                <button className="trim-iconbtn" onClick={() => setCam((c) => (c ? { ...DEFAULT_PLACEMENT, shape: c.shape } : c))} title="Reset webcam position & size"><RotateCcw size={15} /> Cam</button>
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
          <><div className="trim-progress"><div className="trim-progress-fill" style={{ width: `${exporting}%` }} /><span>{exporting>=99?'Finishing export…':`Exporting… ${exporting}%`}</span></div>{(studio||exportingGif)&&<button className="trim-btn" onClick={() => void studioExportCancel()}>Cancel export</button>}</>
        ) : (
          <div className="trim-save-actions">
            <button className="trim-btn" onClick={requestClose}>Cancel</button>
            {!studio && <button className="trim-btn" disabled={!canSave} onClick={() => save("overwrite")}>Overwrite</button>}
            <button className="trim-btn trim-btn--primary" disabled={!canSave} onClick={() => save("copy")}>{studio ? "Export MP4" : "Save copy"}</button>
          </div>
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
