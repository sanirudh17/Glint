# Glint Phase 5b — Crop + Backgrounds/Framing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-destructive, serializable composition layer to the annotation editor — crop the screenshot and wrap it in a solid/gradient/transparent background with padding, rounded corners, drop shadow, and aspect presets — rendered live in Konva and flattened at native resolution through the existing export path.

**Architecture:** A pure `composition.ts` module computes all layout math (crop content, padding, aspect letterboxing, export pixel-ratio) and is unit-tested in isolation. The Zustand store gains serializable `crop` + `frame` state (crop joins the undo snapshot; frame styling is live). `EditorStage` is restructured to render the composition: a background layer, the screenshot as a rounded/shadowed card showing the cropped region via Konva's `Image.crop`, and the annotation layer offset onto the screenshot and clipped to it. A `CropOverlay` drives crop mode and a `FramePanel` drives the frame controls. Export reuses `stage.toDataURL` with the pixel-ratio from `composition.ts`.

**Tech Stack:** React 19, TypeScript 5.8, Zustand 5, konva 9 / react-konva 19, Vitest 3, Vite 7. Tauri v2 (Rust) — **no Rust changes this phase**.

## Global Constraints

- **Local-first.** No network/cloud/uploads/accounts. Gradients are computed color-stop arrays — **no bundled image assets, no downloads**.
- **Recorder isolation.** The editor path stays free of any ffmpeg/scap/recorder dependency. (No new Rust deps this phase.)
- **Non-destructive.** Crop and frame are stored as state and applied at render/export. Original capture pixels are never modified or discarded.
- **Serializable.** `crop` and `frame` are plain JSON-able data (sets up 5c `.glint` persistence).
- **Padding mapping (verbatim):** `paddingPx = round(padding/100 * 0.25 * max(contentW, contentH))` — slider 0–100, ceiling ≈ 25% of the content's long edge per side.
- **Aspect ratios:** `auto` (none), `1:1` (1), `16:9` (16/9), `4:3` (4/3). Letterbox by enlarging the deficient axis; content never shrinks; content re-centers.
- **Frame defaults:** `{ enabled:false, background:{type:"gradient", gradientId:<first preset id>}, padding:40, radius:12, shadow:35, aspect:"auto" }`. With `enabled:false` and `crop:null` the editor is byte-identical to today.
- **Verification gate per task:** `cd glint && npx tsc --noEmit && npx vite build` clean (the pre-existing Konva chunk-size warning is allowed); plus `npx vitest run` for tasks with tests. Commit on branch `phase-5b-composition`, message ending with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File structure

- **Create** `glint/src/editor/composition.ts` — pure layout math (`Crop`, `Layout`, `computeLayout`, `exportPixelRatio`, `normalizeRect`). Tested.
- **Create** `glint/src/editor/composition.test.ts`.
- **Create** `glint/src/editor/gradients.ts` — `GradientPreset`, `GRADIENTS`, `getGradient`, `konvaGradient`. Tested.
- **Create** `glint/src/editor/gradients.test.ts`.
- **Create** `glint/src/editor/palette.ts` — shared `PALETTE` swatch colors (DRY between StyleBar + FramePanel).
- **Create** `glint/src/views/editor/CropOverlay.tsx` — crop-mode rectangle UI.
- **Create** `glint/src/views/editor/FramePanel.tsx` — frame controls panel.
- **Modify** `glint/src/editor/model.ts` — `ToolId` gains `"crop"`.
- **Modify** `glint/src/editor/useEditorStore.ts` — `crop` + `frame` state, actions, crop-in-history.
- **Modify** `glint/src/views/editor/EditorStage.tsx` — composition layout, background layer, screenshot card, annotation offset/clip, crop mode.
- **Modify** `glint/src/views/editor/ToolRail.tsx` — Crop tool button.
- **Modify** `glint/src/views/editor/StyleBar.tsx` — use shared `PALETTE`.
- **Modify** `glint/src/views/editor/ExportBar.tsx` — native pixel-ratio via `exportPixelRatio`.
- **Modify** `glint/src/views/EditorView.tsx` — Frame toggle + mount `FramePanel`.
- **Modify** `glint/src/views/editor/editor.css` — frame panel, crop overlay, slider styles.

---

## Task 1: Pure composition layout module (TDD)

**Files:**
- Create: `glint/src/editor/composition.ts`
- Test: `glint/src/editor/composition.test.ts`

**Interfaces:**
- Produces: `Crop` `{x,y,w,h}`; `AspectId = "auto"|"1:1"|"16:9"|"4:3"`; `FrameLayoutInput` (the layout-relevant frame fields); `Layout` `{contentW,contentH,contentX,contentY,compositionW,compositionH,paddingPx,cropX,cropY}`; `computeLayout(imageW,imageH,crop,frame)`, `exportPixelRatio(layout,stageW)`, `normalizeRect(r)`.

- [ ] **Step 1: Write the failing tests**

