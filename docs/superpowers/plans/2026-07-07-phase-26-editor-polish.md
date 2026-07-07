# Phase 26 — Editor Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-region spotlight plus four developer-oriented editor wins (per-tool style persistence, eyedropper, shortcuts cheatsheet, copy/export at 2×) to Glint's annotation editor.

**Architecture:** Front-end only (TypeScript/React/Konva) in the capture/editor path. Multi-region spotlight uses one shared dim layer with N cut-outs (Approach B) instead of per-annotation dim layers. Pure helpers are unit-tested (vitest, node env — no DOM/canvas/RTL); localStorage and canvas access live behind thin impure wrappers; UI/render/interaction is verified at-screen.

**Tech Stack:** React 19, TypeScript, Zustand (`useEditorStore`), Konva/react-konva, Vitest, lucide-react icons.

## Global Constraints

- **Recorder isolation (SACRED):** touch only `glint/src/editor/**` and `glint/src/views/editor/**` (+ `glint/src/views/EditorView.tsx`). Do NOT touch `recorder/`, `settings/`, or any recorder path. No Rust changes.
- **Green gate (run from `glint/`):** `npx tsc --noEmit` (0 errors) and `npx vitest run` (all pass). tsconfig has `noUnusedLocals`/`noUnusedParameters: true` — no unused imports/params. From `glint/src-tauri`: `cargo clippy --all-targets` and `cargo test` stay clean (unchanged).
- **Test env is `node`** (no jsdom): unit tests must be pure — no `document`, `localStorage`, `canvas`, or React rendering in tests.
- **No annotation-model schema change** — existing `.glint` docs must load unchanged. New preferences (`toolStyles`, `exportScale`) live in `localStorage`, never in the doc.
- **Commit trailer on every commit (verbatim):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```

---

### Task 1: Per-tool style persistence

Persist the editor's existing in-session `toolStyles` map to `localStorage` so preferred per-tool colors/sizes survive editor reopen and app restart.

**Files:**
- Create: `glint/src/editor/toolStylePersistence.ts`
- Create: `glint/src/editor/toolStylePersistence.test.ts`
- Modify: `glint/src/editor/useEditorStore.ts` (import + `INITIAL.toolStyles`, `setStyle`, `reset`, `loadDoc`)

**Interfaces:**
- Produces: `serializeToolStyles(map: ToolStyles): string`, `parseToolStyles(raw: string | null): ToolStyles`, `loadToolStyles(): ToolStyles`, `saveToolStyles(map: ToolStyles): void`, `type ToolStyles = Partial<Record<ToolId, Style>>`.

- [ ] **Step 1: Write the failing test**

Create `glint/src/editor/toolStylePersistence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeToolStyles, parseToolStyles } from "./toolStylePersistence";
import { DEFAULT_STYLE } from "./model";

