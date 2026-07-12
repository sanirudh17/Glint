import { create } from "zustand";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  duplicateAnnotation,
  nudgeAnnotation,
  reorder,
  DEFAULT_STYLE,
  type Annotation,
  type Style,
  type ToolId,
} from "./model";
import type { Crop } from "./composition";
import { GRADIENTS } from "./gradients";
import { loadToolStyles, saveToolStyles } from "./toolStylePersistence";

/** Non-serializable base image for the live session (5c persists annotations only). */
export interface EditorBase {
  image: HTMLImageElement;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
}

export type FrameBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; gradientId: string }
  | { type: "transparent" };

export interface WindowChrome {
  style: "none" | "window" | "browser";
  theme: "light" | "dark";
  /** Decorative window-control buttons: macOS traffic lights (left) or Windows
      caption buttons (right). Applies to both Window and Browser styles. */
  buttons: "none" | "mac" | "windows";
  /** Centered title text (Window style). Empty → no title drawn. */
  title: string;
  /** Address-bar text (Browser style). Empty → empty pill. */
  url: string;
}

export interface FrameConfig {
  enabled: boolean;
  background: FrameBackground;
  padding: number;
  radius: number;
  shadow: number;
  aspect: "auto" | "1:1" | "16:9" | "4:3";
  chrome: WindowChrome;
}

/** One step of undo/redo history: annotations + the structural crop + the frame together. */
interface DocSnapshot { annotations: Annotation[]; crop: Crop | null; frame: FrameConfig }

/** The serializable editor document persisted to / loaded from a `.glint` file. */
export interface SerializedDoc {
  annotations: Annotation[];
  crop: Crop | null;
  frame: FrameConfig;
}

export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  background: { type: "gradient", gradientId: GRADIENTS[0].id },
  padding: 40,
  radius: 12,
  shadow: 35,
  aspect: "auto",
  chrome: { style: "none", theme: "light", buttons: "mac", title: "", url: "" },
};

interface EditorState {
  base: EditorBase | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: ToolId;
  style: Style;
  /** Per-tool remembered style so picking a red arrow doesn't recolor the next rect. */
  toolStyles: Partial<Record<ToolId, Style>>;
  crop: Crop | null;
  frame: FrameConfig;
  past: DocSnapshot[];
  future: DocSnapshot[];
  projectPath: string | null;
  projectName: string | null;
  dirty: boolean;
  /** Eraser footprint radius in image px (tool setting, not part of the doc). */
  eraserSize: number;
  /** Eyedropper pick mode: the next canvas click samples a pixel color. */
  picking: boolean;

  setBase: (b: EditorBase) => void;
  loadDoc: (
    base: EditorBase,
    doc: SerializedDoc | null,
    project: { path: string; name: string } | null,
  ) => void;
  markSaved: (path: string, name: string) => void;
  reset: () => void;
  setTool: (t: ToolId) => void;
  setStyle: (patch: Partial<Style>) => void;
  /** Set the shared spotlight dim on ALL spotlight annotations at once (the dim is
      one property of the whole effect since they share a single overlay). */
  setSpotlightDim: (v: number) => void;
  select: (id: string | null) => void;
  duplicate: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  /** Shift the annotation by (dx,dy). `pushHist` (default true) coalesces a burst
      of rapid nudges into a single undo step when the caller passes false. */
  nudge: (id: string, dx: number, dy: number, pushHist?: boolean) => void;
  pushHistory: () => void;
  add: (a: Annotation) => void;
  /** Discard a just-started draft (a click without a real drag) AND the history
      entry that onDown pushed for it, so a degenerate ~0-size shape leaves no trace
      and no wasted undo step. Critical for spotlights: a 0×0 spotlight dims the whole
      canvas with no bright hole and can't be clicked to delete (its hit area is 0×0),
      which is what made the dim look permanently "stuck". */
  discardDraft: (id: string) => void;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  /** Replace the whole annotation list in one shot (used by the eraser, which
      can split/drop several strokes per dab). Marks the doc dirty. */
  setAnnotations: (list: Annotation[]) => void;
  setEraserSize: (n: number) => void;
  setPicking: (v: boolean) => void;
  clearAll: () => void;
  setCrop: (c: Crop) => void;
  resetCrop: () => void;
  setFrame: (patch: Partial<FrameConfig>) => void;
  setChrome: (patch: Partial<WindowChrome>) => void;
  toggleFrame: (on?: boolean) => void;
  resetFrame: () => void;
  undo: () => void;
  redo: () => void;
}