`glint/src/editor/composition.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeLayout, exportPixelRatio, normalizeRect, type FrameLayoutInput } from "./composition";

const off: FrameLayoutInput = { enabled: false, padding: 0, radius: 0, shadow: 0, aspect: "auto" };
const on = (over: Partial<FrameLayoutInput> = {}): FrameLayoutInput =>
  ({ enabled: true, padding: 100, radius: 0, shadow: 0, aspect: "auto", ...over });

describe("composition", () => {
  it("frame off → composition equals content, no offset", () => {
    const l = computeLayout(800, 600, null, off);
    expect(l).toMatchObject({
      contentW: 800, contentH: 600, contentX: 0, contentY: 0,
      compositionW: 800, compositionH: 600, paddingPx: 0, cropX: 0, cropY: 0,
    });
  });

  it("crop sets content size and crop origin", () => {
    const l = computeLayout(800, 600, { x: 100, y: 50, w: 400, h: 200 }, off);
    expect(l).toMatchObject({ contentW: 400, contentH: 200, cropX: 100, cropY: 50, compositionW: 400 });
  });

  it("padding 100 adds 25% of the long edge per side", () => {
    const l = computeLayout(400, 200, null, on({ padding: 100 })); // paddingPx = round(0.25*400)=100
    expect(l.paddingPx).toBe(100);
    expect(l.compositionW).toBe(600);
    expect(l.compositionH).toBe(400);
    expect(l.contentX).toBe(100);
    expect(l.contentY).toBe(100);
  });

  it("aspect 1:1 enlarges the deficient axis and re-centers", () => {
    // content 400x200, padding 100 → 600x400, then 1:1 → 600x600
    const l = computeLayout(400, 200, null, on({ padding: 100, aspect: "1:1" }));
    expect(l.compositionW).toBe(600);
    expect(l.compositionH).toBe(600);
    expect(l.contentX).toBe(100); // (600-400)/2
    expect(l.contentY).toBe(200); // (600-200)/2
  });

  it("aspect 16:9 widens a too-tall composition", () => {
    // content 200x200, padding 0... use padding 0 → comp 200x200, 16:9 → W=round(200*16/9)=356
    const l = computeLayout(200, 200, null, on({ padding: 0, aspect: "16:9" }));
    expect(l.compositionH).toBe(200);
    expect(l.compositionW).toBe(Math.round(200 * (16 / 9)));
  });

  it("exportPixelRatio maps stage width back to native composition", () => {
    const l = computeLayout(600, 400, null, off);
    expect(exportPixelRatio(l, 300)).toBe(2);
    expect(exportPixelRatio(l, 0)).toBe(1); // guard
  });

  it("normalizeRect folds a negative (up-left) drag", () => {
    expect(normalizeRect({ x: 100, y: 100, w: -40, h: -20 })).toEqual({ x: 60, y: 80, w: 40, h: 20 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd glint && npx vitest run src/editor/composition.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `composition.ts`**

```ts
/**
 * composition.ts — pure layout math for the editor's composition (crop + frame).
 *
 * No Konva, no React, no state. Given the base image size, an optional crop, and
 * the layout-relevant frame fields, it computes the framed output geometry in
 * image-native pixels (the "composition" space). Unit-tested in isolation.
 */
export interface Crop { x: number; y: number; w: number; h: number }

export type AspectId = "auto" | "1:1" | "16:9" | "4:3";

/** The frame fields that affect layout (background/colour are irrelevant here). */
export interface FrameLayoutInput {
  enabled: boolean;
  padding: number; // 0–100
  radius: number;
  shadow: number;
  aspect: AspectId;
}

export interface Layout {
  contentW: number; contentH: number;        // cropped screenshot size (native px)
  contentX: number; contentY: number;        // screenshot top-left within the composition
  compositionW: number; compositionH: number; // full framed output size (native px)
  paddingPx: number;                          // resolved padding, per side
  cropX: number; cropY: number;               // crop origin in image space (0,0 when uncropped)
}

const ASPECT_RATIO: Record<AspectId, number | null> = {
  auto: null,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
};

