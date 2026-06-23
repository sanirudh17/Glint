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
