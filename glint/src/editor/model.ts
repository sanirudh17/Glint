/**
 * model.ts — the editor's serializable annotation model.
 *
 * This array IS the source of truth; Konva renders from it. Keeping the model
 * plain (no Konva nodes) makes undo/redo, .glint persistence (5c), and unit
 * testing trivial. All functions here are pure.
 */

export type ToolId =
  | "select"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "pen"
  | "highlight"
  | "blur"
  | "redact"
  | "spotlight"
  | "step"
  | "eraser"
  | "crop";

export interface Style {
  color: string;
  strokeWidth: number;
  fontSize: number;
  /** rect/ellipse interior fill; null/undefined = no fill (unchanged look). */
  fill?: string | null;
  /** 0..1 opacity applied to the fill only; default 1. */
  fillOpacity?: number;
  /** dashed stroke for line/arrow/rect/ellipse; default false. */
  dashed?: boolean;
  /** arrow tool: also draw a head at the start point; default false. */
  arrowStart?: boolean;
  /** redact tool: "solid" opaque block (default) or "pixelate" mosaic. */
  redactStyle?: "solid" | "pixelate";
  /** spotlight tool: bright-region shape. "rect" (default) or "ellipse". */
  region?: "rect" | "ellipse";
}

interface Base {
  id: string;
  z: number;
  style: Style;
}

export interface TwoPointAnno extends Base {
  type: "arrow" | "line";
  x1: number; y1: number; x2: number; y2: number;
}
export interface BoxAnno extends Base {
  type: "rect" | "ellipse" | "blur" | "redact" | "spotlight";
  x: number; y: number; w: number; h: number;
}
export interface TextAnno extends Base {
  type: "text";
  x: number; y: number; text: string;
}
export interface FreehandAnno extends Base {
  type: "pen" | "highlight";
  points: number[]; // flat [x0,y0,x1,y1,...]
}
export interface StepAnno extends Base {
  type: "step";
  x: number; y: number; number: number;
}

export type Annotation =
  | TwoPointAnno
  | BoxAnno
  | TextAnno
  | FreehandAnno
  | StepAnno;

export const DEFAULT_STYLE: Style = {
  color: "#E5484D", strokeWidth: 3, fontSize: 24,
  fill: null, fillOpacity: 1, dashed: false, arrowStart: false,
};