/** Fold a possibly-negative drag rect into a normalized {x,y,w,h} with positive size. */
export function normalizeRect(r: { x: number; y: number; w: number; h: number }): Crop {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function computeLayout(
  imageW: number,
  imageH: number,
  crop: Crop | null,
  frame: FrameLayoutInput,
): Layout {
  const cropX = crop ? crop.x : 0;
  const cropY = crop ? crop.y : 0;
  const contentW = crop ? crop.w : imageW;
  const contentH = crop ? crop.h : imageH;

  if (!frame.enabled) {
    return {
      contentW, contentH, contentX: 0, contentY: 0,
      compositionW: contentW, compositionH: contentH,
      paddingPx: 0, cropX, cropY,
    };
  }

  const paddingPx = Math.round((frame.padding / 100) * 0.25 * Math.max(contentW, contentH));
  let compW = contentW + paddingPx * 2;
  let compH = contentH + paddingPx * 2;

  const ratio = ASPECT_RATIO[frame.aspect];
  if (ratio) {
    // Enlarge whichever single axis is deficient so compW/compH === ratio.
    if (compW / compH < ratio) compW = Math.round(compH * ratio);
    else compH = Math.round(compW / ratio);
  }

  return {
    contentW, contentH,
    contentX: Math.round((compW - contentW) / 2),
    contentY: Math.round((compH - contentH) / 2),
    compositionW: compW, compositionH: compH,
    paddingPx, cropX, cropY,
  };
}

/** Pixel ratio that flattens the scaled-down stage back to native composition pixels. */
export function exportPixelRatio(layout: Layout, stageW: number): number {
  return stageW > 0 ? layout.compositionW / stageW : 1;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint && npx vitest run src/editor/composition.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/composition.ts glint/src/editor/composition.test.ts
git commit -m "feat(p5b): pure composition layout module (crop + frame geometry) [TDD]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Gradient presets (TDD)

**Files:**
- Create: `glint/src/editor/gradients.ts`
- Test: `glint/src/editor/gradients.test.ts`

**Interfaces:**
- Produces: `GradientStop`, `GradientPreset {id,label,stops,angleDeg}`, `GRADIENTS: GradientPreset[]`, `getGradient(id): GradientPreset` (falls back to first), `konvaGradient(preset,w,h)` → `{ fillLinearGradientStartPoint, fillLinearGradientEndPoint, fillLinearGradientColorStops }`.

- [ ] **Step 1: Write the failing tests**

`glint/src/editor/gradients.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { GRADIENTS, getGradient, konvaGradient } from "./gradients";

describe("gradients", () => {
  it("has at least 6 presets with unique ids", () => {
    expect(GRADIENTS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(GRADIENTS.map((g) => g.id)).size).toBe(GRADIENTS.length);
  });

  it("getGradient returns the match, else the first preset", () => {
    expect(getGradient(GRADIENTS[1].id)).toBe(GRADIENTS[1]);
    expect(getGradient("nope")).toBe(GRADIENTS[0]);
  });

  it("konvaGradient flattens stops to [offset,color,...]", () => {
    const g = { id: "x", label: "X", angleDeg: 0, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const k = konvaGradient(g, 100, 50);
    expect(k.fillLinearGradientColorStops).toEqual([0, "#000", 1, "#fff"]);
  });

  it("konvaGradient at 0deg runs left→right across the rect", () => {
    const g = { id: "x", label: "X", angleDeg: 0, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const k = konvaGradient(g, 100, 50);
    expect(k.fillLinearGradientStartPoint).toEqual({ x: 0, y: 25 });
    expect(k.fillLinearGradientEndPoint).toEqual({ x: 100, y: 25 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd glint && npx vitest run src/editor/gradients.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `gradients.ts`**

```ts
/**
 * gradients.ts — curated background gradient presets (local-first; no assets).
 * Each preset is a list of color stops + an angle; konvaGradient() turns it into
 * react-konva linear-gradient props sized to a w×h rect.
 */
export interface GradientStop { offset: number; color: string }
export interface GradientPreset { id: string; label: string; stops: GradientStop[]; angleDeg: number }

export const GRADIENTS: GradientPreset[] = [
  { id: "dusk",    label: "Dusk",    angleDeg: 135, stops: [{ offset: 0, color: "#5B7CFA" }, { offset: 1, color: "#9D6CFF" }] },
  { id: "sunset",  label: "Sunset",  angleDeg: 135, stops: [{ offset: 0, color: "#FF7E5F" }, { offset: 1, color: "#FEB47B" }] },
  { id: "ocean",   label: "Ocean",   angleDeg: 135, stops: [{ offset: 0, color: "#2E3192" }, { offset: 1, color: "#1BFFFF" }] },
  { id: "forest",  label: "Forest",  angleDeg: 135, stops: [{ offset: 0, color: "#11998E" }, { offset: 1, color: "#38EF7D" }] },
  { id: "ember",   label: "Ember",   angleDeg: 135, stops: [{ offset: 0, color: "#F12711" }, { offset: 1, color: "#F5AF19" }] },
  { id: "slate",   label: "Slate",   angleDeg: 135, stops: [{ offset: 0, color: "#232526" }, { offset: 1, color: "#414345" }] },
  { id: "rose",    label: "Rose",    angleDeg: 135, stops: [{ offset: 0, color: "#ED4264" }, { offset: 1, color: "#FFEDBC" }] },
  { id: "mint",    label: "Mint",    angleDeg: 135, stops: [{ offset: 0, color: "#43C6AC" }, { offset: 1, color: "#F8FFAE" }] },
];

export function getGradient(id: string): GradientPreset {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[0];
}

export function konvaGradient(preset: GradientPreset, w: number, h: number): {
  fillLinearGradientStartPoint: { x: number; y: number };
  fillLinearGradientEndPoint: { x: number; y: number };
  fillLinearGradientColorStops: (number | string)[];
} {
  const rad = (preset.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  // Span the gradient across the rect's projection onto the angle direction.
  const len = Math.abs(dx) * w + Math.abs(dy) * h;
  return {
    fillLinearGradientStartPoint: { x: cx - (dx * len) / 2, y: cy - (dy * len) / 2 },
    fillLinearGradientEndPoint: { x: cx + (dx * len) / 2, y: cy + (dy * len) / 2 },
    fillLinearGradientColorStops: preset.stops.flatMap((s) => [s.offset, s.color]),
  };
}
```

- [ ] **Step 4: Run to verify pass** — `cd glint && npx vitest run src/editor/gradients.test.ts` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/gradients.ts glint/src/editor/gradients.test.ts
git commit -m "feat(p5b): curated gradient presets + konva linear-gradient helper [TDD]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Store crop + frame state, crop-in-history, ToolId, shared palette (TDD)

**Files:**
- Modify: `glint/src/editor/model.ts` (`ToolId` += `"crop"`)
- Create: `glint/src/editor/palette.ts`
- Modify: `glint/src/editor/useEditorStore.ts`
- Modify: `glint/src/editor/useEditorStore.test.ts`
- Modify: `glint/src/views/editor/StyleBar.tsx` (use shared `PALETTE`)

**Interfaces:**
- Consumes: `Crop` (Task 1), `GRADIENTS` (Task 2), `Annotation`/`Style`/`ToolId` (model).
- Produces: store fields `crop: Crop | null`, `frame: FrameConfig`; actions `setCrop(c)`, `resetCrop()`, `setFrame(patch)`, `toggleFrame(on?)`, `resetFrame()`; history snapshot type `DocSnapshot = { annotations: Annotation[]; crop: Crop | null }`. `FrameConfig`, `FrameBackground` types. `PALETTE: string[]`.

- [ ] **Step 1: Add `"crop"` to `ToolId` in `model.ts`**

```ts
export type ToolId =
  | "select" | "arrow" | "line" | "rect" | "ellipse"
  | "text" | "pen" | "highlight" | "blur" | "step" | "crop";
```

- [ ] **Step 2: Create `glint/src/editor/palette.ts`**

```ts
/** Shared quick-swatch colors for the style bar and the frame background picker. */
export const PALETTE = ["#E5484D", "#F5A623", "#30A46C", "#3B82F6", "#111111", "#FFFFFF"];
```

- [ ] **Step 3: Point StyleBar at the shared palette**

In `glint/src/views/editor/StyleBar.tsx`, remove the local `const COLORS = [...]` and instead:
```ts
import { PALETTE as COLORS } from "../../editor/palette";
```
(Leave the rest of StyleBar unchanged.)

- [ ] **Step 4: Write the failing store tests**

Append to `glint/src/editor/useEditorStore.test.ts`:
```ts
import type { Crop } from "./composition";

describe("useEditorStore — composition", () => {
  it("setCrop / resetCrop update crop", () => {
    const c: Crop = { x: 1, y: 2, w: 3, h: 4 };
    useEditorStore.getState().setCrop(c);
    expect(useEditorStore.getState().crop).toEqual(c);
    useEditorStore.getState().resetCrop();
    expect(useEditorStore.getState().crop).toBeNull();
  });

  it("crop is part of the undo snapshot", () => {
    const s = useEditorStore.getState();
    s.pushHistory();           // snapshot { annotations: [], crop: null }
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.undo();
    expect(useEditorStore.getState().crop).toBeNull();
    s.redo();
    expect(useEditorStore.getState().crop).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("setFrame merges, toggleFrame flips enabled, resetFrame restores defaults", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 80 });
    expect(useEditorStore.getState().frame.padding).toBe(80);
    s.toggleFrame(true);
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    s.resetFrame();
    expect(useEditorStore.getState().frame.padding).toBe(40);
    expect(useEditorStore.getState().frame.enabled).toBe(false);
  });

  it("frame changes do NOT push history", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 99 });
    expect(useEditorStore.getState().past).toEqual([]);
  });
});
```

- [ ] **Step 5: Run to verify it fails** — `cd glint && npx vitest run src/editor/useEditorStore.test.ts` → FAIL (no setCrop etc.).

- [ ] **Step 6: Extend the store**

In `glint/src/editor/useEditorStore.ts`:

Add imports + types:
```ts
import type { Crop } from "./composition";
import { GRADIENTS } from "./gradients";

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

