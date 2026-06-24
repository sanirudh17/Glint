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
  | "step"
  | "eraser"
  | "crop";

export interface Style {
  color: string;
  strokeWidth: number;
  fontSize: number;
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
  type: "rect" | "ellipse" | "blur";
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

export const DEFAULT_STYLE: Style = { color: "#E5484D", strokeWidth: 3, fontSize: 24 };

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