/** Fresh frame config with nested background + chrome cloned (so resets never share refs). */
const freshFrame = (): FrameConfig => ({
  ...DEFAULT_FRAME,
  background: { ...DEFAULT_FRAME.background },
  chrome: { ...DEFAULT_FRAME.chrome },
});

/** Merge a loaded frame over defaults so a partial/legacy doc still hydrates safely. */
const mergeFrame = (f: FrameConfig | undefined): FrameConfig =>
  f
    ? {
        ...DEFAULT_FRAME,
        ...f,
        background: f.background ? { ...f.background } : { ...DEFAULT_FRAME.background },
        chrome: { ...DEFAULT_FRAME.chrome, ...(f.chrome ?? {}) },
      }
    : freshFrame();

const INITIAL = {
  base: null as EditorBase | null,
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  tool: "select" as ToolId,
  style: { ...DEFAULT_STYLE },
  toolStyles: loadToolStyles(),
  crop: null as Crop | null,
  frame: freshFrame(),
  past: [] as DocSnapshot[],
  future: [] as DocSnapshot[],
  projectPath: null as string | null,
  projectName: null as string | null,
  dirty: false,
  eraserSize: 16,
  picking: false,
};

/** The full reversible doc state for one undo/redo step (annotations + crop + frame). */
const snapshot = (s: EditorState): DocSnapshot => ({
  annotations: s.annotations,
  crop: s.crop,
  frame: s.frame,
});