interface DocSnapshot { annotations: Annotation[]; crop: Crop | null }

export const DEFAULT_FRAME: FrameConfig = {
  enabled: false,
  background: { type: "gradient", gradientId: GRADIENTS[0].id },
  padding: 40,
  radius: 12,
  shadow: 35,
  aspect: "auto",
};
```

Extend `EditorState` with:
```ts
  crop: Crop | null;
  frame: FrameConfig;
  past: DocSnapshot[];
  future: DocSnapshot[];

  setCrop: (c: Crop) => void;
  resetCrop: () => void;
  setFrame: (patch: Partial<FrameConfig>) => void;
  toggleFrame: (on?: boolean) => void;
  resetFrame: () => void;
```
(Change `past`/`future` from `Annotation[][]` to `DocSnapshot[]`.)

Update `INITIAL`:
```ts
const INITIAL = {
  base: null as EditorBase | null,
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  tool: "select" as ToolId,
  style: { ...DEFAULT_STYLE },
  crop: null as Crop | null,
  frame: { ...DEFAULT_FRAME, background: { ...DEFAULT_FRAME.background } } as FrameConfig,
  past: [] as DocSnapshot[],
  future: [] as DocSnapshot[],
};
```
And `reset` re-clones the frame too:
```ts
reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE }, frame: { ...DEFAULT_FRAME, background: { ...DEFAULT_FRAME.background } } }),
```

Rewrite history + add actions (snapshot/restore now carry crop):
```ts
  pushHistory: () => set((s) => ({ past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [] })),

  setCrop: (c) => set({ crop: c }),
  resetCrop: () => set({ crop: null }),
  setFrame: (patch) => set((s) => ({ frame: { ...s.frame, ...patch } })),
  toggleFrame: (on) => set((s) => ({ frame: { ...s.frame, enabled: on ?? !s.frame.enabled } })),
  resetFrame: () => set({ frame: { ...DEFAULT_FRAME, background: { ...DEFAULT_FRAME.background } } }),

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
```
Also update `clearAll` to snapshot a `DocSnapshot` (keep current crop):
```ts
  clearAll: () =>
    set((s) =>
      s.annotations.length
        ? { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: [], selectedId: null }
        : s,
    ),
```

- [ ] **Step 7: Run to verify pass** — `cd glint && npx vitest run` → all pass (existing 15 + new). Confirm the existing undo/redo annotation tests still pass (snapshot shape changed but annotations restore identically).

- [ ] **Step 8: Typecheck + build** — `cd glint && npx tsc --noEmit && npx vite build` → clean.

- [ ] **Step 9: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/palette.ts glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts glint/src/views/editor/StyleBar.tsx
git commit -m "feat(p5b): store crop + frame state, crop in undo history, shared palette [TDD]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: EditorStage composition layout + annotation offset (frame OFF identity)

**Goal:** Restructure `EditorStage` to drive geometry from `computeLayout`, render the base image at the content offset with Konva's `Image.crop`, and offset+clip the annotation layer — such that with `frame.enabled=false` and `crop=null` the editor behaves byte-identically to today. No frame visuals yet.

**Files:**
- Modify: `glint/src/views/editor/EditorStage.tsx`

**Interfaces:**
- Consumes: `computeLayout`, `Layout` (Task 1); store `crop`, `frame` (Task 3).

- [ ] **Step 1: Compute layout + stage size from composition**

Replace the scale/size block. After reading `base`, `crop`, `frame` from the store and the `box` viewport state:
```ts
import { computeLayout } from "../../editor/composition";
// ...
const crop = useEditorStore((s) => s.crop);
const frame = useEditorStore((s) => s.frame);
// ...
const layout = base
  ? computeLayout(base.width, base.height, crop, frame)
  : null;
