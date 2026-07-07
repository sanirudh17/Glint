# Phase 25 — Developer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four developer-oriented features to Glint — redaction (solid + pixelate), delayed capture (area/window/fullscreen), video resolution+quality presets, and a screenshot spotlight (rect + ellipse) — matching the approved design spec.

**Architecture:** Editor tools (redact, spotlight) are pure-frontend Konva annotations that bake into the PNG export through the existing stage flatten — siblings of the existing `BlurRegion`, no Rust changes. Delayed capture adds a shared, N-parameterized countdown window (promoted to a neutral module) plus three optional hotkey actions and one duration setting. Video presets add two settings threaded through the ffmpeg argument builder inside recorder isolation.

**Tech Stack:** Tauri v2 (Rust), React 19 + TypeScript, Konva/react-konva, Zustand, Vitest, cargo test, ffmpeg sidecar.

## Global Constraints

- Base branch is `master` (NOT `main`). This work is on branch `phase-25-developer-polish`. Merge with `--no-ff` after at-screen acceptance.
- **Recorder isolation is sacred:** `recorder/` and `settings/` import NOTHING from `capture/`, `editor/`, `overlay/`, or `ocr/`. The reverse (capture calling a *neutral* shared module) is allowed. The countdown must be promoted to a neutral module — capture must not import from `recorder/`.
- **Every action gives immediate visible feedback** (window to front, toasts on failure); never silent.
- **Green gate before every commit that ends a task:** from `glint/src-tauri`: `cargo clippy --all-targets` (0 warnings) + `cargo test`; from `glint`: `npx tsc --noEmit` + `npx vitest run`. tsconfig has `noUnusedLocals`/`noUnusedParameters: true` — no dead code.
- **Commit trailer REQUIRED on every commit** (verbatim, two lines):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```
- Editor annotations are a discriminated union in `src/editor/model.ts`; all model functions are pure and unit-tested. Konva renders FROM the model.
- New editor shortcuts: **K** (redact), **F** (spotlight). Default capture delay: **5s** (options 3/5/10). Solid redact default color black; pixelate `pixelSize` 14. Spotlight default dim opacity 0.6.

---

## File Structure

**Editor (redact + spotlight) — frontend only:**
- Modify `src/editor/model.ts` — add `redact`/`spotlight` to `ToolId`, extend `BoxAnno` union, add `redactStyle` + `region` to `Style`, handle both in `duplicateAnnotation`/`nudgeAnnotation`.
- Modify `src/editor/model.test.ts` — model unit tests.
- Modify `src/views/editor/AnnotationNode.tsx` — add `RedactRegion` + `SpotlightRegion` render nodes and their `switch` cases.
- Modify `src/views/editor/EditorStage.tsx` — draft-draw creation + resize + hit-test for the two new box tools.
- Modify `src/views/editor/ToolRail.tsx` — two new tool buttons (K, F).
- Modify `src/views/editor/StyleBar.tsx` — redact solid/pixelate toggle; spotlight shape toggle + dim slider.

**Delayed capture — backend + settings + frontend:**
- Modify `src-tauri/src/settings/mod.rs` — `capture_delay_secs` field + validation + tests.
- Modify `src-tauri/src/settings/hotkeys.rs` — three delayed actions in the registry + get/set + tests.
- Modify `src-tauri/src/settings/commands.rs` — `action_label` for the three actions.
- Create `src-tauri/src/countdown.rs` — neutral, N-parameterized countdown window (promoted from `recorder/windows.rs`).
- Modify `src-tauri/src/lib.rs` — declare `mod countdown;`.
- Modify `src-tauri/src/recorder/windows.rs` — delegate `build_countdown`/`close_countdown` to the neutral module (N=3).
- Modify `src/recorder/Countdown.tsx` — read start-N from the URL (`?n=`), default 3.
- Modify `src-tauri/src/capture/mod.rs` — `begin_delayed_spawned(app, mode)`.
- Modify `src-tauri/src/shortcuts.rs` — register + dispatch the three delayed actions.
- Modify `src/views/settings/Capture.tsx` — "Capture delay" dropdown.
- Modify `src/views/settings/Hotkeys.tsx` — three delayed rows.
- Modify `src/store/useAppStore.ts` — `capture_delay_secs` type + setter.

**Video presets — backend + settings + frontend:**
- Modify `src-tauri/src/settings/mod.rs` — `record_resolution` + `record_quality` fields + validation + tests.
- Modify `src-tauri/src/recorder/ffmpeg.rs` — `quality_cq`, `scale_filter`, thread through `encoder_args` + `build_ffmpeg_args` + tests.
- Modify `src-tauri/src/recorder/mod.rs` — pass the two settings into `build_ffmpeg_args`.
- Modify `src/views/settings/Recording.tsx` — two dropdowns.
- Modify `src/store/useAppStore.ts` — two types + setters.

**Docs:**
- Create `docs/superpowers/PHASE-25-ACCEPTANCE.md` (final task).

---

## Task 1: Redact — model

**Files:**
- Modify: `src/editor/model.ts`
- Test: `src/editor/model.test.ts`

**Interfaces:**
- Produces: `ToolId` includes `"redact"`; `BoxAnno.type` includes `"redact"`; `Style.redactStyle?: "solid" | "pixelate"`.

- [ ] **Step 1: Write the failing tests**

Add to `src/editor/model.test.ts`:

```ts
import { duplicateAnnotation, nudgeAnnotation, type BoxAnno } from "./model";

function redact(id = "r1"): BoxAnno {
  return { id, type: "redact", z: 0, style: { color: "#000000", strokeWidth: 3, fontSize: 24, redactStyle: "solid" }, x: 10, y: 10, w: 40, h: 20 };
}

test("redact duplicates with fresh id and +12 offset", () => {
  const d = duplicateAnnotation(redact()) as BoxAnno;
  expect(d.type).toBe("redact");
  expect(d.id).not.toBe("r1");
  expect(d.x).toBe(22);
  expect(d.y).toBe(22);
  expect(d.style.redactStyle).toBe("solid");
});