describe("toolStyle persistence", () => {
  it("round-trips a map through serialize → parse", () => {
    const map = { arrow: { ...DEFAULT_STYLE, color: "#ff0000" } };
    expect(parseToolStyles(serializeToolStyles(map))).toEqual(map);
  });
  it("returns {} for null / empty", () => {
    expect(parseToolStyles(null)).toEqual({});
    expect(parseToolStyles("")).toEqual({});
  });
  it("returns {} for malformed JSON", () => {
    expect(parseToolStyles("{not json")).toEqual({});
  });
  it("returns {} for a non-object payload", () => {
    expect(parseToolStyles("[1,2,3]")).toEqual({});
    expect(parseToolStyles("42")).toEqual({});
  });
  it("drops entries whose value isn't a style-shaped object", () => {
    const raw = JSON.stringify({ arrow: { color: "#123456", strokeWidth: 4 }, rect: "nope", bad: null });
    const out = parseToolStyles(raw);
    expect(Object.keys(out)).toEqual(["arrow"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/toolStylePersistence.test.ts`
Expected: FAIL — cannot find module `./toolStylePersistence`.

- [ ] **Step 3: Write minimal implementation**

Create `glint/src/editor/toolStylePersistence.ts`:

```ts
import type { Style, ToolId } from "./model";

export type ToolStyles = Partial<Record<ToolId, Style>>;

const KEY = "glint.editor.toolStyles";

/** Serialize the per-tool style map to a JSON string. */
export function serializeToolStyles(map: ToolStyles): string {
  return JSON.stringify(map);
}

/** Parse a stored per-tool style map. Returns {} on any malformed input so a
 *  corrupt value degrades to defaults rather than throwing. Entries are kept
 *  only when the value looks like a Style (has a string `color`). */
export function parseToolStyles(raw: string | null): ToolStyles {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: ToolStyles = {};
    for (const [k, style] of Object.entries(v as Record<string, unknown>)) {
      if (style && typeof style === "object" && typeof (style as Style).color === "string") {
        out[k as ToolId] = style as Style;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Read the persisted map from localStorage (impure; safe in non-browser envs). */
export function loadToolStyles(): ToolStyles {
  try {
    return parseToolStyles(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

/** Persist the map to localStorage (impure; best-effort). */
export function saveToolStyles(map: ToolStyles): void {
  try {
    localStorage.setItem(KEY, serializeToolStyles(map));
  } catch {
    /* ignore — persistence is best-effort */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/toolStylePersistence.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire persistence into the store**

In `glint/src/editor/useEditorStore.ts`:

Add the import near the other editor imports (after the `./model` import block):

```ts
import { loadToolStyles, saveToolStyles } from "./toolStylePersistence";
```

Change `INITIAL.toolStyles` (currently `toolStyles: {} as Partial<Record<ToolId, Style>>,`) to hydrate from storage:

```ts
  toolStyles: loadToolStyles(),
```

Change `setStyle` to persist on every change:

```ts
  setStyle: (patch) =>
    set((s) => {
      const style = { ...s.style, ...patch };
      const toolStyles = { ...s.toolStyles, [s.tool]: style };
      saveToolStyles(toolStyles);
      return { style, toolStyles };
    }),
```

Change `reset` to keep persisted styles (re-read fresh) instead of wiping:

```ts
  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE }, toolStyles: loadToolStyles(), frame: freshFrame() }),
```

In `loadDoc`, DELETE the line `toolStyles: {},` (opening a doc must keep the persisted per-tool preferences — they are not document state).

- [ ] **Step 6: Run the green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest pass (existing + 5 new).

- [ ] **Step 7: Commit**

```bash
git add glint/src/editor/toolStylePersistence.ts glint/src/editor/toolStylePersistence.test.ts glint/src/editor/useEditorStore.ts
git commit -m "feat(p26): persist per-tool editor styles across sessions"
```

---

### Task 2: Multi-region spotlight (shared dim layer)

Replace per-spotlight dim layers with one shared dim layer that dims the screenshot once and cuts N holes; keep each spotlight an ordinary annotation.

**Files:**
- Create: `glint/src/views/editor/SpotlightDimLayer.tsx`
- Modify: `glint/src/editor/model.ts` (add `resolveSpotlightDim`)
- Modify: `glint/src/editor/model.test.ts` (test `resolveSpotlightDim`)
- Modify: `glint/src/editor/useEditorStore.ts` (add `setSpotlightDim`)
- Modify: `glint/src/editor/useEditorStore.test.ts` (test `setSpotlightDim`)
- Modify: `glint/src/views/editor/AnnotationNode.tsx` (reduce `SpotlightRegion` to hit-rect only; drop its `baseWidth`/`baseHeight` props)
- Modify: `glint/src/views/editor/EditorStage.tsx` (render `SpotlightDimLayer` at bottom of the annotations group)
- Modify: `glint/src/views/editor/StyleBar.tsx` (`applyDim` → `setSpotlightDim`)

**Interfaces:**
- Consumes: `BoxAnno`, `Annotation` (from `./model`); `Style.fillOpacity`, `Style.region` (existing).
- Produces:
  - `resolveSpotlightDim(annotations: Annotation[], selectedId: string | null): number`
  - store action `setSpotlightDim(v: number): void`
  - `<SpotlightDimLayer regions={BoxAnno[]} dim={number} baseWidth={number} baseHeight={number} />`

- [ ] **Step 1: Write the failing tests (pure helper + store action)**

Add to `glint/src/editor/model.test.ts` (import `resolveSpotlightDim`, `DEFAULT_STYLE`, and the `Annotation` type from `./model` if not already imported; build spotlight annos inline so the test doesn't depend on any factory):

```ts
describe("resolveSpotlightDim", () => {
  const spot = (id: string, dim: number): Annotation => ({
    id, type: "spotlight", z: 0,
    style: { ...DEFAULT_STYLE, fillOpacity: dim, region: "rect" },
    x: 0, y: 0, w: 10, h: 10,
  });
  it("defaults to 0.6 when there are no spotlights", () => {
    expect(resolveSpotlightDim([], null)).toBe(0.6);
  });
  it("uses the selected spotlight's fillOpacity", () => {
    expect(resolveSpotlightDim([spot("a", 0.3), spot("b", 0.8)], "b")).toBe(0.8);
  });
  it("falls back to the first spotlight when none is selected", () => {
    expect(resolveSpotlightDim([spot("a", 0.4)], null)).toBe(0.4);
  });
});
```

Add to `glint/src/editor/useEditorStore.test.ts` (follow the file's existing store-test pattern; call `reset()` first for isolation):

```ts
describe("setSpotlightDim", () => {
  it("sets fillOpacity on every spotlight, leaving other annotations untouched", () => {
    const s = useEditorStore.getState();
    s.reset();
    s.add({ id: "s1", type: "spotlight", z: 0, style: { ...DEFAULT_STYLE, fillOpacity: 0.6, region: "rect" }, x: 0, y: 0, w: 10, h: 10 });
    s.add({ id: "s2", type: "spotlight", z: 0, style: { ...DEFAULT_STYLE, fillOpacity: 0.6, region: "ellipse" }, x: 5, y: 5, w: 10, h: 10 });
    s.add({ id: "r1", type: "rect", z: 0, style: { ...DEFAULT_STYLE }, x: 0, y: 0, w: 4, h: 4 });
    useEditorStore.getState().setSpotlightDim(0.25);
    const out = useEditorStore.getState().annotations;
    expect(out.filter((a) => a.type === "spotlight").every((a) => a.style.fillOpacity === 0.25)).toBe(true);
    expect(out.find((a) => a.id === "r1")!.style.fillOpacity).toBeUndefined();
  });
});
```

(If `DEFAULT_STYLE` isn't already imported in `useEditorStore.test.ts`, add it to the imports from `./model`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/model.test.ts src/editor/useEditorStore.test.ts`
Expected: FAIL — `resolveSpotlightDim`/`setSpotlightDim` not defined.

- [ ] **Step 3: Add `resolveSpotlightDim` to `model.ts`**

Append to `glint/src/editor/model.ts` (after the existing box helpers). It relies on the existing `BoxAnno`/`Annotation` types:

```ts
/** The single dim value the shared spotlight overlay renders at: the selected
 *  spotlight's opacity if one is selected, else the first spotlight's, else the
 *  default 0.6. (The StyleBar keeps all spotlights equal, so this is unambiguous.) */
export function resolveSpotlightDim(annotations: Annotation[], selectedId: string | null): number {
  const spots = annotations.filter((a): a is BoxAnno => a.type === "spotlight");
  const sel = spots.find((a) => a.id === selectedId);
  return (sel ?? spots[0])?.style.fillOpacity ?? 0.6;
}
```

- [ ] **Step 4: Add `setSpotlightDim` to the store**

In `glint/src/editor/useEditorStore.ts`, add to the `EditorState` interface (near `setStyle`):

```ts
  /** Set the shared spotlight dim on ALL spotlight annotations at once (the dim is
      one property of the whole effect since they share a single overlay). */
  setSpotlightDim: (v: number) => void;
```

And add the action to the store object (near `setStyle`):

```ts
  setSpotlightDim: (v) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.type === "spotlight" ? { ...a, style: { ...a.style, fillOpacity: v } } : a,
      ),
      dirty: true,
    })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/model.test.ts src/editor/useEditorStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the shared dim layer component**

Create `glint/src/views/editor/SpotlightDimLayer.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Group, Rect, Ellipse } from "react-konva";
import type Konva from "konva";
import type { BoxAnno } from "../../editor/model";

/** One dim overlay for the WHOLE spotlight effect: a full-image dim rect with one
 *  destination-out cut-out per spotlight region. Cached so the composite is isolated
 *  to this group's buffer (it must not erase the base image beneath). Rendered at the
 *  bottom of the annotation group, so it dims the screenshot while every annotation
 *  stays bright on top. Renders nothing when there are no spotlights. */
export function SpotlightDimLayer({
  regions, dim, baseWidth, baseHeight,
}: {
  regions: BoxAnno[];
  dim: number;
  baseWidth: number;
  baseHeight: number;
}) {
  const ref = useRef<Konva.Group>(null);
  // Re-cache when geometry / dim / base size changes. `sig` is a stable string of
  // the region rects so a new filtered array each render doesn't thrash the cache.
  const sig = regions.map((a) => `${a.id}:${a.x},${a.y},${a.w},${a.h},${a.style.region ?? "rect"}`).join("|");
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.cache({ x: 0, y: 0, width: baseWidth, height: baseHeight });
    node.getLayer()?.batchDraw();
  }, [sig, dim, baseWidth, baseHeight]);

  if (regions.length === 0) return null;

  return (
    <Group ref={ref} listening={false} x={0} y={0}>
      <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={dim} />
      {regions.map((a) => {
        const x = Math.min(a.x, a.x + a.w);
        const y = Math.min(a.y, a.y + a.h);
        const w = Math.abs(a.w);
        const h = Math.abs(a.h);
        return (a.style.region ?? "rect") === "ellipse" ? (
          <Ellipse
            key={a.id}
            x={x + w / 2} y={y + h / 2}
            radiusX={w / 2} radiusY={h / 2}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        ) : (
          <Rect
            key={a.id}
            x={x} y={y} width={w} height={h}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        );
      })}
    </Group>
  );
}
```

- [ ] **Step 7: Reduce `SpotlightRegion` to the hit-rect only**

In `glint/src/views/editor/AnnotationNode.tsx`:

Change the `case "spotlight"` block so it no longer passes `baseWidth`/`baseHeight`:

```tsx
    case "spotlight": {
      const a = anno as BoxAnno;
      return (
        <SpotlightRegion
          a={a}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
```

Replace the whole `SpotlightRegion` function (currently draws a cached dim Group + hit-rect) with a hit-rect-only version — the dim now lives in `SpotlightDimLayer`:

```tsx
/** A spotlight annotation is now ONLY an invisible, hittable rect for selection +
 *  drag/resize/delete. The actual dim + bright cut-out is drawn once for all
 *  spotlights by <SpotlightDimLayer> (see EditorStage). */
function SpotlightRegion({
  a, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  return (
    // Invisible (opacity 0) but fully hittable — Konva's hit canvas ignores opacity.
    <Rect
      id={a.id}
      x={x} y={y} width={w} height={h}
      fill="#ffffff" opacity={0}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
    />
  );
}
```

Remove any now-unused imports in `AnnotationNode.tsx` (e.g. if `useEffect`/`Ellipse` were used ONLY by the old spotlight dim group and nowhere else — check before removing; `Ellipse` is still used by SpotlightDimLayer's file, not this one). Run tsc in Step 9 to catch unused symbols.

- [ ] **Step 8: Render the shared dim layer in `EditorStage`**

In `glint/src/views/editor/EditorStage.tsx`:

Add imports:

```tsx
import { resolveSpotlightDim, type BoxAnno } from "../../editor/model";
import { SpotlightDimLayer } from "./SpotlightDimLayer";
```

(Merge `resolveSpotlightDim`/`BoxAnno` into the existing `../../editor/model` import if you prefer a single import line — keep the existing named imports too.)

Inside the annotations clip `<Group>` (the one wrapping `annotations.map(...)`), add `SpotlightDimLayer` as the FIRST child, immediately before `{annotations.map(...)}`:

```tsx
            <SpotlightDimLayer
              regions={annotations.filter((a): a is BoxAnno => a.type === "spotlight")}
              dim={resolveSpotlightDim(annotations, selectedId)}
              baseWidth={base.width}
              baseHeight={base.height}
            />
            {annotations.map((a) => (
```

- [ ] **Step 9: Point the StyleBar dim slider at all spotlights**

In `glint/src/views/editor/StyleBar.tsx`, add the store selector near the other selectors:

```tsx
  const setSpotlightDim = useEditorStore((s) => s.setSpotlightDim);
```

Change `applyDim` so it updates the tool default AND every spotlight together (drop the `patchSelected`, since `setSpotlightDim` covers the selected one too):

```tsx
  const applyDim = (fillOpacity: number) => { setStyle({ fillOpacity }); setSpotlightDim(fillOpacity); };
```

- [ ] **Step 10: Run the green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean (fix any unused import flagged in AnnotationNode.tsx); all vitest pass.

- [ ] **Step 11: Manual at-screen check**

Take a screenshot → Annotate → Spotlight tool. Draw two+ regions (rect and ellipse). Verify: background dims once (no darker overlap band), every region is bright; drag/resize/delete each region independently; the dim slider moves all regions' darkness together; add an arrow — it stays fully visible over the dim; Copy/Export bakes the multi-region spotlight correctly.

- [ ] **Step 12: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts glint/src/views/editor/SpotlightDimLayer.tsx glint/src/views/editor/AnnotationNode.tsx glint/src/views/editor/EditorStage.tsx glint/src/views/editor/StyleBar.tsx
git commit -m "feat(p26): multi-region spotlight via one shared dim layer"
```

---

### Task 3: Eyedropper / color picker

Add a pick-mode that samples a pixel from the base screenshot and sets it as the current color.

**Files:**
- Create: `glint/src/editor/eyedropper.ts`
- Create: `glint/src/editor/eyedropper.test.ts`
- Modify: `glint/src/editor/useEditorStore.ts` (add `picking` + `setPicking`)
- Modify: `glint/src/views/editor/EditorStage.tsx` (pick-on-click + cursor)
- Modify: `glint/src/views/editor/StyleBar.tsx` (eyedropper button)
- Modify: `glint/src/views/EditorView.tsx` (`i` shortcut, Esc cancels)

**Interfaces:**
- Produces: `rgbToHex(r,g,b): string`, `pixelToHex(data: Uint8ClampedArray, width: number, x: number, y: number): string | null`, `sampleColorAt(image: CanvasImageSource, iw: number, ih: number, x: number, y: number): string | null`; store `picking: boolean` + `setPicking(v: boolean): void`.

- [ ] **Step 1: Write the failing test (pure helpers)**

Create `glint/src/editor/eyedropper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rgbToHex, pixelToHex } from "./eyedropper";

describe("rgbToHex", () => {
  it("formats channels as lowercase 6-digit hex", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
    expect(rgbToHex(255, 128, 0)).toBe("#ff8000");
  });
});

describe("pixelToHex", () => {
  // 2x1 image: pixel(0)=red, pixel(1)=green (RGBA rows).
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  it("reads the pixel at (x,y) using row-major RGBA", () => {
    expect(pixelToHex(data, 2, 0, 0)).toBe("#ff0000");
    expect(pixelToHex(data, 2, 1, 0)).toBe("#00ff00");
  });
  it("returns null when out of bounds", () => {
    expect(pixelToHex(data, 2, -1, 0)).toBeNull();
    expect(pixelToHex(data, 2, 2, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/eyedropper.test.ts`
Expected: FAIL — cannot find module `./eyedropper`.

- [ ] **Step 3: Write the implementation**

Create `glint/src/editor/eyedropper.ts`:

```ts
/** Format an 8-bit RGB triple as a lowercase #rrggbb string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Read the pixel at (x,y) from a row-major RGBA buffer. Null if out of bounds. */
export function pixelToHex(data: Uint8ClampedArray, width: number, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= width) return null;
  const i = (y * width + x) * 4;
  if (i < 0 || i + 2 >= data.length) return null;
  return rgbToHex(data[i], data[i + 1], data[i + 2]);
}

/** Draw the image to an offscreen canvas and read the pixel at (x,y) in image
 *  pixels. Impure (needs a DOM canvas) — not unit-tested; the pixel math is in
 *  pixelToHex. Returns null out of bounds or if a 2D context is unavailable. */
export function sampleColorAt(
  image: CanvasImageSource, iw: number, ih: number, x: number, y: number,
): string | null {
  if (x < 0 || y < 0 || x >= iw || y >= ih) return null;
  const canvas = document.createElement("canvas");
  canvas.width = iw;
  canvas.height = ih;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, iw, ih);
  return pixelToHex(data, iw, x, y);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/eyedropper.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Add pick state to the store**

In `glint/src/editor/useEditorStore.ts`: add `picking: false,` to `INITIAL`; add `picking: boolean;` and `setPicking: (v: boolean) => void;` to the `EditorState` interface; add the action:

```ts
  setPicking: (v) => set({ picking: v }),
```

- [ ] **Step 6: Sample on click in `EditorStage`**

In `glint/src/views/editor/EditorStage.tsx`:

Add the import: `import { sampleColorAt } from "../../editor/eyedropper";`
Add selectors near the others: `const picking = useEditorStore((s) => s.picking);` and `const setPicking = useEditorStore((s) => s.setPicking);` and `const setStyle = useEditorStore((s) => s.setStyle);`

At the TOP of `onDown` (before the `crop`/`eraser`/`select` branches):

```tsx
    // Eyedropper: sample the pixel under the pointer from the base screenshot,
    // set it as the current color, and exit pick mode. No draw, no history.
    if (picking) {
      const { x, y } = imgPoint(stage);
      const hex = sampleColorAt(base.image, base.width, base.height, Math.round(x), Math.round(y));
      if (hex) setStyle({ color: hex });
      setPicking(false);
      return;
    }
```

Update the Stage `style.cursor` expression to show a crosshair while picking:

```tsx
        style={{ cursor: picking ? "crosshair" : tool === "select" ? "default" : tool === "eraser" ? eraserCursor : "crosshair" }}
```

- [ ] **Step 7: Add the eyedropper button to the StyleBar**

In `glint/src/views/editor/StyleBar.tsx`:

Add `Pipette` to the lucide import: `import { ArrowLeftRight, Pipette } from "lucide-react";`
Add selectors: `const picking = useEditorStore((s) => s.picking);` and `const setPicking = useEditorStore((s) => s.setPicking);`

Inside the `editor-swatches` div, after the custom-color `<label>`, add:

```tsx
        <button
          className={`editor-swatch editor-eyedrop${picking ? " editor-eyedrop--active" : ""}`}
          title="Pick a color from the image (I)"
          aria-label="Eyedropper"
          onClick={() => setPicking(!picking)}
        >
          <Pipette size={14} strokeWidth={1.75} />
        </button>
```

Add matching CSS to `glint/src/views/editor/editor.css` (near the `.editor-swatch` rules):

```css
.editor-eyedrop { display: inline-flex; align-items: center; justify-content: center; color: var(--text, #fff); }
.editor-eyedrop--active { outline: 2px solid var(--accent); outline-offset: 1px; }
```

- [ ] **Step 8: Wire the `i` shortcut + Esc cancel in `EditorView`**

In `glint/src/views/EditorView.tsx`, inside `onKey` — after the modifier-guarded block but where single keys are handled — add an `i` branch that toggles pick mode instead of selecting a tool, and make Escape cancel picking. Add near the top of the single-key handling (before the `keys[...]` tool lookup, and note `i` is intentionally NOT in the `keys` map):

```tsx
      if (e.key === "Escape") {
        useEditorStore.getState().setPicking(false);
        return;
      }
      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        const st = useEditorStore.getState();
        st.setPicking(!st.picking);
        return;
      }
```

(Place these after the `if (e.ctrlKey || e.metaKey || e.altKey) return;` guard so `i` only fires unmodified.)

- [ ] **Step 9: Run the green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest pass.

- [ ] **Step 10: Manual at-screen check**

In the editor, click the eyedropper (or press `i`) — cursor becomes a crosshair; click a colored area of the screenshot; the current color swatch updates to that pixel's color and pick mode exits. Draw an annotation — it uses the picked color. Press `i` then Esc — pick mode cancels.

- [ ] **Step 11: Commit**

```bash
git add glint/src/editor/eyedropper.ts glint/src/editor/eyedropper.test.ts glint/src/editor/useEditorStore.ts glint/src/views/editor/EditorStage.tsx glint/src/views/editor/StyleBar.tsx glint/src/views/editor/editor.css glint/src/views/EditorView.tsx
git commit -m "feat(p26): eyedropper — pick annotation color from the screenshot"
```

---

### Task 4: Shortcuts cheatsheet

A `?`-triggered modal listing every editor shortcut, driven from a single static table.

**Files:**
- Create: `glint/src/editor/shortcuts.ts`
- Create: `glint/src/editor/shortcuts.test.ts`
- Create: `glint/src/views/editor/ShortcutCheatsheet.tsx`
- Modify: `glint/src/views/editor/editor.css` (overlay styles)
- Modify: `glint/src/views/EditorView.tsx` (`?` opens it; state + render)

**Interfaces:**
- Produces: `interface ShortcutGroup { title: string; items: { keys: string; label: string }[] }`, `const SHORTCUTS: ShortcutGroup[]`, `<ShortcutCheatsheet open={boolean} onClose={() => void} />`.

- [ ] **Step 1: Write the failing test (pure data)**

Create `glint/src/editor/shortcuts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SHORTCUTS } from "./shortcuts";

describe("SHORTCUTS table", () => {
  it("has non-empty groups, each with at least one item", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const g of SHORTCUTS) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.items.length).toBeGreaterThan(0);
    }
  });
  it("documents the core tools including the new eyedropper", () => {
    const all = SHORTCUTS.flatMap((g) => g.items);
    expect(all.some((i) => i.keys === "V" && /select/i.test(i.label))).toBe(true);
    expect(all.some((i) => i.keys === "I" && /eyedropper/i.test(i.label))).toBe(true);
    expect(all.some((i) => i.keys === "F" && /spotlight/i.test(i.label))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/shortcuts.test.ts`
Expected: FAIL — cannot find module `./shortcuts`.

- [ ] **Step 3: Write the shortcuts table**

Create `glint/src/editor/shortcuts.ts` (keys mirror `EditorView`'s tool map + actions — keep this the single documented source):

```ts
export interface ShortcutGroup {
  title: string;
  items: { keys: string; label: string }[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Tools",
    items: [
      { keys: "V", label: "Select" },
      { keys: "A", label: "Arrow" },
      { keys: "L", label: "Line" },
      { keys: "R", label: "Rectangle" },
      { keys: "O", label: "Ellipse" },
      { keys: "T", label: "Text" },
      { keys: "P", label: "Pen" },
      { keys: "H", label: "Highlighter" },
      { keys: "B", label: "Blur" },
      { keys: "K", label: "Redact" },
      { keys: "F", label: "Spotlight" },
      { keys: "S", label: "Step number" },
      { keys: "E", label: "Eraser" },
      { keys: "C", label: "Crop" },
      { keys: "I", label: "Eyedropper" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: "Ctrl+Z", label: "Undo" },
      { keys: "Ctrl+Shift+Z", label: "Redo" },
      { keys: "Ctrl+D", label: "Duplicate selection" },
      { keys: "Del", label: "Delete selection" },
      { keys: "Arrows", label: "Nudge 1px" },
      { keys: "Shift+Arrows", label: "Nudge 10px" },
    ],
  },
  {
    title: "File",
    items: [
      { keys: "Ctrl+S", label: "Save project" },
      { keys: "?", label: "Show this cheatsheet" },
      { keys: "Esc", label: "Close / cancel" },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/shortcuts.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the overlay component**

Create `glint/src/views/editor/ShortcutCheatsheet.tsx`:

```tsx
import { SHORTCUTS } from "../../editor/shortcuts";

/** Modal cheatsheet listing every editor shortcut. Rendered by EditorView; opens
 *  on `?`, closes on backdrop click or Esc (handled by the parent). */
export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="editor-cheatsheet-backdrop" onClick={onClose}>
      <div className="editor-cheatsheet" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="editor-cheatsheet-title">Keyboard shortcuts</div>
        <div className="editor-cheatsheet-cols">
          {SHORTCUTS.map((g) => (
            <div key={g.title} className="editor-cheatsheet-group">
              <div className="editor-cheatsheet-group-title">{g.title}</div>
              {g.items.map((i) => (
                <div key={i.keys + i.label} className="editor-cheatsheet-row">
                  <kbd className="editor-cheatsheet-kbd">{i.keys}</kbd>
                  <span>{i.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add overlay CSS**

Append to `glint/src/views/editor/editor.css`:

```css
.editor-cheatsheet-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.editor-cheatsheet {
  background: var(--panel, #16171c); color: var(--text, #fff);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
  padding: 20px 24px; max-width: 640px; max-height: 80vh; overflow: auto;
  box-shadow: 0 12px 48px rgba(0,0,0,0.5);
}
.editor-cheatsheet-title { font-size: 15px; font-weight: 700; margin-bottom: 14px; }
.editor-cheatsheet-cols { display: flex; gap: 32px; flex-wrap: wrap; }
.editor-cheatsheet-group { min-width: 170px; }
.editor-cheatsheet-group-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.6; margin-bottom: 8px; }
.editor-cheatsheet-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; font-size: 13px; }
.editor-cheatsheet-kbd {
  min-width: 92px; font-family: ui-monospace, monospace; font-size: 11px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 5px; padding: 2px 6px; text-align: center;
}
```

- [ ] **Step 7: Open it from `EditorView`**

In `glint/src/views/EditorView.tsx`:

Add imports: `import { useState } from "react";` (merge into the existing `react` import) and `import { ShortcutCheatsheet } from "./editor/ShortcutCheatsheet";`

Add state near the top of the component: `const [cheatsheetOpen, setCheatsheetOpen] = useState(false);`

In `onKey`, add a `?` handler (place it near the top, before the tool-key lookup — `?` is Shift+/, so it survives the modifier guard only if handled before it; add it right after the INPUT/TEXTAREA guard):

```tsx
      if (e.key === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
        return;
      }
```

Add `setCheatsheetOpen(false)` to the Escape handling (in the same file's Task 3 Escape branch, extend it):

```tsx
      if (e.key === "Escape") {
        setCheatsheetOpen(false);
        useEditorStore.getState().setPicking(false);
        return;
      }
```

Add `cheatsheetOpen` to the effect's dependency array (the `onKey` effect deps list) so the handler closure sees current state — since `onKey` reads it via the functional updater `setCheatsheetOpen((v) => !v)`, no dep is strictly needed for that, but `ShortcutCheatsheet` render below uses the state. Render it at the end of the returned JSX (just before the closing `</div>` of `editor-view`):

```tsx
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
```

- [ ] **Step 8: Run the green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest pass.

- [ ] **Step 9: Manual at-screen check**

In the editor press `?` — the cheatsheet opens listing Tools / Editing / File shortcuts. Click the backdrop or press Esc — it closes.

- [ ] **Step 10: Commit**

```bash
git add glint/src/editor/shortcuts.ts glint/src/editor/shortcuts.test.ts glint/src/views/editor/ShortcutCheatsheet.tsx glint/src/views/editor/editor.css glint/src/views/EditorView.tsx
git commit -m "feat(p26): editor shortcuts cheatsheet (?)"
```

---

### Task 5: Copy / export at 2×

A `1× / 2×` toggle in the export bar that multiplies the export pixel ratio for Copy / Export / Drag.

**Files:**
- Create: `glint/src/editor/exportScale.ts`
- Create: `glint/src/editor/exportScale.test.ts`
- Modify: `glint/src/views/editor/ExportBar.tsx` (toggle + scale wiring)
- Modify: `glint/src/views/editor/editor.css` (toggle styles, optional — reuse existing button classes if present)

**Interfaces:**
- Produces: `type ExportScale = 1 | 2`, `parseExportScale(raw: string | null): ExportScale`, `loadExportScale(): ExportScale`, `saveExportScale(s: ExportScale): void`, `scaledPixelRatio(baseRatio: number, scale: ExportScale): number`.

- [ ] **Step 1: Write the failing test (pure helpers)**

Create `glint/src/editor/exportScale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseExportScale, scaledPixelRatio } from "./exportScale";

describe("parseExportScale", () => {
  it("returns 2 only for the string '2'", () => {
    expect(parseExportScale("2")).toBe(2);
  });
  it("defaults to 1 for anything else", () => {
    expect(parseExportScale("1")).toBe(1);
    expect(parseExportScale(null)).toBe(1);
    expect(parseExportScale("junk")).toBe(1);
  });
});

describe("scaledPixelRatio", () => {
  it("multiplies the base ratio by the scale", () => {
    expect(scaledPixelRatio(3, 1)).toBe(3);
    expect(scaledPixelRatio(3, 2)).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/editor/exportScale.test.ts`
Expected: FAIL — cannot find module `./exportScale`.

- [ ] **Step 3: Write the implementation**

Create `glint/src/editor/exportScale.ts`:

```ts
export type ExportScale = 1 | 2;

const KEY = "glint.editor.exportScale";

/** Only the literal "2" means 2×; everything else (incl. null/garbage) → 1×. */
export function parseExportScale(raw: string | null): ExportScale {
  return raw === "2" ? 2 : 1;
}

export function loadExportScale(): ExportScale {
  try {
    return parseExportScale(localStorage.getItem(KEY));
  } catch {
    return 1;
  }
}

export function saveExportScale(s: ExportScale): void {
  try {
    localStorage.setItem(KEY, String(s));
  } catch {
    /* ignore — best-effort */
  }
}

/** The flatten pixel ratio at the chosen export scale. */
export function scaledPixelRatio(baseRatio: number, scale: ExportScale): number {
  return baseRatio * scale;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/editor/exportScale.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire scale into `ExportBar`**

In `glint/src/views/editor/ExportBar.tsx`:

Add imports:

```tsx
import { useState } from "react";
import { scaledPixelRatio, loadExportScale, saveExportScale, type ExportScale } from "../../editor/exportScale";
```

Change `flatten` to accept a scale and multiply the pixel ratio:

```tsx
function flatten(stage: Konva.Stage, scale: ExportScale): string {
  const { base, crop, frame } = useEditorStore.getState();
  if (!base) return "";
  const stageW = stage.width();
  if (!stageW) return "";
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }
  const layout = computeLayout(base.width, base.height, crop, frame);
  const pixelRatio = scaledPixelRatio(exportPixelRatio(layout, stageW), scale); // native × scale
  let url: string;
  try {
    url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
  } finally {
    if (tr) { tr.nodes(hadNodes); tr.getLayer()?.batchDraw(); }
  }
  return url.split(",")[1] ?? "";
}
```

In the `ExportBar` component, add scale state and thread it through. Replace the `withPng` helper and `onDrag` to pass `scale` (Done stays native = 1):

```tsx
  const [scale, setScale] = useState<ExportScale>(loadExportScale);

  const withPng = (fn: (png: string) => Promise<void>, s: ExportScale = scale) => async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, s);
    if (!png) { pushToast("Couldn't render the image"); return; }
    try { await fn(png); } catch { pushToast("Something went wrong"); }
  };
```

Update `onDrag` to pass scale:

```tsx
    const png = flatten(stage, scale);
```

Update `onDone` to force native scale:

```tsx
  const onDone = withPng(async (png) => { await editorDone(png); }, 1);
```

Add the toggle UI at the START of the returned toolbar (before the Drag button):

```tsx
      <div className="editor-scale" role="group" aria-label="Export scale">
        {([1, 2] as ExportScale[]).map((s) => (
          <button
            key={s}
            className={`editor-scale-btn${scale === s ? " editor-scale-btn--active" : ""}`}
            onClick={() => { setScale(s); saveExportScale(s); }}
            title={s === 2 ? "Export at 2× (sharper vector layers; larger file)" : "Export at native resolution"}
          >
            {s}×
          </button>
        ))}
      </div>
```

- [ ] **Step 6: Add toggle CSS**

Append to `glint/src/views/editor/editor.css`:

```css
.editor-scale { display: inline-flex; gap: 2px; margin-right: 6px; }
.editor-scale-btn {
  height: 28px; min-width: 30px; padding: 0 8px; border: none; border-radius: 6px;
  background: rgba(255,255,255,0.08); color: var(--text, #fff); cursor: pointer; font-size: 12px;
}
.editor-scale-btn--active { background: var(--accent); color: #fff; }
```

- [ ] **Step 7: Run the green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all vitest pass.

- [ ] **Step 8: Manual at-screen check**

In the editor, toggle 2×, add an arrow + frame, then Export. The saved PNG has 2× the pixel dimensions and the vector layers (arrow, frame, text) look crisper; Copy pastes the 2× image. Toggle back to 1× and Done (which stays native). Reopen the editor — the toggle remembers your last choice.

- [ ] **Step 9: Commit**

```bash
git add glint/src/editor/exportScale.ts glint/src/editor/exportScale.test.ts glint/src/views/editor/ExportBar.tsx glint/src/views/editor/editor.css
git commit -m "feat(p26): copy/export at 2x (sharper vector layers)"
```

---

### Task 6: Full green gate + roadmap update

Final verification of the whole phase and roadmap bookkeeping.

**Files:**
- Modify: `docs/superpowers/ROADMAP.md` (add Phase 24, 25, 26 entries under Shipped; note packaging is next)

- [ ] **Step 1: Full frontend green gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; ALL vitest pass (existing + new: toolStylePersistence, model `resolveSpotlightDim`, store `setSpotlightDim`, eyedropper, shortcuts, exportScale).

- [ ] **Step 2: Confirm the recorder path is untouched (isolation)**

Run: `cd "C:/Users/sanir/Claude Code" && git diff --name-only master -- glint/src-tauri glint/src/recorder`
Expected: NO output (zero files changed under the Rust/recorder paths).

- [ ] **Step 3: Rust gate still green (unchanged tree)**

Run: `cd glint/src-tauri && cargo clippy --all-targets --quiet && cargo test --quiet`
Expected: clippy clean; tests pass.

- [ ] **Step 4: Update the ROADMAP**

In `docs/superpowers/ROADMAP.md`, under `## Shipped`, add concise entries for Phase 24 (perf polish), Phase 25 (developer polish — redact/spotlight/delayed-capture/video-presets + recording-start polish), and Phase 26 (this phase). Under `## Planned`, replace the "(none…)" line with a note that **packaging/distribution is the only remaining phase**.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/ROADMAP.md
git commit -m "docs(p26): roadmap — phases 24-26 shipped; packaging is next"
```

- [ ] **Step 6: At-screen acceptance (manual, before merge to master)**

Verify all five features at-screen (multi-region spotlight, per-tool style persistence across restart, eyedropper, `?` cheatsheet, 2× export). Only after acceptance, merge `phase-26-editor-polish` → `master` with `--no-ff` (per project convention).

---

## Notes for the implementer

- **Branch:** create `phase-26-editor-polish` off `master` before Task 1 (`git checkout -b phase-26-editor-polish`).
- **`master` is the base branch** for this project (not `main`). Merge at the end with `--no-ff` only after at-screen acceptance.
- Each task is independently testable and committable; run the green gate at the end of every task, not just at the end.