const compW = layout?.compositionW ?? 1;
const compH = layout?.compositionH ?? 1;
const scale = layout ? fitScale(box.w, box.h, compW, compH) : 1;
```
(Keep the existing `fitScale` and `box`/`ResizeObserver` logic. `scale` is still hoisted above the hooks; guard `base`/`layout` null.)

- [ ] **Step 2: Pointer math accounts for the content offset**

The annotation layer is offset so image point `(cropX, cropY)` maps to `(contentX, contentY)`. Pointer → image space must invert that:
```ts
const imgPoint = (stage: Konva.Stage) => {
  const p = stage.getPointerPosition();
  if (!p || !layout) return { x: 0, y: 0 };
  // screen → composition (÷scale) → image (subtract content offset, add crop origin)
  return {
    x: p.x / scale - layout.contentX + layout.cropX,
    y: p.y / scale - layout.contentY + layout.cropY,
  };
};
```

- [ ] **Step 3: Stage + base image + offset/clipped annotation layer**

```tsx
const stageW = Math.max(1, Math.round(compW * scale));
const stageH = Math.max(1, Math.round(compH * scale));
const offX = layout!.contentX - layout!.cropX;
const offY = layout!.contentY - layout!.cropY;

return (
  <div className="editor-canvas" ref={wrapRef}>
    <Stage
      ref={ref}
      width={stageW}
      height={stageH}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onDblClick={onDblClick}
      style={{ cursor: tool === "select" ? "default" : "crosshair" }}
    >
      {/* Screenshot layer (background + frame visuals added in Task 5). */}
      <Layer listening={false}>
        <KonvaImage
          image={base.image}
          x={layout!.contentX}
          y={layout!.contentY}
          width={layout!.contentW}
          height={layout!.contentH}
          crop={{ x: layout!.cropX, y: layout!.cropY, width: layout!.contentW, height: layout!.contentH }}
        />
      </Layer>

      {/* Annotations: offset onto the screenshot and clipped to its bounds. */}
      <Layer
        ref={layerRef}
        x={offX}
        y={offY}
        clipX={layout!.cropX}
        clipY={layout!.cropY}
        clipWidth={layout!.contentW}
        clipHeight={layout!.contentH}
      >
        {annotations.map((a) => ( /* unchanged AnnotationNode map */ ))}
        <Transformer /* unchanged */ />
      </Layer>
    </Stage>
    {/* text-edit textarea overlay — unchanged, but see Step 4 */}
  </div>
);
```
Notes: the clip is expressed in the layer's **own** coordinate space (which, after the `x/y` offset, equals image space), so clip at `(cropX, cropY, contentW, contentH)`. With `crop=null` that's `(0,0,imageW,imageH)`; with frame off, `offX/offY=0` → identical to today.

- [ ] **Step 4: Text-edit overlay position accounts for the offset**

In the `editBox` layout effect, map image coords through the same offset:
```ts
setEditBox({
  left: cont.left + (editing.x - layout.cropX + layout.contentX) * scale,
  top: cont.top + (editing.y - layout.cropY + layout.contentY) * scale,
  fontSize: editing.style.fontSize * scale,
});
```
(Add `layout` to the effect deps. When frame off + no crop this equals the old `editing.x * scale`.)

- [ ] **Step 5: Typecheck + build** — `cd glint && npx tsc --noEmit && npx vite build` → clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/editor/EditorStage.tsx
git commit -m "refactor(p5b): drive EditorStage geometry from computeLayout (frame-off identity)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Reviewer/at-screen note: with frame off + no crop the editor must look and behave exactly as before (draw, select, move, text-edit, export). This task is the coordinate-restructure de-risking step.

---

## Task 5: EditorStage frame visuals (background + rounded card + shadow)

**Goal:** When `frame.enabled`, render the background fill behind the screenshot and give the screenshot rounded corners + a drop shadow.

**Files:**
- Modify: `glint/src/views/editor/EditorStage.tsx`

**Interfaces:**
- Consumes: `getGradient`, `konvaGradient` (Task 2); `frame.background/radius/shadow` (Task 3); `layout` (Task 4).

- [ ] **Step 1: Background layer**

Add as the **first** (bottom) layer inside the Stage, before the screenshot layer:
```tsx
import { Rect, Group } from "react-konva";
import { getGradient, konvaGradient } from "../../editor/gradients";
// ...
{frame.enabled && frame.background.type !== "transparent" && (
  <Layer listening={false}>
    <Rect
      x={0}
      y={0}
      width={compW}
      height={compH}
      {...(frame.background.type === "solid"
        ? { fill: frame.background.color }
        : konvaGradient(getGradient(frame.background.gradientId), compW, compH))}
    />
  </Layer>
)}
```
(Transparent → no rect → exports with alpha.)

- [ ] **Step 2: Rounded corners + shadow on the screenshot**

Replace the plain screenshot `<KonvaImage>` (Task 4 Step 3) with a shadow card + clipped image, gated by `frame.enabled`:
```tsx
const r = frame.enabled ? frame.radius : 0;
const shadowProps = frame.enabled && frame.shadow > 0
  ? {
      shadowColor: "#000",
      shadowBlur: Math.round((frame.shadow / 100) * 60),
      shadowOpacity: (frame.shadow / 100) * 0.5,
      shadowOffsetY: Math.round((frame.shadow / 100) * 12),
    }
  : {};
// ...
<Layer listening={false}>
  {/* Shadow-casting rounded card behind the image. */}
  {frame.enabled && (
    <Rect
      x={layout!.contentX} y={layout!.contentY}
      width={layout!.contentW} height={layout!.contentH}
      cornerRadius={r} fill="#000" {...shadowProps}
    />
  )}
  {/* Image clipped to the rounded rect. */}
  <Group
    clipFunc={r > 0 ? (ctx) => roundedRectPath(ctx, layout!.contentX, layout!.contentY, layout!.contentW, layout!.contentH, r) : undefined}
  >
    <KonvaImage
      image={base.image}
      x={layout!.contentX} y={layout!.contentY}
      width={layout!.contentW} height={layout!.contentH}
      crop={{ x: layout!.cropX, y: layout!.cropY, width: layout!.contentW, height: layout!.contentH }}
    />
  </Group>