let _seq = 0;
/** Monotonic-ish id, unique within a session. */
export function newId(): string {
  return `a${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

export function addAnnotation(list: Annotation[], a: Annotation): Annotation[] {
  return [...list, a];
}

export function updateAnnotation(
  list: Annotation[],
  id: string,
  patch: Partial<Annotation>,
): Annotation[] {
  return list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a));
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
  return list.filter((a) => a.id !== id);
}

/** The badge number a new step should use: max existing + 1, else 1. */
export function nextStepNumber(list: Annotation[]): number {
  const nums = list.filter((a): a is StepAnno => a.type === "step").map((a) => a.number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/**
 * Split a freehand stroke where an eraser circle (center ex,ey, `radius`) covers
 * its vertices, dropping the covered points. Returns `[a]` (the original, same
 * ref) when the circle touches none of its vertices. Otherwise returns the
 * surviving sub-strokes — a stroke broken in the middle becomes two — discarding
 * any fragment with fewer than 2 points. Extra segments get fresh ids.
 */
function splitFreehand(a: FreehandAnno, ex: number, ey: number, radius: number): FreehandAnno[] {
  const pts = a.points;
  const r2 = radius * radius;
  const runs: number[][] = [];
  let run: number[] = [];
  let erasedAny = false;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const dx = pts[i] - ex;
    const dy = pts[i + 1] - ey;
    if (dx * dx + dy * dy <= r2) {
      erasedAny = true;
      if (run.length >= 4) runs.push(run);
      run = [];
    } else {
      run.push(pts[i], pts[i + 1]);
    }
  }
  if (run.length >= 4) runs.push(run);
  if (!erasedAny) return [a];
  return runs.map((points, i) => (i === 0 ? { ...a, points } : { ...a, id: newId(), points }));
}

/**
 * Apply one eraser "dab" at (ex,ey) with `radius`: split freehand strokes whose
 * vertices the circle covers (precise partial erase), and drop `dropId` — a whole
 * non-freehand shape the caller resolved by hit-testing (shapes erase on contact;
 * there's no partial rectangle/arrow). Returns the SAME array reference when
 * nothing changed, so callers can cheaply skip a no-op update.
 */
export function eraseAt(
  list: Annotation[],
  ex: number,
  ey: number,
  radius: number,
  dropId: string | null,
): Annotation[] {
  let changed = false;
  const out: Annotation[] = [];
  for (const a of list) {
    if (a.id === dropId) { changed = true; continue; }
    if (a.type === "pen" || a.type === "highlight") {
      const segs = splitFreehand(a, ex, ey, radius);
      if (segs.length === 1 && segs[0] === a) {
        out.push(a);
      } else {
        changed = true;
        out.push(...segs);
      }
    } else {
      out.push(a);
    }
  }
  return changed ? out : list;
}

/** Snap the (x1,y1)→(x2,y2) vector to the nearest 45°, preserving its length.
 * Used while drawing a line/arrow with Shift held. Pure. */
export function snapAngle(x1: number, y1: number, x2: number, y2: number): { x2: number; y2: number } {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x2, y2 };
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x2: x1 + Math.cos(ang) * len, y2: y1 + Math.sin(ang) * len };
}

/** Clone an annotation with a fresh id, offset +12,+12 px. Pure. */
export function duplicateAnnotation(a: Annotation): Annotation {
  const OFF = 12;
  const base = { ...a, id: newId(), style: { ...a.style } };
  switch (a.type) {
    case "arrow":
    case "line":
      return { ...(base as TwoPointAnno), x1: a.x1 + OFF, y1: a.y1 + OFF, x2: a.x2 + OFF, y2: a.y2 + OFF };
    case "rect":
    case "ellipse":
    case "blur":
    case "redact":
    case "spotlight":
      return { ...(base as BoxAnno), x: a.x + OFF, y: a.y + OFF };
    case "text":
      return { ...(base as TextAnno), x: a.x + OFF, y: a.y + OFF };
    case "step":
      return { ...(base as StepAnno), x: a.x + OFF, y: a.y + OFF };
    case "pen":
    case "highlight":
      return { ...(base as FreehandAnno), points: a.points.map((p) => p + OFF) };
  }
}

/** Shift an annotation by (dx,dy) in image px. Pure. */
export function nudgeAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case "arrow":
    case "line":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "rect":
    case "ellipse":
    case "blur":
    case "redact":
    case "spotlight":
    case "text":
    case "step":
      return { ...a, x: a.x + dx, y: a.y + dy };
    case "pen":
    case "highlight":
      return { ...a, points: a.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy)) };
  }
}

/** Move `id` one step in paint order (array order). `forward` = toward the top
 * (end of array). Returns the SAME reference when the move is a no-op. Pure. */
export function reorder(list: Annotation[], id: string, dir: "forward" | "backward"): Annotation[] {
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return list;
  const j = dir === "forward" ? i + 1 : i - 1;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The single dim value the shared spotlight overlay renders at: the selected
 *  spotlight's opacity if one is selected, else the first spotlight's, else the
 *  default 0.6. (The StyleBar keeps all spotlights equal, so this is unambiguous.) */
export function resolveSpotlightDim(annotations: Annotation[], selectedId: string | null): number {
  const spots = annotations.filter((a): a is BoxAnno => a.type === "spotlight");
  const sel = spots.find((a) => a.id === selectedId);
  return (sel ?? spots[0])?.style.fillOpacity ?? 0.6;
}
