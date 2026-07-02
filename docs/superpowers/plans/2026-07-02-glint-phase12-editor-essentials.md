# Phase 12 — Editor Essentials + "Done" Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Done" button that flattens the edit and shows it as a bottom-left HUD (hiding the editor), plus a batch of small editor upgrades: shape fill+opacity, dashed strokes, arrow start-head, 45°-constrain, duplicate, arrow-key nudge, z-order, and per-tool style memory.

**Architecture:** All new annotation styling is additive optional fields on the existing `Style` type with safe defaults, rendered in `AnnotationNode`. New pure helpers live in `model.ts` (unit-tested); new store actions in `useEditorStore.ts` (unit-tested); keyboard wiring in `EditorView.tsx`; the draw-time 45° snap in `EditorStage.tsx`; the style controls in `StyleBar.tsx`. "Done" is a new Rust command `editor_done` that reuses the existing `crate::hud::open` (already bottom-left) and `LastCaptureState`.

**Tech Stack:** React 19 + TypeScript, Zustand, react-konva/Konva, Vitest; Rust + Tauri v2, the `image` crate.

## Global Constraints

- **Local-first only.** No cloud, no upload, no accounts, no network calls.
- **Single-user.** No auth.
- **Recorder isolation (sacred).** `recorder/*` imports nothing from `capture/`, `editor/`, `overlay/`, `ocr/`; `ocr/` nothing from `recorder/`. This phase does not touch `recorder/`.
- **Tauri IPC arg keys are camelCase in JS** → snake_case in Rust (e.g. `pngBase64` → `png_base64`). Verified against `editor_copy`.
- **Model functions stay pure** (no Konva/React/state). The annotation array is the source of truth.
- **All existing tests stay green:** 63 vitest, 103 cargo.
- Commit after each task. Branch: `phase-12-editor-essentials`.

---

### Task 1: Model — `Style` optional fields + defaults

**Files:**
- Modify: `glint/src/editor/model.ts`
- Test: `glint/src/editor/model.test.ts`

**Interfaces:**
- Produces: `Style` gains `fill?: string | null`, `fillOpacity?: number`, `dashed?: boolean`, `arrowStart?: boolean`; `DEFAULT_STYLE` sets all four.

- [ ] **Step 1: Write the failing test** — add to `model.test.ts`:

```ts
import { DEFAULT_STYLE } from "./model";

describe("DEFAULT_STYLE new fields", () => {
  it("has safe defaults for the new style fields", () => {
    expect(DEFAULT_STYLE.fill).toBeNull();
    expect(DEFAULT_STYLE.fillOpacity).toBe(1);
    expect(DEFAULT_STYLE.dashed).toBe(false);
    expect(DEFAULT_STYLE.arrowStart).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: FAIL (properties undefined / not equal).

- [ ] **Step 3: Implement** — in `model.ts`, extend `Style` and `DEFAULT_STYLE`:

```ts
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
}

