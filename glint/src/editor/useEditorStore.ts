import { create } from "zustand";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  DEFAULT_STYLE,
  type Annotation,
  type Style,
  type ToolId,
} from "./model";
import type { Crop } from "./composition";
import { GRADIENTS } from "./gradients";

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

export interface FrameConfig {
  enabled: boolean;
  background: FrameBackground;
  padding: number;
  radius: number;
  shadow: number;
  aspect: "auto" | "1:1" | "16:9" | "4:3";
}

/** One step of undo/redo history: annotations + the structural crop together. */
interface DocSnapshot { annotations: Annotation[]; crop: Crop | null }

export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  background: { type: "gradient", gradientId: GRADIENTS[0].id },
  padding: 40,
  radius: 12,
  shadow: 35,
  aspect: "auto",
};

interface EditorState {
  base: EditorBase | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: ToolId;
  style: Style;
  crop: Crop | null;
  frame: FrameConfig;
  past: DocSnapshot[];
  future: DocSnapshot[];

  setBase: (b: EditorBase) => void;
  reset: () => void;
  setTool: (t: ToolId) => void;
  setStyle: (patch: Partial<Style>) => void;
  select: (id: string | null) => void;
  pushHistory: () => void;
  add: (a: Annotation) => void;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  setCrop: (c: Crop) => void;
  resetCrop: () => void;
  setFrame: (patch: Partial<FrameConfig>) => void;
  toggleFrame: (on?: boolean) => void;
  resetFrame: () => void;
  undo: () => void;
  redo: () => void;
}

/** Fresh frame config with its nested background cloned (so resets/inits never share refs). */
const freshFrame = (): FrameConfig => ({ ...DEFAULT_FRAME, background: { ...DEFAULT_FRAME.background } });

const INITIAL = {
  base: null as EditorBase | null,
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  tool: "select" as ToolId,
  style: { ...DEFAULT_STYLE },
  crop: null as Crop | null,
  frame: freshFrame(),
  past: [] as DocSnapshot[],
  future: [] as DocSnapshot[],
};

export const useEditorStore = create<EditorState>((set) => ({
  ...INITIAL,
  style: { ...DEFAULT_STYLE },

  setBase: (b) => set({ base: b }),
  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE }, frame: freshFrame() }),
  setTool: (t) => set({ tool: t, selectedId: null }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  select: (id) => set({ selectedId: id }),

  // Snapshot the current doc (annotations + crop) so the next gesture can be
  // undone. Clears redo.
  pushHistory: () => set((s) => ({ past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [] })),

  add: (a) => set((s) => ({ annotations: addAnnotation(s.annotations, a), selectedId: a.id })),
  update: (id, patch) => set((s) => ({ annotations: updateAnnotation(s.annotations, id, patch) })),
  remove: (id) =>
    set((s) => ({
      annotations: deleteAnnotation(s.annotations, id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  // Wipe every annotation in one gesture (a single undoable step). No-op — and
  // crucially no spurious history entry — when there's nothing to clear. The
  // snapshot keeps the current crop so undo restores annotations only.
  clearAll: () =>
    set((s) =>
      s.annotations.length
        ? { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: [], selectedId: null }
        : s,
    ),

  // Crop is structural → part of the undo snapshot. Callers pushHistory() before
  // setCrop so the prior crop can be undone.
  setCrop: (c) => set({ crop: c }),
  resetCrop: () => set({ crop: null }),

  // Frame styling is live tweak state (like the style bar) — never in history.
  setFrame: (patch) => set((s) => ({ frame: { ...s.frame, ...patch } })),
  toggleFrame: (on) => set((s) => ({ frame: { ...s.frame, enabled: on ?? !s.frame.enabled } })),
  resetFrame: () => set({ frame: freshFrame() }),

  undo: () =>
    set((s) =>
      s.past.length
        ? {
            ...s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [{ annotations: s.annotations, crop: s.crop }, ...s.future],
            selectedId: null,
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            ...s.future[0],
            future: s.future.slice(1),
            past: [...s.past, { annotations: s.annotations, crop: s.crop }],
            selectedId: null,
          }
        : s,
    ),
}));