</Layer>
```
Add a small local helper (top of file, module scope):
```ts
function roundedRectPath(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
```
(`ctx` is Konva's `Context`; `clipFunc` receives it. When `r===0`, omit `clipFunc` for a plain rectangle.)

- [ ] **Step 3: Round the annotation clip to match (optional polish)**

Leave the annotation layer's rectangular `clip` from Task 4 (rounded annotation clipping is unnecessary — strokes near the corner are acceptable and rounding a Layer clip is awkward). No change.

- [ ] **Step 4: Typecheck + build** — clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/editor/EditorStage.tsx
git commit -m "feat(p5b): live frame visuals — background fill, rounded screenshot, shadow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> At-screen note: toggling `frame.enabled` (via store/devtools until Task 7's panel lands) should show the screenshot inset on the backdrop with rounded corners + shadow.

---

## Task 6: Crop overlay + crop mode + Crop tool

**Goal:** A `Crop` tool that enters crop mode: a draggable/resizable rectangle over the content; Enter confirms (`pushHistory` + `setCrop`), Esc cancels; a Reset clears the crop.

**Files:**
- Create: `glint/src/views/editor/CropOverlay.tsx`
- Modify: `glint/src/views/editor/EditorStage.tsx` (render overlay in crop mode; suppress normal creation)
- Modify: `glint/src/views/editor/ToolRail.tsx` (Crop tool button)

**Interfaces:**
- Consumes: `normalizeRect` (Task 1), `setCrop`/`resetCrop`/`pushHistory`/`setTool` (Task 3), `layout` (Task 4).
- Produces: `CropOverlay` (props: `layout`, `scale`, `onConfirm(crop)`, `onCancel()`).

- [ ] **Step 1: Crop tool in the rail**

In `ToolRail.tsx` add to the `TOOLS` array (after `step` or grouped sensibly):
```ts
import { Crop as CropIcon } from "lucide-react";
// ...
{ id: "crop", icon: CropIcon, tip: "Crop (C)", key: "C" },
```

- [ ] **Step 2: Crop keyboard shortcut**

In `EditorView.tsx` keyboard map add `c: "crop"`. (The map already ignores INPUT/TEXTAREA.)

- [ ] **Step 3: `CropOverlay.tsx`**

A self-contained crop rectangle drawn in **composition space** (so it overlays the stage 1:1 at `scale`). It manages its own rect state (init to current content bounds), supports drag-move and 8-handle resize, dims the surround, and calls `onConfirm`/`onCancel`. Render it as an absolutely-positioned SVG/div over `.editor-canvas`, or as a Konva layer. Implement as a DOM overlay sized `compW*scale × compH*scale` positioned over the stage:
```tsx
import { useEffect, useRef, useState } from "react";
import type { Layout } from "../../editor/composition";
import { normalizeRect } from "../../editor/composition";

interface Props {
  layout: Layout;
  scale: number;
  onConfirm: (crop: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
}

export function CropOverlay({ layout, scale, onConfirm, onCancel }: Props) {
  // Rect in IMAGE space; initialise to current content.
  const [rect, setRect] = useState({
    x: layout.cropX, y: layout.cropY, w: layout.contentW, h: layout.contentH,
  });
  const drag = useRef<null | { mode: "move" | string; sx: number; sy: number; orig: typeof rect }>(null);

  // image→screen helpers (content offset already folded into layout)
  const toScreen = (ix: number, iy: number) => ({
    left: (layout.contentX + (ix - layout.cropX)) * scale,
    top: (layout.contentY + (iy - layout.cropY)) * scale,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(normalizeRect(rect)); }
      else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect, onConfirm, onCancel]);

  // Pointer math: convert screen delta → image delta (÷scale). Implement move +
  // 8 handles (nw,n,ne,e,se,s,sw,w) adjusting rect, clamped to image bounds
  // [0..imageW]×[0..imageH] (imageW = layout.cropX + ... derive from full image;
  // pass image dims via layout or props). Keep w,h ≥ 1.

  const box = toScreen(rect.x, rect.y);
  return (
    <div className="crop-overlay">
      {/* dim surround via 4 panels or a box-shadow on the selection */}
      <div
        className="crop-rect"
        style={{ left: box.left, top: box.top, width: rect.w * scale, height: rect.h * scale }}
        onPointerDown={/* start move */ undefined}
      >
        {/* 8 handle divs */}
      </div>
      <div className="crop-hint">Drag to crop · Enter to apply · Esc to cancel</div>
    </div>
  );
}
```
> Implementer: model the drag/resize math on the Phase-2 `SelectionLayer` (overlay selection rectangle with 8 handles) — same interaction, simpler output. Clamp the rect within `[0..imageW]×[0..imageH]`; pass the full image dims in (e.g. add `imageW`/`imageH` props). Reuse the dim-surround pattern (a large `box-shadow` on `.crop-rect` is the simplest).

- [ ] **Step 4: Wire crop mode into EditorStage**

```tsx
const setCrop = useEditorStore((s) => s.setCrop);
const setTool = useEditorStore((s) => s.setTool);
// in onDown: when tool === "crop", do nothing (overlay handles interaction)
if (tool === "crop") return;
// ...after </Stage>, inside .editor-canvas:
{tool === "crop" && layout && (
  <CropOverlay
    layout={layout}
    scale={scale}
    imageW={base.width}
    imageH={base.height}
    onConfirm={(c) => { pushHistory(); setCrop(c); setTool("select"); }}
    onCancel={() => setTool("select")}
  />
)}
```
(Add `imageW`/`imageH` to `CropOverlay` props per Step 3.)

- [ ] **Step 5: Reset-crop affordance**

Add a small "Reset crop" button shown only when `crop !== null` — simplest place is the Frame panel (Task 7) or next to the Crop tool. For this task, expose it in the rail as a secondary action OR defer the button to Task 7 and rely on Esc/re-crop. (Plan choice: add it in Task 7's panel.)

- [ ] **Step 6: Typecheck + build** — clean.

- [ ] **Step 7: Commit**

```bash
git add glint/src/views/editor/CropOverlay.tsx glint/src/views/editor/EditorStage.tsx glint/src/views/editor/ToolRail.tsx glint/src/views/EditorView.tsx
git commit -m "feat(p5b): crop tool + crop-mode overlay (drag/resize, Enter apply, Esc cancel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frame panel + toggle + EditorView wiring

**Goal:** A right-docked `FramePanel` with background type, color/gradient pickers, padding/radius/shadow sliders, aspect select, and Reset (frame + crop). A Frame toggle in the top bar opens it and sets `frame.enabled`.

**Files:**
- Create: `glint/src/views/editor/FramePanel.tsx`
- Modify: `glint/src/views/EditorView.tsx` (toggle + mount panel)
- Modify: `glint/src/views/editor/editor.css` (panel, sliders, crop overlay styles)

**Interfaces:**
- Consumes: `frame`, `setFrame`, `toggleFrame`, `resetFrame`, `crop`, `resetCrop` (Task 3); `GRADIENTS` (Task 2); `PALETTE` (Task 3).

- [ ] **Step 1: `FramePanel.tsx`**

```tsx
import { useEditorStore } from "../../editor/useEditorStore";
import { GRADIENTS } from "../../editor/gradients";
import { PALETTE } from "../../editor/palette";

const ASPECTS = ["auto", "1:1", "16:9", "4:3"] as const;

export function FramePanel() {
  const frame = useEditorStore((s) => s.frame);
  const setFrame = useEditorStore((s) => s.setFrame);
  const resetFrame = useEditorStore((s) => s.resetFrame);
  const crop = useEditorStore((s) => s.crop);
  const resetCrop = useEditorStore((s) => s.resetCrop);
  const bg = frame.background;

  return (
    <aside className="frame-panel" aria-label="Frame">
      <div className="frame-row">
        <span className="frame-label">Background</span>
        <div className="frame-seg">
          {(["solid", "gradient", "transparent"] as const).map((t) => (
            <button key={t}
              className={`frame-seg-btn${bg.type === t ? " is-active" : ""}`}
              onClick={() => setFrame({ background:
                t === "solid" ? { type: "solid", color: PALETTE[3] }
                : t === "gradient" ? { type: "gradient", gradientId: GRADIENTS[0].id }
                : { type: "transparent" } })}
            >{t}</button>
          ))}
        </div>
      </div>

      {bg.type === "solid" && (
        <div className="frame-swatches">
          {PALETTE.map((c) => (
            <button key={c} className={`editor-swatch${bg.color.toLowerCase() === c.toLowerCase() ? " editor-swatch--active" : ""}`}
              style={{ background: c }} onClick={() => setFrame({ background: { type: "solid", color: c } })} />
          ))}
          <label className="editor-swatch editor-swatch--custom" style={{ background: bg.color }}>
            <input type="color" value={bg.color} onChange={(e) => setFrame({ background: { type: "solid", color: e.currentTarget.value } })} />
          </label>
        </div>
      )}

      {bg.type === "gradient" && (
        <div className="frame-gradients">
          {GRADIENTS.map((g) => (
            <button key={g.id} title={g.label}
              className={`frame-grad${bg.gradientId === g.id ? " is-active" : ""}`}
              style={{ background: `linear-gradient(135deg, ${g.stops[0].color}, ${g.stops[g.stops.length - 1].color})` }}
              onClick={() => setFrame({ background: { type: "gradient", gradientId: g.id } })} />
          ))}
        </div>
      )}

      <Slider label="Padding" value={frame.padding} onChange={(v) => setFrame({ padding: v })} />
      <Slider label="Radius"  value={frame.radius}  min={0} max={48} onChange={(v) => setFrame({ radius: v })} />
      <Slider label="Shadow"  value={frame.shadow}  onChange={(v) => setFrame({ shadow: v })} />

      <div className="frame-row">
        <span className="frame-label">Aspect</span>
        <div className="frame-seg">
          {ASPECTS.map((a) => (
            <button key={a} className={`frame-seg-btn${frame.aspect === a ? " is-active" : ""}`}
              onClick={() => setFrame({ aspect: a })}>{a}</button>
          ))}
        </div>
      </div>

      <div className="frame-actions">
        {crop && <button className="frame-text-btn" onClick={() => resetCrop()}>Reset crop</button>}
        <button className="frame-text-btn" onClick={() => resetFrame()}>Reset frame</button>
      </div>
    </aside>
  );
}

function Slider({ label, value, min = 0, max = 100, onChange }:
  { label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="frame-slider">
      <span className="frame-label">{label}</span>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))} />
    </label>
  );
}
```

- [ ] **Step 2: Frame toggle + mount in `EditorView`**

Add a `Frame` button between StyleBar and ExportBar that calls `toggleFrame()`, and render `<FramePanel/>` in the main row (right of the stage) when `frame.enabled`:
```tsx
import { Frame as FrameIcon } from "lucide-react";
import { FramePanel } from "./editor/FramePanel";
// in component:
const frameEnabled = useEditorStore((s) => s.frame.enabled);
const toggleFrame = useEditorStore((s) => s.toggleFrame);
// top bar:
<div className="editor-topbar">
  <StyleBar />
  <button className={`editor-export-btn${frameEnabled ? " editor-export-btn--primary" : ""}`} onClick={() => toggleFrame()} title="Frame">
    <FrameIcon size={16} strokeWidth={1.75} /> Frame
  </button>
  <ExportBar stageRef={stageRef} />
</div>
<div className="editor-main">
  <ToolRail />
  <EditorStage ref={stageRef} />
  {frameEnabled && <FramePanel />}
</div>
```

- [ ] **Step 3: CSS (append to `editor.css`)**

Add styles for `.frame-panel` (right-docked, `width: 240px`, `border-left: 1px solid var(--border)`, `background: var(--bg-elev)`, padded column, `overflow-y:auto`), `.frame-row`/`.frame-label`/`.frame-seg`/`.frame-seg-btn` (segmented control using `--accent-subtle`/`--accent` for `.is-active`), `.frame-swatches`/`.frame-gradients` (flex wrap; `.frame-grad` = 24×24 rounded chip, `.is-active` ring `--text`), `.frame-slider` + `input[type=range]` (accent-tinted), `.frame-actions`/`.frame-text-btn` (subtle text buttons), and `.crop-overlay`/`.crop-rect`/`.crop-hint` (absolute fill of `.editor-canvas`; `.crop-rect` = `box-shadow: 0 0 0 9999px rgba(0,0,0,.5)` for the dim surround, `1px solid var(--accent)`, handles = 10px accent squares at the 8 positions). All values from `tokens.css`; verify each token exists before use.

- [ ] **Step 4: Typecheck + build** — clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/editor/FramePanel.tsx glint/src/views/EditorView.tsx glint/src/views/editor/editor.css
git commit -m "feat(p5b): frame panel (background/padding/radius/shadow/aspect) + toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Export at native composition resolution

**Goal:** `ExportBar` flattens the full composition at native resolution via `exportPixelRatio`.

**Files:**
- Modify: `glint/src/views/editor/ExportBar.tsx`

**Interfaces:**
- Consumes: `computeLayout`, `exportPixelRatio` (Task 1); store `base`/`crop`/`frame`.

- [ ] **Step 1: Compute pixel-ratio from the layout, not `base.width`**

Replace the `flatten` helper's ratio. Read `crop`/`frame`/`base` from the store inside `ExportBar`:
```ts
import { computeLayout, exportPixelRatio } from "../../editor/composition";
// ...
const crop = useEditorStore((s) => s.crop);
const frame = useEditorStore((s) => s.frame);
// in flatten(stage):
const layout = computeLayout(base.width, base.height, crop, frame);
const ratio = exportPixelRatio(layout, stage.width());
const url = stage.toDataURL({ pixelRatio: ratio, mimeType: "image/png" });
```
Keep the Transformer hide/restore + zero-stage guard. `flatten` now needs `crop`/`frame`/`base` — pass them in or read from `useEditorStore.getState()` inside the function (preferred, avoids a long signature):
```ts
function flatten(stage: Konva.Stage): string {
  const { base, crop, frame } = useEditorStore.getState();
  if (!base) return "";
  const stageW = stage.width();
  if (!stageW) return "";
  // ...hide transformer...
  const layout = computeLayout(base.width, base.height, crop, frame);
  const ratio = exportPixelRatio(layout, stageW);
  // ...toDataURL with ratio, restore transformer...
}
```
Update the callers (`withPng`, `onDrag`) to call `flatten(stage)` (drop the `base.width` arg).

- [ ] **Step 2: Typecheck + build** — clean.

- [ ] **Step 3: Commit**

```bash
git add glint/src/views/editor/ExportBar.tsx
git commit -m "feat(p5b): export the full framed composition at native resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Green gate + acceptance doc

**Files:**
- Create: `docs/superpowers/PHASE-5B-ACCEPTANCE.md`

- [ ] **Step 1: Full gate**

```bash
cd glint && npx tsc --noEmit && npx vitest run && npx vite build
cd src-tauri && cargo test && cargo clippy --all-targets
```
Expected: tsc clean; vitest all pass (incl. new composition + gradients + store tests); vite build clean (Konva chunk warning only); cargo test unchanged green; clippy 0 warnings. Fix anything that isn't.

- [ ] **Step 2: Write `docs/superpowers/PHASE-5B-ACCEPTANCE.md`**

Mirror the Phase 5a acceptance format: automated-gate table, "what shipped" (crop + frame, non-destructive/serializable, native-res export), and an at-screen manual checklist:
- Frame off + no crop → editor identical to before (draw/select/move/text/export).
- Crop: enter Crop tool, drag/resize, Enter applies, Esc cancels; annotations clip to the crop; Reset crop restores.
- Frame: toggle on → screenshot inset on backdrop; each background (solid swatch/custom, each gradient, transparent); padding/radius/shadow sliders; aspect presets letterbox + center.
- Export fidelity: saved/copied/dragged PNG = native composition size; screenshot region at native resolution; transparent background exports with alpha; no selection chrome baked in.
- Undo: crop is undoable (Ctrl+Z); frame tweaks are live (Reset frame restores).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/PHASE-5B-ACCEPTANCE.md
git commit -m "chore(p5b): green gate + Phase 5b acceptance checklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes (author)

- **Spec coverage:** crop (T3 state, T6 UI) · solid/gradient/transparent (T2, T5, T7) · padding/radius/shadow/aspect (T1 math, T5 render, T7 controls) · live WYSIWYG (T4/T5) · native-res export (T1 `exportPixelRatio`, T8) · serializable + non-destructive (T3 state, Konva `Image.crop`) · pure tested module (T1, T2) · crop in undo (T3). All sections mapped.
- **Type consistency:** `computeLayout`/`exportPixelRatio`/`normalizeRect`, `Layout`, `Crop`, `FrameConfig`/`FrameBackground`, `DocSnapshot`, `getGradient`/`konvaGradient`, `PALETTE` are used with identical names/signatures across tasks.
- **No Rust changes** — export reuses `editor_copy`/`editor_save`/`editor_flatten_temp` unchanged.
- **Risk areas (flag for review):** T4 coordinate restructure (must stay frame-off-identical); T5 rounded-clip + shadow ordering; T6 crop drag/resize math + bounds clamping. These get dedicated reviewers per the cadence; T1/T2/T3 are TDD-covered; T7/T8 inline.
