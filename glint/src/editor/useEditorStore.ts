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

/** Non-serializable base image for the live session (5c persists annotations only). */
export interface EditorBase {
  image: HTMLImageElement;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
}

interface EditorState {
  base: EditorBase | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: ToolId;
  style: Style;
  past: Annotation[][];
  future: Annotation[][];

  setBase: (b: EditorBase) => void;
  reset: () => void;
  setTool: (t: ToolId) => void;
  setStyle: (patch: Partial<Style>) => void;
  select: (id: string | null) => void;
  pushHistory: () => void;
  add: (a: Annotation) => void;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  undo: () => void;
  redo: () => void;
}

const INITIAL = {
  base: null as EditorBase | null,
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  tool: "select" as ToolId,
  style: { ...DEFAULT_STYLE },
  past: [] as Annotation[][],
  future: [] as Annotation[][],
};

export const useEditorStore = create<EditorState>((set) => ({
  ...INITIAL,

  setBase: (b) => set({ base: b }),
  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE } }),
  setTool: (t) => set({ tool: t, selectedId: t === "select" ? null : null }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  select: (id) => set({ selectedId: id }),

  // Snapshot the current annotations so the next gesture can be undone. Clears redo.
  pushHistory: () => set((s) => ({ past: [...s.past, s.annotations], future: [] })),

  add: (a) => set((s) => ({ annotations: addAnnotation(s.annotations, a), selectedId: a.id })),
  update: (id, patch) => set((s) => ({ annotations: updateAnnotation(s.annotations, id, patch) })),
  remove: (id) =>
    set((s) => ({
      annotations: deleteAnnotation(s.annotations, id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  undo: () =>
    set((s) =>
      s.past.length
        ? {
            annotations: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.annotations, ...s.future],
            selectedId: null,
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            annotations: s.future[0],
            future: s.future.slice(1),
            past: [...s.past, s.annotations],
            selectedId: null,
          }
        : s,
    ),
}));