test("redact nudges by delta", () => {
  const n = nudgeAnnotation(redact(), 5, -3) as BoxAnno;
  expect(n.x).toBe(15);
  expect(n.y).toBe(7);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: FAIL — `"redact"` is not assignable to `BoxAnno.type` (tsc/vitest type error), and the `switch` in `duplicateAnnotation` does not handle `"redact"`.

- [ ] **Step 3: Implement the model changes**

In `src/editor/model.ts`:

Add `"redact"` to `ToolId`:
```ts
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
```

Add fields to `Style` (after `arrowStart`):
```ts
  /** arrow tool: also draw a head at the start point; default false. */
  arrowStart?: boolean;
  /** redact tool: "solid" opaque block (default) or "pixelate" mosaic. */
  redactStyle?: "solid" | "pixelate";
  /** spotlight tool: bright-region shape. "rect" (default) or "ellipse". */
  region?: "rect" | "ellipse";
```

Extend `BoxAnno.type`:
```ts
export interface BoxAnno extends Base {
  type: "rect" | "ellipse" | "blur" | "redact" | "spotlight";
  x: number; y: number; w: number; h: number;
}
```

In `duplicateAnnotation`, extend the box case:
```ts
    case "rect":
    case "ellipse":
    case "blur":
    case "redact":
    case "spotlight":
      return { ...(base as BoxAnno), x: a.x + OFF, y: a.y + OFF };
```

In `nudgeAnnotation`, extend the box case:
```ts
    case "rect":
    case "ellipse":
    case "blur":
    case "redact":
    case "spotlight":
    case "text":
    case "step":
      return { ...a, x: a.x + dx, y: a.y + dy };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/model.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts
git commit -m "$(cat <<'EOF'
feat(p25): add redact + spotlight to the editor annotation model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

*(Note: this task also adds `"spotlight"` to `ToolId`/`BoxAnno` so Task 3's model work is already covered here — Task 3 only adds spotlight-specific tests.)*

---

## Task 2: Redact — render + tool wiring

**Files:**
- Modify: `src/views/editor/AnnotationNode.tsx`
- Modify: `src/views/editor/EditorStage.tsx`
- Modify: `src/views/editor/ToolRail.tsx`
- Modify: `src/views/editor/StyleBar.tsx`

**Interfaces:**
- Consumes: `BoxAnno` with `type: "redact"`, `style.redactStyle`.

- [ ] **Step 1: Add the render node in `AnnotationNode.tsx`**

Add a `case "redact"` to the `switch (anno.type)` in `AnnotationNode` (place it right after the `case "blur"` block):

```tsx
    case "redact": {
      const a = anno as BoxAnno;
      return (
        <RedactRegion
          a={a}
          baseImage={baseImage}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
```

Add the `RedactRegion` component below `BlurRegion` (reuses the exact cache-clip pattern; solid draws an opaque rect, pixelate runs the Pixelate filter):

```tsx
/** Redaction: "solid" paints an opaque block (pixels gone from the export);
 * "pixelate" is a cached, mosaic'd copy of the base image clipped to a rect. */
function RedactRegion({
  a, baseImage, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  const pixelate = a.style.redactStyle === "pixelate";

  useEffect(() => {
    const node = ref.current;
    if (!node || !pixelate || w < 1 || h < 1) return;
    node.cache({ x, y, width: w, height: h });
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, baseImage, pixelate]);

  if (w < 1 || h < 1) return null;

  if (!pixelate) {
    // Solid opaque block. The underlying pixels are not present in the export.
    return (
      <Rect
        id={a.id}
        x={x} y={y} width={w} height={h}
        fill={a.style.color}
        draggable={draggable}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragStart={onDragStart}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
      />
    );
  }

  return (
    <Group
      id={a.id}
      ref={ref}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) =>
        onChange({ x: x + e.target.x(), y: y + e.target.y(), w, h } as Partial<Annotation>)
      }
      x={0}
      y={0}
      clipX={x}
      clipY={y}
      clipWidth={w}
      clipHeight={h}
      filters={[Konva.Filters.Pixelate]}
      pixelSize={14}
    >
      <KonvaImage image={baseImage} width={baseWidth} height={baseHeight} listening={false} />
    </Group>
  );
}
```

- [ ] **Step 2: Wire draft-draw in `EditorStage.tsx`**

In the tool `switch` inside the pointer-down handler (around line 279), add a dedicated `redact` case BEFORE the generic box case so it can seed a black solid default:

```ts
      case "redact":
        a = { id, type: "redact", z: 0, style: { ...style, color: "#000000", redactStyle: style.redactStyle ?? "solid" }, x, y, w: 0, h: 0 };
        break;
      case "rect":
      case "ellipse":
      case "blur":
        a = { id, type: tool, z: 0, style: { ...style }, x, y, w: 0, h: 0 };
        break;
```

In the drag-resize handler (around line 335), add `"redact"` to the box condition:

```ts
    } else if (a.type === "rect" || a.type === "ellipse" || a.type === "blur" || a.type === "redact") {
      update(id, { w: x - a.x, h: y - a.y } as Partial<Annotation>);
```

If there is a hit-test/group-walk comment referencing `step/blur Groups` (around line 222), no code change is required there — `id={a.id}` is set on the redact node so `e.target.id()` resolves it.

- [ ] **Step 3: Add the tool button in `ToolRail.tsx`**

Add `EyeOff` to the lucide import line, and add a TOOLS entry after `blur`:

```ts
import {
  MousePointer2, ArrowUpRight, Minus, Square, Circle as CircleIcon,
  Type, Pen, Highlighter, Droplet, EyeOff, Hash, Eraser, Crop as CropIcon, Undo2, Redo2, Trash2, type LucideIcon,
} from "lucide-react";
```
```ts
  { id: "blur",      icon: Droplet,       tip: "Blur (B)",        key: "B" },
  { id: "redact",    icon: EyeOff,        tip: "Redact (K)",      key: "K" },
```

If a keyboard-shortcut map exists in `EditorStage.tsx` (search for `"b"` / `case "b"` / a `key` handler that calls `setTool`), add `k → setTool("redact")` alongside it. If tool keys are derived from the `TOOLS` array's `key` field, no change is needed.

- [ ] **Step 4: Add the solid/pixelate toggle in `StyleBar.tsx`**

After the `isText` block (before the closing `</div>` of the stylebar), add a redact control. First compute a flag near the other `eff*` flags (around line 57):

```ts
  const isRedact = effType === "redact";
```

Add the setter near the other `apply*` helpers (around line 55):

```ts
  const applyRedactStyle = (redactStyle: "solid" | "pixelate") => { setStyle({ redactStyle }); patchSelected({ redactStyle }); };
```

Add the UI (after the `isText` block):

```tsx
      {isRedact && (
        <div className="editor-widths" role="group" aria-label="Redaction style">
          <button
            className={`editor-width${(eff.redactStyle ?? "solid") === "solid" ? " editor-width--active" : ""}`}
            title="Solid block"
            aria-label="Solid block"
            onClick={() => applyRedactStyle("solid")}
          >
            Solid
          </button>
          <button
            className={`editor-width${eff.redactStyle === "pixelate" ? " editor-width--active" : ""}`}
            title="Pixelate"
            aria-label="Pixelate"
            onClick={() => applyRedactStyle("pixelate")}
          >
            Pixel
          </button>
        </div>
      )}
```

- [ ] **Step 5: Verify build + typecheck + run**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean, all vitest pass.

Then manually verify in the app (`npm run tauri dev`): open the editor on a capture, press **K**, drag a box → opaque black block; switch to **Pixel** in the style bar and draw → mosaic; Save/Copy → the block/mosaic is baked into the exported PNG (solid shows no underlying pixels).

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/editor/AnnotationNode.tsx glint/src/views/editor/EditorStage.tsx glint/src/views/editor/ToolRail.tsx glint/src/views/editor/StyleBar.tsx
git commit -m "$(cat <<'EOF'
feat(p25): redact tool — solid block + pixelate, bakes into export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 3: Spotlight — model tests

**Files:**
- Test: `src/editor/model.test.ts`

*(The `spotlight` `ToolId`/`BoxAnno`/`region` model changes were made in Task 1. This task locks in the spotlight-specific model behavior with tests.)*

**Interfaces:**
- Consumes: `BoxAnno` with `type: "spotlight"`, `style.region`, `style.fillOpacity`.

- [ ] **Step 1: Write the failing tests**

Add to `src/editor/model.test.ts`:

```ts
function spotlight(id = "s1"): BoxAnno {
  return { id, type: "spotlight", z: 0, style: { color: "#000000", strokeWidth: 3, fontSize: 24, region: "rect", fillOpacity: 0.6 }, x: 10, y: 10, w: 40, h: 20 };
}

test("spotlight duplicates preserving region + dim", () => {
  const d = duplicateAnnotation(spotlight()) as BoxAnno;
  expect(d.type).toBe("spotlight");
  expect(d.id).not.toBe("s1");
  expect(d.x).toBe(22);
  expect(d.style.region).toBe("rect");
  expect(d.style.fillOpacity).toBe(0.6);
});

test("spotlight nudges by delta", () => {
  const n = nudgeAnnotation(spotlight(), -4, 6) as BoxAnno;
  expect(n.x).toBe(6);
  expect(n.y).toBe(16);
});
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/model.test.ts`
Expected: PASS (the model already supports spotlight from Task 1). If any fail, fix `model.ts` to match.

- [ ] **Step 3: Commit**

```bash
git add glint/src/editor/model.test.ts
git commit -m "$(cat <<'EOF'
test(p25): lock in spotlight model duplicate/nudge behavior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 4: Spotlight — render + tool wiring

**Files:**
- Modify: `src/views/editor/AnnotationNode.tsx`
- Modify: `src/views/editor/EditorStage.tsx`
- Modify: `src/views/editor/ToolRail.tsx`
- Modify: `src/views/editor/StyleBar.tsx`

**Interfaces:**
- Consumes: `BoxAnno` with `type: "spotlight"`, `style.region`, `style.fillOpacity`.

- [ ] **Step 1: Add the render node in `AnnotationNode.tsx`**

Add a `case "spotlight"` to the `switch (anno.type)` (after the `redact` case):

```tsx
    case "spotlight": {
      const a = anno as BoxAnno;
      return (
        <SpotlightRegion
          a={a}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
```

Add the `SpotlightRegion` component (a cached full-canvas dim group with the region punched out via `destination-out`, plus an invisible-but-hittable drag handle over the region). The cache isolates the composite so it does NOT punch through the base image:

```tsx
/** Spotlight: dim the whole canvas except one bright region (rect or ellipse). The
 * dim + hole live in a CACHED group so the destination-out composite is isolated to
 * the group's own buffer (it must not erase the base image beneath). A separate
 * invisible rect over the region provides selection + drag. */
function SpotlightRegion({
  a, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  const dim = a.style.fillOpacity ?? 0.6;
  const region = a.style.region ?? "rect";

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.cache({ x: 0, y: 0, width: baseWidth, height: baseHeight });
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, dim, region, baseWidth, baseHeight]);

  return (
    <>
      <Group ref={ref} listening={false} x={0} y={0}>
        <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={dim} />
        {region === "ellipse" ? (
          <Ellipse
            x={x + w / 2} y={y + h / 2}
            radiusX={Math.abs(w / 2)} radiusY={Math.abs(h / 2)}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        ) : (
          <Rect
            x={x} y={y} width={w} height={h}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        )}
      </Group>
      {/* Invisible (opacity 0) but fully hittable — Konva's hit canvas ignores opacity. */}
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
    </>
  );
}
```

- [ ] **Step 2: Wire draft-draw in `EditorStage.tsx`**

Add a dedicated `spotlight` case in the pointer-down tool `switch` (seeds the 0.6 dim + rect region default):

```ts
      case "spotlight":
        a = { id, type: "spotlight", z: 0, style: { ...style, fillOpacity: 0.6, region: style.region ?? "rect" }, x, y, w: 0, h: 0 };
        break;
```

Add `"spotlight"` to the drag-resize condition (same line edited in Task 2 step 2):

```ts
    } else if (a.type === "rect" || a.type === "ellipse" || a.type === "blur" || a.type === "redact" || a.type === "spotlight") {
      update(id, { w: x - a.x, h: y - a.y } as Partial<Annotation>);
```

- [ ] **Step 3: Add the tool button in `ToolRail.tsx`**

Add `Focus` to the lucide import, and a TOOLS entry after `redact`:

```ts
  { id: "redact",    icon: EyeOff,        tip: "Redact (K)",      key: "K" },
  { id: "spotlight", icon: Focus,         tip: "Spotlight (F)",   key: "F" },
```
(Add `Focus` to the `import { ... } from "lucide-react";` list.)

- [ ] **Step 4: Add the shape toggle + dim slider in `StyleBar.tsx`**

Add flags/setters near the others:

```ts
  const isSpotlight = effType === "spotlight";
```
```ts
  const applyRegion = (region: "rect" | "ellipse") => { setStyle({ region }); patchSelected({ region }); };
  const applyDim = (fillOpacity: number) => { setStyle({ fillOpacity }); patchSelected({ fillOpacity }, false); };
```

Add the UI (after the redact block):

```tsx
      {isSpotlight && (
        <>
          <div className="editor-widths" role="group" aria-label="Spotlight shape">
            <button
              className={`editor-width${(eff.region ?? "rect") === "rect" ? " editor-width--active" : ""}`}
              title="Rectangle" aria-label="Rectangle"
              onClick={() => applyRegion("rect")}
            >
              ▭
            </button>
            <button
              className={`editor-width${eff.region === "ellipse" ? " editor-width--active" : ""}`}
              title="Ellipse" aria-label="Ellipse"
              onClick={() => applyRegion("ellipse")}
            >
              ◯
            </button>
          </div>
          <input
            className="editor-opacity"
            type="range"
            min={10} max={90}
            value={Math.round((eff.fillOpacity ?? 0.6) * 100)}
            onPointerDown={() => { const st = useEditorStore.getState(); if (st.selectedId) st.pushHistory(); }}
            onChange={(e) => applyDim(Number(e.currentTarget.value) / 100)}
            aria-label="Dim strength"
            title="Dim strength"
          />
        </>
      )}
```

- [ ] **Step 5: Verify typecheck + run**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean, all vitest pass.

Manually verify (`npm run tauri dev`): editor → press **F** → drag a box → everything dims except the box; toggle Ellipse; drag the dim slider; move the bright region by dragging it; Save/Copy → the dimmed spotlight bakes into the PNG and the base image is intact outside the hole (no transparent punch-through).

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/editor/AnnotationNode.tsx glint/src/views/editor/EditorStage.tsx glint/src/views/editor/ToolRail.tsx glint/src/views/editor/StyleBar.tsx
git commit -m "$(cat <<'EOF'
feat(p25): spotlight tool — dim-except-region, rect + ellipse

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 5: Delayed capture — `capture_delay_secs` setting

**Files:**
- Modify: `src-tauri/src/settings/mod.rs`

**Interfaces:**
- Produces: `Settings.capture_delay_secs: u32` (default 5); `apply_update` accepts key `"capture_delay_secs"` (3/5/10 only).

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/settings/mod.rs`:

```rust
    #[test]
    fn default_capture_delay_is_five() {
        assert_eq!(Settings::default().capture_delay_secs, 5);
    }

    #[test]
    fn apply_update_sets_and_validates_capture_delay() {
        let mut s = Settings::default();
        apply_update(&mut s, "capture_delay_secs", json!(10)).unwrap();
        assert_eq!(s.capture_delay_secs, 10);
        assert!(apply_update(&mut s, "capture_delay_secs", json!(7)).is_err());
        assert!(apply_update(&mut s, "capture_delay_secs", json!("x")).is_err());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings::tests::default_capture_delay_is_five`
Expected: FAIL — no field `capture_delay_secs`.

- [ ] **Step 3: Implement**

Add the field to `struct Settings` (after `webcam_shape`):
```rust
    /// Countdown seconds for delayed captures (3, 5, or 10).
    pub capture_delay_secs: u32,
```
Add to `Default`:
```rust
            webcam_shape: "circle".into(),
            capture_delay_secs: 5,
```
Add the `apply_update` arm (before the `other =>` catch-all):
```rust
        "capture_delay_secs" => {
            let v = value.as_u64().ok_or("capture_delay_secs must be a number")?;
            if !matches!(v, 3 | 5 | 10) {
                return Err("capture_delay_secs must be 3, 5, or 10".into());
            }
            s.capture_delay_secs = v as u32;
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test settings::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs
git commit -m "$(cat <<'EOF'
feat(p25): capture_delay_secs setting (3/5/10, default 5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 6: Delayed capture — hotkey actions (Rust)

**Files:**
- Modify: `src-tauri/src/settings/mod.rs` (the `Hotkeys` struct + `Default`)
- Modify: `src-tauri/src/settings/hotkeys.rs`
- Modify: `src-tauri/src/settings/commands.rs` (`action_label`)

**Interfaces:**
- Produces: `Hotkeys` fields `capture_area_delayed`, `capture_window_delayed`, `capture_fullscreen_delayed` (default `""` = unbound); `HOTKEY_ACTIONS` includes the three; `get_field`/`set_field` handle them.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/settings/hotkeys.rs` (and update the local `hk()` helper to include the three new fields with empty strings):

```rust
    #[test]
    fn delayed_actions_registered_and_default_unbound() {
        assert!(HOTKEY_ACTIONS.contains(&"capture_area_delayed"));
        assert!(HOTKEY_ACTIONS.contains(&"capture_window_delayed"));
        assert!(HOTKEY_ACTIONS.contains(&"capture_fullscreen_delayed"));
        let h = super::super::Hotkeys::default();
        assert_eq!(h.capture_area_delayed, "");
        assert_eq!(get_field(&h, "capture_area_delayed"), Some(""));
    }
```

Update the existing `hk()` test helper in this file to add:
```rust
            capture_area_delayed: String::new(),
            capture_window_delayed: String::new(),
            capture_fullscreen_delayed: String::new(),
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings::hotkeys`
Expected: FAIL — missing struct fields.

- [ ] **Step 3: Implement**

In `src-tauri/src/settings/mod.rs`, add to `struct Hotkeys`:
```rust
    pub copy_path: String,
    #[serde(default)]
    pub capture_area_delayed: String,
    #[serde(default)]
    pub capture_window_delayed: String,
    #[serde(default)]
    pub capture_fullscreen_delayed: String,
```
And to `Hotkeys::default()`:
```rust
            copy_path: "CmdOrCtrl+Shift+C".into(),
            capture_area_delayed: String::new(),
            capture_window_delayed: String::new(),
            capture_fullscreen_delayed: String::new(),
```

In `src-tauri/src/settings/hotkeys.rs`:
- Grow the array (update the length):
```rust
pub const HOTKEY_ACTIONS: [&str; 8] = [
    "capture_area", "capture_window", "capture_fullscreen", "record", "copy_path",
    "capture_area_delayed", "capture_window_delayed", "capture_fullscreen_delayed",
];
```
- Add to `get_field`:
```rust
        "capture_area_delayed" => h.capture_area_delayed.as_str(),
        "capture_window_delayed" => h.capture_window_delayed.as_str(),
        "capture_fullscreen_delayed" => h.capture_fullscreen_delayed.as_str(),
```
- Add to `set_field`:
```rust
        "capture_area_delayed" => h.capture_area_delayed = accel,
        "capture_window_delayed" => h.capture_window_delayed = accel,
        "capture_fullscreen_delayed" => h.capture_fullscreen_delayed = accel,
```

In `src-tauri/src/settings/commands.rs`, add to `action_label`:
```rust
        "capture_area_delayed" => "Delayed capture area",
        "capture_window_delayed" => "Delayed capture window",
        "capture_fullscreen_delayed" => "Delayed capture fullscreen",
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test settings:: && cargo clippy --all-targets`
Expected: PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src-tauri/src/settings/hotkeys.rs glint/src-tauri/src/settings/commands.rs
git commit -m "$(cat <<'EOF'
feat(p25): register three delayed-capture hotkey actions (unbound default)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 7: Neutral countdown module (N-parameterized)

**Files:**
- Create: `src-tauri/src/countdown.rs`
- Modify: `src-tauri/src/lib.rs` (`mod countdown;`)
- Modify: `src-tauri/src/recorder/windows.rs` (delegate to the neutral module)
- Modify: `src/recorder/Countdown.tsx` (read `?n=`)

**Interfaces:**
- Produces: `crate::countdown::build(app: &AppHandle, seconds: u32) -> tauri::Result<()>` and `crate::countdown::close(app: &AppHandle)`.

- [ ] **Step 1: Read the existing recorder countdown**

Run: `sed -n '1,140p' glint/src-tauri/src/recorder/windows.rs`
Note the `COUNTDOWN_LABEL`, `build_countdown`, and `close_countdown` implementations and the URL (`index.html#/rec-countdown`). You will move the window-building logic verbatim into the neutral module, adding a `seconds` query parameter to the URL.

- [ ] **Step 2: Create `src-tauri/src/countdown.rs`**

Port the existing `build_countdown`/`close_countdown` body here, parameterized by `seconds`. Keep the same label, window flags, and centering math as the recorder version (copy them from what you read in Step 1). The only change is appending `?n={seconds}` to the route:

```rust
//! Neutral, reusable N-second countdown window. Shared by the recorder (N=3) and
//! delayed capture (N=3/5/10). No coupling to capture/recorder internals — either
//! caller invokes `build`/`close`.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const COUNTDOWN_LABEL: &str = "rec-countdown";

/// Fullscreen, centered, click-through countdown starting at `seconds`. The frontend
/// (`Countdown.tsx`) reads `?n=` and self-closes at 0; callers also call `close`
/// defensively before the moment of capture so the digit never lands in the frame.
pub fn build(app: &AppHandle, seconds: u32) -> tauri::Result<()> {
    if app.get_webview_window(COUNTDOWN_LABEL).is_some() {
        return Ok(());
    }
    let url = WebviewUrl::App(format!("index.html#/rec-countdown?n={seconds}").into());
    let win = WebviewWindowBuilder::new(app, COUNTDOWN_LABEL, url)
        .title("Glint")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;
    crate::window::disable_transitions(&win);
    if let Some(monitor) = win.primary_monitor()? {
        let pos = monitor.position();
        let size = monitor.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    // Click-through so the countdown never intercepts the user framing the shot.
    let _ = win.set_ignore_cursor_events(true);
    win.show()?;
    Ok(())
}

/// Close the countdown window if open. Safe when none exists.
pub fn close(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = win.close();
    }
}
```

> **Note:** If the values you read in Step 1 differ (e.g. a different label, or extra window flags, or a specific fullscreen approach), prefer the values from the existing recorder implementation — this block must match the proven window setup, only adding `?n={seconds}`.

- [ ] **Step 3: Declare the module in `src-tauri/src/lib.rs`**

Add near the other top-level `mod` declarations:
```rust
mod countdown;
```

- [ ] **Step 4: Delegate the recorder countdown to the neutral module**

In `src-tauri/src/recorder/windows.rs`, replace the bodies of `build_countdown`/`close_countdown` so they call the neutral module (keeping their existing public signatures so `recorder/mod.rs` callers are unchanged):

```rust
pub fn build_countdown(app: &AppHandle) -> tauri::Result<()> {
    crate::countdown::build(app, 3)
}

pub fn close_countdown(app: &AppHandle) {
    crate::countdown::close(app);
}
```
Remove the now-unused imports/constants in `recorder/windows.rs` that only the old countdown body used (if `COUNTDOWN_LABEL` there is now unused, delete it; clippy will flag it).

- [ ] **Step 5: Make the frontend Countdown read `?n=`**

Replace `src/recorder/Countdown.tsx` with a version that reads the start value from the hash query (`#/rec-countdown?n=5`), defaulting to 3:

```tsx
/** Countdown.tsx — centered N·…·1 before capture/recording (route #/rec-countdown?n=). */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./recorder.css";

function startFromHash(): number {
  // Hash looks like "#/rec-countdown?n=5".
  const q = window.location.hash.split("?")[1] ?? "";
  const n = Number(new URLSearchParams(q).get("n"));
  return Number.isFinite(n) && n >= 1 && n <= 60 ? Math.floor(n) : 3;
}

export function Countdown() {
  const [n, setN] = useState(startFromHash);
  useEffect(() => {
    if (n <= 0) { getCurrentWindow().close(); return; }
    const id = window.setTimeout(() => setN((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n]);
  return <div className="rec-countdown">{n > 0 ? n : ""}</div>;
}
```

- [ ] **Step 6: Verify build + regression**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: all clean/pass.

Manually verify recording still shows a 3·2·1 countdown (`npm run tauri dev` → start a recording).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/countdown.rs glint/src-tauri/src/lib.rs glint/src-tauri/src/recorder/windows.rs glint/src/recorder/Countdown.tsx
git commit -m "$(cat <<'EOF'
refactor(p25): promote countdown to a neutral N-parameterized module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 8: Delayed capture — `begin_delayed_spawned` + shortcut dispatch

**Files:**
- Modify: `src-tauri/src/capture/mod.rs`
- Modify: `src-tauri/src/shortcuts.rs`

**Interfaces:**
- Consumes: `crate::countdown::build/close`, `Settings.capture_delay_secs`, `CaptureMode`, `begin` (the synchronous grab entry).
- Produces: `crate::capture::begin_delayed_spawned(app: &AppHandle, mode: CaptureMode)`.

- [ ] **Step 1: Add `begin_delayed_spawned` in `capture/mod.rs`**

Add below `begin_spawned` (read lines ~97–110 first to mirror the threading/`begin` contract). It reads the configured delay, shows the countdown, waits, closes the countdown, then runs the normal capture:

```rust
/// Delayed capture: show an N-second countdown (N from settings, 3/5/10), then run the
/// normal capture for `mode`. Runs on a background thread (building a webview + sleeping
/// must not block the main event loop). Gives immediate visible feedback via the countdown.
pub fn begin_delayed_spawned(app: &AppHandle, mode: CaptureMode) {
    let app = app.clone();
    std::thread::spawn(move || {
        let secs = {
            let state = app.state::<crate::settings::commands::SettingsState>();
            let s = state.0.lock().unwrap();
            s.capture_delay_secs
        };
        let _ = crate::countdown::build(&app, secs);
        std::thread::sleep(std::time::Duration::from_secs(secs as u64));
        // Close the digit BEFORE grabbing so it never lands in a fullscreen shot.
        crate::countdown::close(&app);
        begin(&app, mode);
    });
}
```

> Confirm `begin(&app, mode)` is the correct synchronous entry (from the earlier read it is `pub fn begin(app: &AppHandle, mode: CaptureMode)`). If `begin` must run on the main thread, instead post it to the main thread here (mirror how `begin_spawned` dispatches) — check the body of `begin_spawned` in this file and match it exactly.

- [ ] **Step 2: Register + dispatch the three delayed shortcuts in `shortcuts.rs`**

Add the three to the `hotkeys` array in `apply`:
```rust
            (h.record.clone(), "record"),
            (h.copy_path.clone(), "copy_path"),
            (h.capture_area_delayed.clone(), "capture_area_delayed"),
            (h.capture_window_delayed.clone(), "capture_window_delayed"),
            (h.capture_fullscreen_delayed.clone(), "capture_fullscreen_delayed"),
```

Add match arms in the `on_shortcut` handler (next to the existing capture arms):
```rust
                        "capture_area_delayed" => {
                            crate::capture::begin_delayed_spawned(handle, crate::capture::CaptureMode::Area);
                        }
                        "capture_window_delayed" => {
                            crate::capture::begin_delayed_spawned(handle, crate::capture::CaptureMode::Window);
                        }
                        "capture_fullscreen_delayed" => {
                            crate::capture::begin_delayed_spawned(handle, crate::capture::CaptureMode::Fullscreen);
                        }
```

- [ ] **Step 3: Verify build**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Expected: clean/pass.

- [ ] **Step 4: Manual smoke (deferred to Task 9's UI, but verifiable now)**

Temporarily bind a delayed action via the Hotkeys panel once Task 9 lands; for now confirm it compiles. (Full at-screen test happens in the final task.)

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/capture/mod.rs glint/src-tauri/src/shortcuts.rs
git commit -m "$(cat <<'EOF'
feat(p25): begin_delayed_spawned + wire delayed-capture shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 9: Delayed capture — frontend settings

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/views/settings/Capture.tsx`
- Modify: `src/views/settings/Hotkeys.tsx`

**Interfaces:**
- Consumes: setting key `capture_delay_secs`; hotkey actions `capture_*_delayed`.
- Produces: `useAppStore` field `capture_delay_secs: 3 | 5 | 10` + `setCaptureDelay`.

- [ ] **Step 1: Extend the store**

In `src/store/useAppStore.ts`:
- Add to `interface Settings` (after `webcam_shape`):
```ts
  webcam_shape: "circle" | "rounded" | "square" | "rect";
  capture_delay_secs: 3 | 5 | 10;
```
- Add to `interface AppState` (near `setRecordFps`):
```ts
  setCaptureDelay: (v: 3 | 5 | 10) => Promise<void>;
```
- Add the setter (mirror `setRecordFps`, near it):
```ts
  setCaptureDelay: async (v: 3 | 5 | 10) => {
    const updated = await saveSetting("capture_delay_secs", v);
    await persistSetting("capture_delay_secs", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 2: Add the dropdown to `Capture.tsx`**

Add an options constant and the field. At the top with the other constants:
```ts
const DELAY_OPTIONS = [
  { value: "3", label: "3 seconds" },
  { value: "5", label: "5 seconds" },
  { value: "10", label: "10 seconds" },
];
```
Add the setter hook near the others:
```ts
  const setCaptureDelay = useAppStore((s) => s.setCaptureDelay);
```
Add the field (after the "Include cursor" field), inside the `<Section>`:
```tsx
      <Field label="Capture delay" hint="Countdown length for the delayed-capture hotkeys.">
        <Select
          value={String(settings?.capture_delay_secs ?? 5)}
          options={DELAY_OPTIONS}
          onChange={(v) => void setCaptureDelay(Number(v) as 3 | 5 | 10)}
        />
      </Field>
```

- [ ] **Step 3: Add the three rows to `Hotkeys.tsx`**

Extend the three constant maps:
```ts
const HOTKEY_LABELS: Record<string, string> = {
  capture_area: "Capture area",
  capture_window: "Capture window",
  capture_fullscreen: "Capture fullscreen",
  record: "Record",
  copy_path: "Copy path",
  capture_area_delayed: "Delayed capture area",
  capture_window_delayed: "Delayed capture window",
  capture_fullscreen_delayed: "Delayed capture fullscreen",
};

const HOTKEY_ORDER = [
  "capture_area", "capture_window", "capture_fullscreen", "record", "copy_path",
  "capture_area_delayed", "capture_window_delayed", "capture_fullscreen_delayed",
];
```
And in `DEFAULTS`, add the three with empty-string defaults (unbound):
```ts
  copy_path: "CmdOrCtrl+Shift+C",
  capture_area_delayed: "",
  capture_window_delayed: "",
  capture_fullscreen_delayed: "",
```
(Confirm the `capture_fullscreen` label/default entries already present are unchanged — only append the three delayed ones.)

- [ ] **Step 4: Verify typecheck + run**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean, all pass.

- [ ] **Step 5: Commit**

```bash
git add glint/src/store/useAppStore.ts glint/src/views/settings/Capture.tsx glint/src/views/settings/Hotkeys.tsx
git commit -m "$(cat <<'EOF'
feat(p25): capture-delay dropdown + delayed-capture hotkey rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 10: Video presets — settings

**Files:**
- Modify: `src-tauri/src/settings/mod.rs`

**Interfaces:**
- Produces: `Settings.record_resolution: String` (default `"original"`; one of `original`/`1080p`/`720p`), `Settings.record_quality: String` (default `"high"`; one of `high`/`medium`/`low`).

- [ ] **Step 1: Write the failing tests**

Add to the settings `tests` module:
```rust
    #[test]
    fn default_video_presets() {
        let s = Settings::default();
        assert_eq!(s.record_resolution, "original");
        assert_eq!(s.record_quality, "high");
    }

    #[test]
    fn apply_update_sets_and_validates_video_presets() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_resolution", json!("720p")).unwrap();
        apply_update(&mut s, "record_quality", json!("low")).unwrap();
        assert_eq!(s.record_resolution, "720p");
        assert_eq!(s.record_quality, "low");
        assert!(apply_update(&mut s, "record_resolution", json!("4k")).is_err());
        assert!(apply_update(&mut s, "record_quality", json!("ultra")).is_err());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings::tests::default_video_presets`
Expected: FAIL — no such fields.

- [ ] **Step 3: Implement**

Add fields to `struct Settings`:
```rust
    /// Recording downscale: "original" | "1080p" | "720p".
    pub record_resolution: String,
    /// Recording quality tier: "high" | "medium" | "low".
    pub record_quality: String,
```
Add to `Default`:
```rust
            capture_delay_secs: 5,
            record_resolution: "original".into(),
            record_quality: "high".into(),
```
Add `apply_update` arms:
```rust
        "record_resolution" => {
            let v = value.as_str().ok_or("record_resolution must be string")?;
            if !matches!(v, "original" | "1080p" | "720p") {
                return Err("record_resolution must be original|1080p|720p".into());
            }
            s.record_resolution = v.to_string();
        }
        "record_quality" => {
            let v = value.as_str().ok_or("record_quality must be string")?;
            if !matches!(v, "high" | "medium" | "low") {
                return Err("record_quality must be high|medium|low".into());
            }
            s.record_quality = v.to_string();
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test settings::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs
git commit -m "$(cat <<'EOF'
feat(p25): record_resolution + record_quality settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 11: Video presets — quality mapping in ffmpeg

**Files:**
- Modify: `src-tauri/src/recorder/ffmpeg.rs`

**Interfaces:**
- Produces: `pub fn quality_cq(quality: &str) -> u32`; `encoder_args(enc: VideoEncoder, quality: &str) -> Vec<String>` (new `quality` param).

- [ ] **Step 1: Write the failing tests**

Add to the ffmpeg `tests` module:
```rust
    #[test]
    fn quality_cq_maps_tiers() {
        assert_eq!(quality_cq("high"), 21);
        assert_eq!(quality_cq("medium"), 27);
        assert_eq!(quality_cq("low"), 33);
        assert_eq!(quality_cq("bogus"), 21); // defaults to high
    }

    #[test]
    fn encoder_args_threads_quality_value() {
        // libx264 gains a -crf; hw encoders carry the value on their own flag.
        let x = encoder_args(VideoEncoder::Libx264, "low");
        assert!(x.windows(2).any(|w| w[0] == "-crf" && w[1] == "33"), "libx264 crf");
        let n = encoder_args(VideoEncoder::Nvenc, "medium");
        assert!(n.windows(2).any(|w| w[0] == "-cq" && w[1] == "27"), "nvenc cq");
        let q = encoder_args(VideoEncoder::Qsv, "high");
        assert!(q.windows(2).any(|w| w[0] == "-global_quality" && w[1] == "21"), "qsv gq");
        let a = encoder_args(VideoEncoder::Amf, "high");
        assert!(a.windows(2).any(|w| w[0] == "-qp_i" && w[1] == "21"), "amf qp");
    }
```

Also UPDATE the existing `encoder_args_libx264_is_unchanged_tail` test: it now expects a `-crf` in the tail. Change its expectation to include `-crf`, `21` after the preset (call it with `encoder_args(VideoEncoder::Libx264, "high")`), or rename it to `encoder_args_libx264_has_crf`. And update `encoder_args_hw_encoders_are_yuv420p_h264` to call `encoder_args(enc, "high")`.

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test recorder::ffmpeg`
Expected: FAIL — `quality_cq` undefined, `encoder_args` arity mismatch.

- [ ] **Step 3: Implement**

Add the mapping function above `encoder_args`:
```rust
/// H.264 quantizer for a quality tier. Same numeric scale (~0–51) works across the
/// libx264 CRF and the hardware encoders' CQ/QP controls; only the FLAG name differs.
pub fn quality_cq(quality: &str) -> u32 {
    match quality {
        "medium" => 27,
        "low" => 33,
        _ => 21, // "high" and any unknown value
    }
}
```
Change `encoder_args` to take `quality` and thread the value:
```rust
pub fn encoder_args(enc: VideoEncoder, quality: &str) -> Vec<String> {
    let s = |v: &str| v.to_string();
    let q = quality_cq(quality).to_string();
    match enc {
        VideoEncoder::Libx264 => vec![s("-c:v"), s("libx264"), s("-preset"), s("ultrafast"), s("-crf"), q],
        VideoEncoder::Nvenc => vec![
            s("-c:v"), s("h264_nvenc"), s("-preset"), s("p4"),
            s("-rc"), s("vbr"), s("-cq"), q, s("-b:v"), s("0"),
            /* keep the existing trailing pix_fmt/etc. tokens exactly as they were */
        ],
        VideoEncoder::Qsv => vec![
            s("-c:v"), s("h264_qsv"), s("-preset"), s("veryfast"), s("-global_quality"), q,
            /* keep existing trailing tokens */
        ],
        VideoEncoder::Amf => vec![
            s("-c:v"), s("h264_amf"), s("-quality"), s("balanced"),
            s("-rc"), s("cqp"), s("-qp_i"), q.clone(), s("-qp_p"), q,
            /* keep existing trailing tokens */
        ],
    }
}
```
> **Important:** Preserve every trailing token each encoder arm currently emits after the quantizer (yuv420p/pix_fmt, profiles, etc. — read lines 40–60 of `ffmpeg.rs`). Only the `21` literals become `q`, and libx264 gains `-crf q`. Do not drop existing tokens.

Update the internal call site in `build_ffmpeg_args` (this is fixed in Task 12 when the signature grows; for now it will not compile until Task 12 threads `quality`). To keep this task self-contained and green, temporarily update the call at line ~193 to `a.extend(encoder_args(encoder, "high"));` and the smoke-probe call at line ~86 similarly. Task 12/13 replace `"high"` with the real setting.

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test recorder::ffmpeg && cargo clippy --all-targets`
Expected: PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs
git commit -m "$(cat <<'EOF'
feat(p25): per-encoder quality mapping (quality_cq) in ffmpeg args

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 12: Video presets — scale filter in ffmpeg

**Files:**
- Modify: `src-tauri/src/recorder/ffmpeg.rs`

**Interfaces:**
- Consumes: `encoder_args(enc, quality)` from Task 11.
- Produces: `pub fn scale_filter(resolution: &str) -> Option<String>`; `build_ffmpeg_args` gains `resolution: &str` and `quality: &str` params.

- [ ] **Step 1: Write the failing tests**

Add to the ffmpeg `tests` module:
```rust
    #[test]
    fn scale_filter_maps_resolution() {
        assert_eq!(scale_filter("original"), None);
        assert_eq!(scale_filter("1080p").as_deref(), Some("scale=-2:1080"));
        assert_eq!(scale_filter("720p").as_deref(), Some("scale=-2:720"));
    }

    #[test]
    fn ddagrab_vchain_includes_scale_when_downscaled() {
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 60, "o.mp4", &[], false, true, VideoEncoder::Libx264, "720p", "high");
        let fc = a.iter().position(|t| t == "-filter_complex").map(|i| a[i + 1].clone()).unwrap_or_default();
        assert!(fc.contains("scale=-2:720"), "filter_complex should scale: {fc}");
    }

    #[test]
    fn gdigrab_scale_creates_mapped_vchain() {
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, true, VideoEncoder::Libx264, "1080p", "high");
        let fc = a.iter().position(|t| t == "-filter_complex").map(|i| a[i + 1].clone()).unwrap_or_default();
        assert!(fc.contains("[0:v]scale=-2:1080[v]"), "gdigrab scale vchain: {fc}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
    }

    #[test]
    fn original_resolution_adds_no_scale() {
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, true, VideoEncoder::Libx264, "original", "high");
        assert!(!a.iter().any(|t| t.contains("scale=")), "no scale at original");
    }
```
Update the OTHER existing `build_ffmpeg_args` call sites in the tests module (e.g. `ddagrab_nvenc_scopes_...`, `ddagrab_libx264_keeps_...`, `gdigrab_*`) to pass the two new trailing args `"original", "high"`.

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test recorder::ffmpeg`
Expected: FAIL — `scale_filter` undefined, arity mismatch.

- [ ] **Step 3: Implement**

Add the pure helper near `quality_cq`:
```rust
/// The `scale=…` filter for a resolution tier, or None for "original". `-2` keeps the
/// aspect ratio and rounds to an even width (H.264 yuv420p requires even dimensions).
pub fn scale_filter(resolution: &str) -> Option<String> {
    match resolution {
        "1080p" => Some("scale=-2:1080".into()),
        "720p" => Some("scale=-2:720".into()),
        _ => None, // "original" and any unknown value
    }
}
```
Change the signature:
```rust
#[allow(clippy::too_many_arguments)]
pub fn build_ffmpeg_args(
    engine: CaptureEngine,
    target: &RecordTarget,
    fps: u32,
    out: &str,
    audio: &[AudioInput],
    want_audio: bool,
    draw_mouse: bool,
    encoder: VideoEncoder,
    resolution: &str,
    quality: &str,
) -> Vec<String> {
```
Compute the scale once (near the top of the body, after `let mut a`):
```rust
    let scale = scale_filter(resolution);
```
Update the `ddagrab_vchain` builder to append the scale before `[v]`:
```rust
    let ddagrab_vchain = match engine {
        CaptureEngine::Ddagrab => {
            let mut src = format!(
                "ddagrab=output_idx=0:draw_mouse={}:framerate={}",
                if draw_mouse { 1 } else { 0 },
                fps
            );
            if let RecordTarget::Region { x, y, w, h } = target {
                src.push_str(&format!(":video_size={w}x{h}:offset_x={x}:offset_y={y}"));
            }
            let tail = match &scale {
                Some(sf) => format!("hwdownload,format=bgra,{sf}[v]"),
                None => "hwdownload,format=bgra[v]".to_string(),
            };
            Some(format!("{src},{tail}"))
        }
        CaptureEngine::Gdigrab => {
            // gdigrab video is input 0. With no scaling it auto-maps; with scaling we
            // build an explicit [0:v]scale[v] chain so the existing map arms tag [v].
            scale.as_ref().map(|sf| format!("[0:v]{sf}[v]"))
        }
    };
```
Change the encoder tail line to thread quality:
```rust
    a.extend(encoder_args(encoder, quality));
```
(Undo the temporary `"high"` from Task 11 step 3 at both call sites: the smoke-probe at line ~86 should pass the recording's chosen quality — for the probe, `"high"` is fine to keep since it only measures encoder viability; leave the probe as `encoder_args(enc, "high")` or `build_ffmpeg_args(..., "original", "high")`.)

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test recorder::ffmpeg && cargo clippy --all-targets`
Expected: PASS, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs
git commit -m "$(cat <<'EOF'
feat(p25): resolution scale filter threaded through build_ffmpeg_args

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 13: Video presets — pass settings into the recorder

**Files:**
- Modify: `src-tauri/src/recorder/mod.rs`

**Interfaces:**
- Consumes: `Settings.record_resolution`, `Settings.record_quality`; `build_ffmpeg_args(..., resolution, quality)`.

- [ ] **Step 1: Read the settings at the build_ffmpeg_args call site**

Run: `sed -n '660,700p' glint/src-tauri/src/recorder/mod.rs` and `sed -n '280,295p' glint/src-tauri/src/recorder/mod.rs`
Locate where `fps` (and other settings) are read (around line 667) and where `build_ffmpeg_args(engine, &target, fps, path, &inputs, ..., encoder)` is called (around line 287).

- [ ] **Step 2: Thread the two settings**

Where the recording session reads settings (near the `record_fps` read at ~667), also capture the two strings, e.g.:
```rust
        (s.record_fps, s.record_webcam_movable, s.webcam_shape.clone(), s.record_resolution.clone(), s.record_quality.clone())
```
Bind them into locals (`resolution`, `quality`) alongside `fps`, and pass to the call at ~287:
```rust
    let args = ffmpeg::build_ffmpeg_args(engine, &target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse, encoder, &resolution, &quality);
```
> Match the exact tuple/destructuring shape already used at that site — only ADD the two fields. If `resolution`/`quality` aren't in scope at line 287, plumb them through the same struct/closure that already carries `fps` to that point (follow how `fps` reaches line 287).

- [ ] **Step 3: Verify build + tests**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Expected: clean/pass.

Manual: record at 720p / Low and at Original / High; confirm the 720p file is visibly smaller and downscaled (`npm run tauri dev`).

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs
git commit -m "$(cat <<'EOF'
feat(p25): recorder passes resolution + quality settings to ffmpeg

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 14: Video presets — frontend settings

**Files:**
- Modify: `src/store/useAppStore.ts`
- Modify: `src/views/settings/Recording.tsx`

**Interfaces:**
- Produces: `useAppStore` fields `record_resolution`, `record_quality` + setters `setRecordResolution`, `setRecordQuality`.

- [ ] **Step 1: Extend the store**

In `src/store/useAppStore.ts`:
- Add to `interface Settings`:
```ts
  capture_delay_secs: 3 | 5 | 10;
  record_resolution: "original" | "1080p" | "720p";
  record_quality: "high" | "medium" | "low";
```
- Add to `interface AppState`:
```ts
  setRecordResolution: (v: "original" | "1080p" | "720p") => Promise<void>;
  setRecordQuality: (v: "high" | "medium" | "low") => Promise<void>;
```
- Add the setters (mirror `setRecordFps`):
```ts
  setRecordResolution: async (v: "original" | "1080p" | "720p") => {
    const updated = await saveSetting("record_resolution", v);
    await persistSetting("record_resolution", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordQuality: async (v: "high" | "medium" | "low") => {
    const updated = await saveSetting("record_quality", v);
    await persistSetting("record_quality", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 2: Add the two dropdowns to `Recording.tsx`**

Add option constants near `FPS_OPTIONS`:
```ts
const RESOLUTION_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
];

const VIDEO_QUALITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
```
Add the setter hooks near the others:
```ts
  const setRecordResolution = useAppStore((s) => s.setRecordResolution);
  const setRecordQuality = useAppStore((s) => s.setRecordQuality);
```
Add the fields right after the "Frame rate" field:
```tsx
      <Field label="Resolution" hint="Downscale recordings to keep file size down (e.g. for issue attachments).">
        <Select
          value={settings?.record_resolution ?? "original"}
          options={RESOLUTION_OPTIONS}
          onChange={(v) => void setRecordResolution(v as "original" | "1080p" | "720p")}
        />
      </Field>
      <Field label="Quality" hint="Compression level. Lower quality = smaller files.">
        <Select
          value={settings?.record_quality ?? "high"}
          options={VIDEO_QUALITY_OPTIONS}
          onChange={(v) => void setRecordQuality(v as "high" | "medium" | "low")}
        />
      </Field>
```

- [ ] **Step 3: Verify typecheck + run**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean, all pass.

- [ ] **Step 4: Commit**

```bash
git add glint/src/store/useAppStore.ts glint/src/views/settings/Recording.tsx
git commit -m "$(cat <<'EOF'
feat(p25): resolution + quality dropdowns in Recording settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Task 15: Full green gate + acceptance doc

**Files:**
- Create: `docs/superpowers/PHASE-25-ACCEPTANCE.md`

- [ ] **Step 1: Run the complete green gate**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: 0 clippy warnings, all Rust tests pass, tsc clean, all vitest pass. Fix anything red before proceeding.

- [ ] **Step 2: At-screen acceptance checklist**

Run `npm run tauri dev` and verify each:
- Redact: **K** → solid black block hides content; **Pixel** toggle → mosaic; Save → solid shows no underlying pixels in the exported PNG.
- Spotlight: **F** → dims all but the region; Rect/Ellipse toggle works; dim slider works; region draggable; bakes into export with base image intact outside the hole.
- Delayed capture: bind `Delayed capture area` (e.g. `Ctrl+Shift+4`) in Hotkeys; trigger it; a countdown (matching the Capture-delay setting: 3/5/10) shows, then the area overlay appears. Repeat for window + fullscreen; confirm the countdown digit is NOT in a fullscreen shot.
- Video presets: record at Original/High and 720p/Low; confirm the 720p/Low file is smaller and downscaled; playback is valid.
- Recording countdown regression: normal recording still shows 3·2·1.

- [ ] **Step 3: Write `docs/superpowers/PHASE-25-ACCEPTANCE.md`**

Summarize the shipped features, the files touched, the green-gate result, and the at-screen checklist outcomes (mirror the style of the existing `PHASE-*-ACCEPTANCE.md` files in that folder).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-25-ACCEPTANCE.md
git commit -m "$(cat <<'EOF'
docs(p25): Phase 25 acceptance notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

- [ ] **Step 5: Merge to master (after user at-screen sign-off)**

```bash
git checkout master
git merge --no-ff phase-25-developer-polish -m "$(cat <<'EOF'
Merge Phase 25 — developer polish into master

Redact (solid+pixelate), delayed capture (area/window/fullscreen),
video resolution+quality presets, spotlight (rect+ellipse).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Redact solid+pixelate → Tasks 1, 2. ✓
- Delayed capture area/window/fullscreen + configurable duration → Tasks 5, 6, 7, 8, 9. ✓
- Video resolution + per-encoder quality → Tasks 10, 11, 12, 13, 14. ✓
- Spotlight rect+ellipse, adjustable dim → Tasks 1 (model), 3, 4. ✓
- Multi-region spotlight explicitly deferred → not in plan (correct). ✓
- All editor tools bake via existing flatten, no backend export change → Tasks 2, 4 render nodes only. ✓
- Recorder isolation preserved → countdown promoted to neutral `countdown.rs` (Task 7); video presets stay in `recorder/`. ✓

**Type consistency:** `encoder_args(enc, quality)` and `build_ffmpeg_args(..., resolution, quality)` signatures introduced in Tasks 11/12 and consumed in Task 13; `quality_cq`/`scale_filter` names consistent throughout. `capture_delay_secs`, `record_resolution`, `record_quality` field names identical across Rust settings, store, and UI. `begin_delayed_spawned` defined in Task 8, called in Task 8's shortcut arms. `crate::countdown::build/close` defined in Task 7, used in Tasks 7 (recorder delegate) and 8 (delayed capture).

**Ordering:** Editor (1–4) is independent and can land first. Delayed capture (5–9) and video presets (10–14) are independent tracks. Task 11 leaves a temporary `"high"` literal that Task 12 finalizes and Task 13 replaces with the real setting — each task still compiles and is green.