export const useEditorStore = create<EditorState>((set) => ({
  ...INITIAL,
  style: { ...DEFAULT_STYLE },

  setBase: (b) => set({ base: b }),

  loadDoc: (base, doc, project) =>
    set({
      base,
      annotations: doc?.annotations ?? [],
      crop: doc?.crop ?? null,
      frame: mergeFrame(doc?.frame),
      picking: false,
      past: [],
      future: [],
      selectedId: null,
      projectPath: project?.path ?? null,
      projectName: project?.name ?? null,
      dirty: false,
    }),

  markSaved: (path, name) => set({ projectPath: path, projectName: name, dirty: false }),

  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE }, toolStyles: loadToolStyles(), frame: freshFrame() }),
  setTool: (t) =>
    set((s) => ({ tool: t, selectedId: null, style: s.toolStyles[t] ?? { ...DEFAULT_STYLE }, picking: false })),
  setStyle: (patch) =>
    set((s) => {
      const style = { ...s.style, ...patch };
      const toolStyles = { ...s.toolStyles, [s.tool]: style };
      saveToolStyles(toolStyles);
      return { style, toolStyles };
    }),
  setSpotlightDim: (v) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.type === "spotlight" ? { ...a, style: { ...a.style, fillOpacity: v } } : a,
      ),
      dirty: true,
    })),
  select: (id) => set({ selectedId: id }),
  duplicate: (id) =>
    set((s) => {
      const a = s.annotations.find((x) => x.id === id);
      if (!a) return s;
      const copy = duplicateAnnotation(a);
      return {
        past: [...s.past, snapshot(s)],
        future: [],
        annotations: [...s.annotations, copy],
        selectedId: copy.id,
        dirty: true,
      };
    }),
  bringForward: (id) =>
    set((s) => {
      const next = reorder(s.annotations, id, "forward");
      return next === s.annotations
        ? s
        : { past: [...s.past, snapshot(s)], future: [], annotations: next, dirty: true };
    }),
  sendBackward: (id) =>
    set((s) => {
      const next = reorder(s.annotations, id, "backward");
      return next === s.annotations
        ? s
        : { past: [...s.past, snapshot(s)], future: [], annotations: next, dirty: true };
    }),
  nudge: (id, dx, dy, pushHist = true) =>
    set((s) => {
      const idx = s.annotations.findIndex((x) => x.id === id);
      if (idx < 0) return s;
      const next = [...s.annotations];
      next[idx] = nudgeAnnotation(next[idx], dx, dy);
      return pushHist
        ? { past: [...s.past, snapshot(s)], future: [], annotations: next, dirty: true }
        : { annotations: next, dirty: true };
    }),

  // Snapshot the current doc (annotations + crop) so the next gesture can be
  // undone. Clears redo.
  pushHistory: () => set((s) => ({ past: [...s.past, snapshot(s)], future: [] })),

  add: (a) => set((s) => ({ annotations: addAnnotation(s.annotations, a), selectedId: a.id, dirty: true })),
  // Undo the onDown push+add for a draft that turned out to be a click, not a drag:
  // drop the annotation AND the single history entry onDown pushed, so it's as if the
  // gesture never happened (no phantom shape, no dead undo step).
  discardDraft: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      past: s.past.slice(0, -1),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  update: (id, patch) => set((s) => ({ annotations: updateAnnotation(s.annotations, id, patch), dirty: true })),
  remove: (id) =>
    set((s) => ({
      annotations: deleteAnnotation(s.annotations, id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      dirty: true,
    })),

  // Wholesale replace (eraser). Drops the selection if the selected annotation
  // is no longer present in the new list.
  setAnnotations: (list) =>
    set((s) => ({
      annotations: list,
      dirty: true,
      selectedId: list.some((a) => a.id === s.selectedId) ? s.selectedId : null,
    })),

  setEraserSize: (n) => set({ eraserSize: n }),
  setPicking: (v) => set({ picking: v }),

  // Wipe every annotation in one gesture (a single undoable step). No-op — and
  // crucially no spurious history entry — when there's nothing to clear. The
  // snapshot keeps the current crop so undo restores annotations only.
  clearAll: () =>
    set((s) =>
      s.annotations.length
        ? { past: [...s.past, snapshot(s)], future: [], annotations: [], selectedId: null, dirty: true }
        : s,
    ),

  // Crop is structural → part of the undo snapshot. Callers pushHistory() before
  // setCrop so the prior crop can be undone.
  setCrop: (c) => set({ crop: c, dirty: true }),
  resetCrop: () =>
    set((s) => (s.crop === null ? s : { past: [...s.past, snapshot(s)], future: [], crop: null, dirty: true })),

  // Frame styling is live tweak state (like the style bar) — never in history.
  setFrame: (patch) => set((s) => ({ frame: { ...s.frame, ...patch }, dirty: true })),
  // Chrome is live tweak state too (never in history). Selecting a real chrome
  // style auto-enables the frame (chrome is part of the card, so a no-op would
  // confuse). Switching to Window with an empty title prefills the project name
  // as a convenience (still editable/clearable).
  setChrome: (patch) =>
    set((s) => {
      const chrome = { ...s.frame.chrome, ...patch };
      const enabling = chrome.style === "window" || chrome.style === "browser";
      if (chrome.style === "window" && !chrome.title.trim()) {
        chrome.title = s.projectName ?? "";
      }
      return {
        frame: { ...s.frame, chrome, enabled: enabling ? true : s.frame.enabled },
        dirty: true,
      };
    }),
  toggleFrame: (on) =>
    set((s) => {
      const enabled = on ?? !s.frame.enabled;
      if (enabled === s.frame.enabled) return s; // no-op → no dead undo step
      return { past: [...s.past, snapshot(s)], future: [], frame: { ...s.frame, enabled }, dirty: true };
    }),
  resetFrame: () =>
    set((s) => {
      const fresh = freshFrame();
      // Already default → no change and no dead undo step.
      if (JSON.stringify(s.frame) === JSON.stringify(fresh)) return s;
      return { past: [...s.past, snapshot(s)], future: [], frame: fresh, dirty: true };
    }),

  undo: () =>
    set((s) =>
      s.past.length
        ? {
            ...s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [snapshot(s), ...s.future],
            selectedId: null,
            dirty: true,
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            ...s.future[0],
            future: s.future.slice(1),
            past: [...s.past, snapshot(s)],
            selectedId: null,
            dirty: true,
          }
        : s,
    ),
}));