export const DEFAULT_STYLE: Style = {
  color: "#E5484D", strokeWidth: 3, fontSize: 24,
  fill: null, fillOpacity: 1, dashed: false, arrowStart: false,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts
git commit -m "feat(p12): Style gains fill/fillOpacity/dashed/arrowStart with defaults"
```

---

### Task 2: Model — `snapAngle` helper (45° constrain)

**Files:**
- Modify: `glint/src/editor/model.ts`
- Test: `glint/src/editor/model.test.ts`

**Interfaces:**
- Produces: `snapAngle(x1: number, y1: number, x2: number, y2: number): { x2: number; y2: number }` — snaps the (x1,y1)→(x2,y2) vector to the nearest 45°, preserving length.

- [ ] **Step 1: Write the failing test**

```ts
import { snapAngle } from "./model";

describe("snapAngle", () => {
  it("snaps a near-horizontal vector to 0°", () => {
    const r = snapAngle(0, 0, 10, 1);
    expect(r.x2).toBeCloseTo(Math.hypot(10, 1), 5);
    expect(r.y2).toBeCloseTo(0, 5);
  });
  it("snaps a near-diagonal vector to 45° preserving length", () => {
    const len = Math.hypot(10, 9);
    const r = snapAngle(0, 0, 10, 9);
    expect(r.x2).toBeCloseTo(len * Math.SQRT1_2, 5);
    expect(r.y2).toBeCloseTo(len * Math.SQRT1_2, 5);
  });
  it("returns the point unchanged for a zero-length vector", () => {
    expect(snapAngle(5, 5, 5, 5)).toEqual({ x2: 5, y2: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: FAIL ("snapAngle is not a function").

- [ ] **Step 3: Implement** — append to `model.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts
git commit -m "feat(p12): snapAngle helper for 45-degree line/arrow constrain"
```

---

### Task 3: Model — `duplicateAnnotation`, `nudgeAnnotation`, `reorder`

**Files:**
- Modify: `glint/src/editor/model.ts`
- Test: `glint/src/editor/model.test.ts`

**Interfaces:**
- Produces:
  - `duplicateAnnotation(a: Annotation): Annotation` — clone with a fresh id, offset +12,+12.
  - `nudgeAnnotation(a: Annotation, dx: number, dy: number): Annotation` — shift by (dx,dy).
  - `reorder(list: Annotation[], id: string, dir: "forward" | "backward"): Annotation[]` — swap one step in paint order; same ref if no move.

- [ ] **Step 1: Write the failing test**

```ts
import { duplicateAnnotation, nudgeAnnotation, reorder, type Annotation } from "./model";

const rect = (id: string): Annotation =>
  ({ id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, x: 10, y: 20, w: 30, h: 40 });
const arrow = (id: string): Annotation =>
  ({ id, type: "arrow", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, x1: 0, y1: 0, x2: 5, y2: 5 });
const pen = (id: string): Annotation =>
  ({ id, type: "pen", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, points: [0, 0, 2, 4] });

describe("duplicateAnnotation", () => {
  it("gives the clone a new id and offsets a box by +12,+12", () => {
    const d = duplicateAnnotation(rect("a")) as Extract<Annotation, { type: "rect" }>;
    expect(d.id).not.toBe("a");
    expect([d.x, d.y]).toEqual([22, 32]);
    expect([d.w, d.h]).toEqual([30, 40]);
  });
  it("offsets both points of an arrow", () => {
    const d = duplicateAnnotation(arrow("a")) as Extract<Annotation, { type: "arrow" }>;
    expect([d.x1, d.y1, d.x2, d.y2]).toEqual([12, 12, 17, 17]);
  });
});

describe("nudgeAnnotation", () => {
  it("shifts a box", () => {
    const n = nudgeAnnotation(rect("a"), -1, 5) as Extract<Annotation, { type: "rect" }>;
    expect([n.x, n.y]).toEqual([9, 25]);
  });
  it("shifts every freehand vertex", () => {
    const n = nudgeAnnotation(pen("a"), 3, 7) as Extract<Annotation, { type: "pen" }>;
    expect(n.points).toEqual([3, 7, 5, 11]);
  });
});

describe("reorder", () => {
  it("moves an item forward one step", () => {
    const list = [rect("a"), rect("b"), rect("c")];
    expect(reorder(list, "a", "forward").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("moves an item backward one step", () => {
    const list = [rect("a"), rect("b"), rect("c")];
    expect(reorder(list, "c", "backward").map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
  it("returns the same reference at the edges", () => {
    const list = [rect("a"), rect("b")];
    expect(reorder(list, "a", "backward")).toBe(list);
    expect(reorder(list, "b", "forward")).toBe(list);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: FAIL (functions not defined).

- [ ] **Step 3: Implement** — append to `model.ts`:

```ts
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
```

Note: `duplicateAnnotation` references the `TwoPointAnno`/`BoxAnno`/`TextAnno`/`StepAnno`/`FreehandAnno` interfaces already declared in `model.ts` — no new imports needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts
git commit -m "feat(p12): duplicateAnnotation, nudgeAnnotation, reorder helpers"
```

---

### Task 4: Store — per-tool style memory (`toolStyles`)

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts`
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_STYLE`, `ToolId`, `Style` from `model.ts`.
- Produces: store gains `toolStyles: Partial<Record<ToolId, Style>>`; `setTool(t)` loads that tool's remembered style (or `DEFAULT_STYLE`); `setStyle(patch)` writes the merged style back to the current tool's slot. `reset()`/`loadDoc()` clear `toolStyles`.

- [ ] **Step 1: Write the failing test** — add to `useEditorStore.test.ts`:

```ts
import { useEditorStore } from "./useEditorStore";
import { DEFAULT_STYLE } from "./model";

describe("per-tool style memory", () => {
  beforeEach(() => useEditorStore.getState().reset());
  it("remembers each tool's last style independently", () => {
    const s = useEditorStore.getState();
    s.setTool("arrow");
    s.setStyle({ color: "#0000ff" });
    s.setTool("rect");
    expect(useEditorStore.getState().style.color).toBe(DEFAULT_STYLE.color); // rect uncustomized
    s.setTool("arrow");
    expect(useEditorStore.getState().style.color).toBe("#0000ff"); // arrow remembered
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL (arrow color not remembered — switching tools kept the shared style).

- [ ] **Step 3: Implement** in `useEditorStore.ts`:

Add to the `EditorState` interface (near `style`):
```ts
  toolStyles: Partial<Record<ToolId, Style>>;
```
Add to `INITIAL`:
```ts
  toolStyles: {} as Partial<Record<ToolId, Style>>,
```
Replace `setTool` and `setStyle`:
```ts
  setTool: (t) =>
    set((s) => ({ tool: t, selectedId: null, style: s.toolStyles[t] ?? { ...DEFAULT_STYLE } })),
  setStyle: (patch) =>
    set((s) => {
      const style = { ...s.style, ...patch };
      return { style, toolStyles: { ...s.toolStyles, [s.tool]: style } };
    }),
```
In `reset()` add `toolStyles: {}` to the set; in `loadDoc(...)` add `toolStyles: {}` to the set object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS. Also run the full editor test file to confirm no regressions: `npx vitest run src/editor/useEditorStore.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p12): per-tool style memory in the editor store"
```

---

### Task 5: Store — `duplicate`, `bringForward`, `sendBackward`, `nudge` actions

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts`
- Test: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: `duplicateAnnotation`, `nudgeAnnotation`, `reorder` from `model.ts`.
- Produces: store actions `duplicate(id: string)` (clones, selects clone, pushes history), `bringForward(id)`, `sendBackward(id)`, `nudge(id, dx, dy)` — each pushes history and marks dirty.

- [ ] **Step 1: Write the failing test** — add to `useEditorStore.test.ts`:

```ts
import type { Annotation } from "./model";

const mkRect = (id: string, x = 0): Annotation =>
  ({ id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, x, y: 0, w: 10, h: 10 });

describe("duplicate / z-order / nudge actions", () => {
  beforeEach(() => useEditorStore.getState().reset());
  it("duplicate adds a clone, selects it, and is undoable", () => {
    const s = useEditorStore.getState();
    s.add(mkRect("a"));
    s.duplicate("a");
    const st = useEditorStore.getState();
    expect(st.annotations.length).toBe(2);
    expect(st.selectedId).not.toBe("a");
    expect(st.selectedId).toBe(st.annotations[1].id);
    st.undo();
    expect(useEditorStore.getState().annotations.length).toBe(1);
  });
  it("bringForward / sendBackward reorder paint order", () => {
    const s = useEditorStore.getState();
    s.add(mkRect("a")); s.add(mkRect("b"));
    s.bringForward("a");
    expect(useEditorStore.getState().annotations.map((x) => x.id)).toEqual(["b", "a"]);
    s.sendBackward("a");
    expect(useEditorStore.getState().annotations.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("nudge shifts the annotation and is undoable", () => {
    const s = useEditorStore.getState();
    s.add(mkRect("a", 5));
    s.nudge("a", 10, 0);
    expect((useEditorStore.getState().annotations[0] as { x: number }).x).toBe(15);
    useEditorStore.getState().undo();
    expect((useEditorStore.getState().annotations[0] as { x: number }).x).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL (actions not defined).

- [ ] **Step 3: Implement** in `useEditorStore.ts`:

Add imports at the top:
```ts
import { duplicateAnnotation, nudgeAnnotation, reorder } from "./model";
```
Add to the `EditorState` interface:
```ts
  duplicate: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  nudge: (id: string, dx: number, dy: number) => void;
```
Add the implementations (near `remove`):
```ts
  duplicate: (id) =>
    set((s) => {
      const a = s.annotations.find((x) => x.id === id);
      if (!a) return s;
      const copy = duplicateAnnotation(a);
      return {
        past: [...s.past, { annotations: s.annotations, crop: s.crop }],
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
        : { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: next, dirty: true };
    }),
  sendBackward: (id) =>
    set((s) => {
      const next = reorder(s.annotations, id, "backward");
      return next === s.annotations
        ? s
        : { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: next, dirty: true };
    }),
  nudge: (id, dx, dy) =>
    set((s) => {
      const idx = s.annotations.findIndex((x) => x.id === id);
      if (idx < 0) return s;
      const next = [...s.annotations];
      next[idx] = nudgeAnnotation(next[idx], dx, dy);
      return { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: next, dirty: true };
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p12): duplicate, z-order, and nudge store actions"
```

---

### Task 6: Render fill / opacity / dashed / arrow-start in `AnnotationNode`

**Files:**
- Modify: `glint/src/views/editor/AnnotationNode.tsx`

**Interfaces:**
- Consumes: the new `Style` fields (Task 1).
- Produces: rect/ellipse render an optional translucent fill + optional dash; line/arrow render optional dash; arrow renders an optional start head. No signature changes.

- [ ] **Step 1: Add a hex→rgba helper** at the top of `AnnotationNode.tsx` (after imports):

```ts
/** "#RRGGBB" + alpha → "rgba(r,g,b,a)". Returns the input untouched if it isn't a
 * 6-digit hex (e.g. already rgba), so custom colours still work. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DASH = [12, 8];
```

- [ ] **Step 2: Update the `arrow` case** to add dash + start head:

```tsx
    case "arrow": {
      const a = anno as TwoPointAnno;
      return (
        <Arrow
          {...common}
          x={0} y={0}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          fill={a.style.color}
          strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          pointerAtBeginning={a.style.arrowStart ?? false}
          pointerLength={10 + a.style.strokeWidth}
          pointerWidth={10 + a.style.strokeWidth}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
```

- [ ] **Step 3: Update the `line` case** to add dash:

```tsx
    case "line": {
      const a = anno as TwoPointAnno;
      return (
        <Line
          {...common}
          x={0} y={0}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          lineCap="round"
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
```

- [ ] **Step 4: Update the `rect` case** to add fill + dash:

```tsx
    case "rect": {
      const a = anno as BoxAnno;
      return (
        <Rect
          {...common}
          x={a.x} y={a.y} width={a.w} height={a.h}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          fill={a.style.fill ? hexToRgba(a.style.fill, a.style.fillOpacity ?? 1) : undefined}
        />
      );
    }
```

- [ ] **Step 5: Update the `ellipse` case** to add fill + dash (keep its custom onDragEnd):

```tsx
    case "ellipse": {
      const a = anno as BoxAnno;
      return (
        <Ellipse
          {...common}
          x={a.x + a.w / 2} y={a.y + a.h / 2}
          radiusX={Math.abs(a.w / 2)} radiusY={Math.abs(a.h / 2)}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          fill={a.style.fill ? hexToRgba(a.style.fill, a.style.fillOpacity ?? 1) : undefined}
          onDragEnd={(e) => {
            const node = e.target;
            onChange({ x: node.x() - a.w / 2, y: node.y() - a.h / 2 } as Partial<Annotation>);
          }}
        />
      );
    }
```

- [ ] **Step 6: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean ("no output").

- [ ] **Step 7: Commit**

```bash
git add glint/src/views/editor/AnnotationNode.tsx
git commit -m "feat(p12): render shape fill/opacity, dashed strokes, arrow start-head"
```

---

### Task 7: 45°-constrain while drawing (EditorStage)

**Files:**
- Modify: `glint/src/views/editor/EditorStage.tsx`

**Interfaces:**
- Consumes: `snapAngle` (Task 2).

- [ ] **Step 1: Import `snapAngle`** — update the model import line:

```ts
import { newId, nextStepNumber, eraseAt, snapAngle, type Annotation, type TextAnno } from "../../editor/model";
```

- [ ] **Step 2: Apply the snap in `onMove`** — replace the arrow/line branch inside `onMove`:

```tsx
    if (a.type === "arrow" || a.type === "line") {
      let nx = x, ny = y;
      if (e.evt.shiftKey) {
        const s = snapAngle(a.x1, a.y1, x, y);
        nx = s.x2; ny = s.y2;
      }
      update(id, { x2: nx, y2: ny } as Partial<Annotation>);
    } else if (a.type === "rect" || a.type === "ellipse" || a.type === "blur") {
```

(Leave the rest of `onMove` unchanged.)

- [ ] **Step 3: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/editor/EditorStage.tsx
git commit -m "feat(p12): Shift constrains line/arrow to 45 degrees while drawing"
```

---

### Task 8: StyleBar — fill, opacity, dashed, arrow-start controls

**Files:**
- Modify: `glint/src/views/editor/StyleBar.tsx`
- Modify: `glint/src/views/editor/editor.css` (small additions)

**Interfaces:**
- Consumes: `setStyle`, `update`, `pushHistory`, `selectedId`, `tool`, `style` (all already used).

- [ ] **Step 1: Add appliers** — inside `StyleBar`, after the existing `applyWidth`:

```tsx
  const applyFill = (fill: string | null) => { setStyle({ fill }); patchSelected({ fill }); };
  const applyFillOpacity = (fillOpacity: number) => { setStyle({ fillOpacity }); patchSelected({ fillOpacity }); };
  const applyDashed = (dashed: boolean) => { setStyle({ dashed }); patchSelected({ dashed }); };
  const applyArrowStart = (arrowStart: boolean) => { setStyle({ arrowStart }); patchSelected({ arrowStart }); };

  const isShape = tool === "rect" || tool === "ellipse";
  const isStroke = tool === "rect" || tool === "ellipse" || tool === "line" || tool === "arrow";
```

- [ ] **Step 2: Render the controls** — inside the returned main toolbar (before the closing `</div>` of `.editor-stylebar`, after the widths block):

```tsx
      {isShape && (
        <div className="editor-fillgroup">
          <button
            className={`editor-width${!style.fill ? " editor-width--active" : ""}`}
            title="No fill"
            aria-label="No fill"
            onClick={() => applyFill(null)}
          >
            ⦸
          </button>
          <label className="editor-swatch editor-swatch--custom" title="Fill color" style={{ background: style.fill ?? undefined }}>
            <input
              type="color"
              value={style.fill ?? "#ffffff"}
              onChange={(e) => applyFill(e.currentTarget.value)}
              aria-label="Fill color"
            />
          </label>
          {style.fill && (
            <input
              className="editor-opacity"
              type="range"
              min={0} max={100}
              value={Math.round((style.fillOpacity ?? 1) * 100)}
              onChange={(e) => applyFillOpacity(Number(e.currentTarget.value) / 100)}
              aria-label="Fill opacity"
              title="Fill opacity"
            />
          )}
        </div>
      )}
      {isStroke && (
        <button
          className={`editor-width${style.dashed ? " editor-width--active" : ""}`}
          title="Dashed stroke"
          aria-label="Toggle dashed stroke"
          onClick={() => applyDashed(!style.dashed)}
        >
          ┄
        </button>
      )}
      {tool === "arrow" && (
        <button
          className={`editor-width${style.arrowStart ? " editor-width--active" : ""}`}
          title="Head at start too"
          aria-label="Toggle start arrowhead"
          onClick={() => applyArrowStart(!style.arrowStart)}
        >
          ⇄
        </button>
      )}
```

- [ ] **Step 3: Add minimal CSS** — append to `glint/src/views/editor/editor.css`:

```css
.editor-fillgroup { display: inline-flex; align-items: center; gap: 6px; }
.editor-opacity { width: 72px; accent-color: var(--accent); }
```

- [ ] **Step 4: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/editor/StyleBar.tsx glint/src/views/editor/editor.css
git commit -m "feat(p12): StyleBar fill/opacity, dashed, and arrow start-head controls"
```

---

### Task 9: EditorView — Ctrl+D, arrow-key nudge, Ctrl+]/[

**Files:**
- Modify: `glint/src/views/EditorView.tsx`

**Interfaces:**
- Consumes: store `duplicate`, `nudge`, `bringForward`, `sendBackward` (Task 5) via `useEditorStore.getState()`.

- [ ] **Step 1: Extend the keydown handler** — in the `onKey` function in `EditorView.tsx`, insert these blocks AFTER the existing Delete/Backspace block and BEFORE the `if (e.ctrlKey || e.metaKey || e.altKey) return;` tool-shortcut guard:

```tsx
      const st = useEditorStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId) st.duplicate(selectedId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "]") {
        e.preventDefault();
        if (selectedId) st.bringForward(selectedId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "[") {
        e.preventDefault();
        if (selectedId) st.sendBackward(selectedId);
        return;
      }
      if (selectedId && e.key.startsWith("Arrow") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d],
        };
        const mv = delta[e.key];
        if (mv) st.nudge(selectedId, mv[0], mv[1]);
        return;
      }
```

(The existing `target.tagName === "INPUT" || "TEXTAREA"` guard at the top of `onKey` already prevents these from firing while typing in a text field.)

- [ ] **Step 2: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke (dev)** — `npm run tauri dev`, open a capture in the editor, draw a rect, select it: Ctrl+D duplicates (offset, selected); arrow keys move it (Shift = faster); Ctrl+]/[ reorder against another shape; Ctrl+Z undoes each.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/EditorView.tsx
git commit -m "feat(p12): editor Ctrl+D duplicate, arrow-key nudge, Ctrl+bracket z-order"
```

---

### Task 10: Backend — `editor_done` command

**Files:**
- Modify: `glint/src-tauri/src/editor/commands.rs`
- Modify: `glint/src-tauri/src/lib.rs`
- Test: `glint/src-tauri/src/editor/commands.rs` (unit test for `decode_png_arg`)

**Interfaces:**
- Consumes: `crate::capture::LastCapture` / `LastCaptureState`, `crate::hud::open`, `decode_png_arg` (same file).
- Produces: `editor_done(app, last, png_base64: String) -> Result<(), String>` registered as a Tauri command.

- [ ] **Step 1: Write the failing test** — add to the `#[cfg(test)] mod tests` block in `commands.rs`:

```rust
    #[test]
    fn decode_png_arg_strips_data_url_prefix() {
        use base64::Engine;
        let raw = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let with_prefix = format!("data:image/png;base64,{raw}");
        assert_eq!(super::decode_png_arg(&with_prefix).unwrap(), b"hello");
        assert_eq!(super::decode_png_arg(&raw).unwrap(), b"hello");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint/src-tauri && cargo test decode_png_arg`
Expected: FAIL to compile — `decode_png_arg` is private. (This drives making it visible to the test, which is in the same module tree.)

- [ ] **Step 3: Implement** — in `commands.rs`:

Add the command (after `editor_flatten_temp`):
```rust
/// "Done": flatten result → make it the current capture result + open the bottom-left
/// HUD, then hide the editor. Reuses the post-capture HUD (crate::hud) and
/// LastCaptureState — the same surfaces `editor_open_from_last` already uses.
#[tauri::command]
pub fn editor_done(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    png_base64: String,
) -> Result<(), String> {
    let bytes = decode_png_arg(&png_base64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (img.width(), img.height());

    // Temp PNG so the HUD's drag-out / copy-path / reveal have a real file. Not yet in
    // the Library (saved=false) → the HUD shows Save, not Reveal.
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let dest = dir.join(format!("glint-edit-{ts}.png"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let path = dest.to_string_lossy().to_string();

    *last.0.lock().unwrap() = Some(crate::capture::LastCapture {
        path,
        width,
        height,
        rgba: img.into_raw(),
        saved: false,
    });

    // Building the HUD webview must run OFF the main thread (window-build rule). Only
    // hide the editor if the HUD actually came up, so a build failure never strands
    // the user with no window.
    let app2 = app.clone();
    std::thread::spawn(move || match crate::hud::open(&app2) {
        Ok(()) => {
            if let Some(win) = app2.get_webview_window("main") {
                let _ = win.hide();
            }
        }
        Err(e) => {
            log::error!("editor_done: hud open failed: {e}");
            let _ = app2.emit("glint-toast", "Couldn't open the result");
        }
    });
    Ok(())
}
```
(`AppHandle`, `Emitter`, `Manager`, `State` are already imported at the top of `commands.rs`.)

- [ ] **Step 4: Register the command** — in `lib.rs`:

Add `editor_done` to the `use editor::commands::{...}` list, and add `editor_done,` to the `tauri::generate_handler![...]` block (next to `editor_flatten_temp`).

- [ ] **Step 5: Run test + build**

Run: `cd glint/src-tauri && cargo test decode_png_arg && cargo build`
Expected: test PASS; build Finished. (If `glint.exe` is running and locks the target dir: `Stop-Process -Name glint -Force` first.)

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/editor/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p12): editor_done command — flatten to bottom-left HUD, hide editor"
```

---

### Task 11: Frontend — `editorDone` wrapper + Done button

**Files:**
- Modify: `glint/src/lib/editor.ts`
- Modify: `glint/src/views/editor/ExportBar.tsx`

**Interfaces:**
- Consumes: `editor_done` (Task 10).
- Produces: `editorDone(pngBase64: string): Promise<void>`; a Done button in `ExportBar`.

- [ ] **Step 1: Add the wrapper** — in `lib/editor.ts`, after `editorFlattenTemp`:

```ts
export const editorDone = (pngBase64: string): Promise<void> =>
  invoke<void>("editor_done", { pngBase64 });
```

- [ ] **Step 2: Add the Done button** — in `ExportBar.tsx`:

Update the import:
```ts
import { Copy, Download, Share2, Check } from "lucide-react";
import { editorCopy, editorSave, editorFlattenTemp, editorDone, dragOut } from "../../lib/editor";
```
Add the handler (after `onDrag`):
```ts
  const onDone = withPng(async (png) => {
    await editorDone(png);
  });
```
Replace the button row: demote Export to non-primary, add primary Done last:
```tsx
      <button className="editor-export-btn" onClick={onSave} title="Export a PNG to the Library">
        <Download size={16} strokeWidth={1.75} /> Export
      </button>
      <button className="editor-export-btn editor-export-btn--primary" onClick={onDone} title="Finish — send to the corner HUD">
        <Check size={16} strokeWidth={1.75} /> Done
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/lib/editor.ts glint/src/views/editor/ExportBar.tsx
git commit -m "feat(p12): Done button hands the edit off to the bottom-left HUD"
```

---

### Task 12: Green gate + isolation + at-screen acceptance

**Files:** none (verification only).

- [ ] **Step 1: Full frontend gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest green (63 prior + the new model/store cases).

- [ ] **Step 2: Full Rust gate** (stop the dev exe first if needed)

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: build Finished; tests ok (103 prior + `decode_png_arg`).

- [ ] **Step 3: Recorder isolation greps** (must stay clean — this phase shouldn't touch recorder)

Run (from `glint/src-tauri/src`):
`grep -rnE "use .*(crate::)?(capture|editor|overlay|ocr)::" recorder/` → expect no matches (exit 1)
`grep -rnE "use .*(crate::)?recorder::" ocr/` → expect no matches (exit 1)

- [ ] **Step 4: At-screen acceptance** (`npm run tauri dev`) — verify:
  - **Done:** annotate a capture → Done → editor hides, bottom-left HUD shows the annotated image; Copy, Save, drag-out, Annotate, Dismiss all act on the edited result.
  - **Fill/opacity:** rect + ellipse take a translucent fill; opacity slider works; "no fill" restores stroke-only.
  - **Dashed:** line/arrow/rect/ellipse dashed toggle renders dashes.
  - **Arrow start-head:** arrow shows a head at both ends when enabled.
  - **45°:** holding Shift while drawing a line/arrow snaps to 0/45/90/….
  - **Duplicate:** Ctrl+D clones offset + selects; **nudge:** arrow keys move (Shift = 10px); **z-order:** Ctrl+]/[ reorder overlapping shapes.
  - **Per-tool style memory:** a red arrow doesn't recolor the next rectangle.
  - **Undo/redo** covers duplicate, nudge, z-order; existing tools unaffected.

- [ ] **Step 5: Merge to master**

```bash
git checkout master
git merge --no-ff phase-12-editor-essentials -m "Merge Phase 12 — editor essentials + Done->HUD hand-off"
```

---

## Self-Review

- **Spec coverage:** Done→HUD (T10–T11, hide-on-success) ✓; fill+opacity (T1,T6,T8) ✓; dashed (T1,T6,T8) ✓; arrow start-head (T1,T6,T8) ✓; 45° constrain (T2,T7) ✓; duplicate (T3,T5,T9) ✓; nudge (T3,T5,T9) ✓; z-order (T3,T5,T9) ✓; per-tool style memory (T4) ✓; tests (T1–T5,T10) ✓; isolation + at-screen (T12) ✓.
- **Placeholder scan:** none — every code step is concrete.
- **Type consistency:** `duplicate/bringForward/sendBackward/nudge/toolStyles` names match across store + EditorView; `snapAngle` signature matches EditorStage use; `editorDone`↔`editor_done` (camelCase `pngBase64` → `png_base64`) matches the existing `editor_copy` convention; `LastCapture` fields (`path,width,height,rgba,saved`) match `capture/mod.rs`.
