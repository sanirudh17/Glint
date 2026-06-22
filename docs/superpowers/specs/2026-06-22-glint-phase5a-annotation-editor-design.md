# Glint Phase 5a — Annotation Editor (core tools + export) — Design Spec

**Date:** 2026-06-22
**Status:** Approved (brainstorm); pending implementation plan.
**Phase:** 5a of 5 (annotation editor). 5b = backgrounds/framing + crop/trim. 5c = `.glint` re-editable save/load.

## 1. Goal

Give every capture a real annotation editor: open the just-taken shot (or any Library
capture) into a non-destructive Konva canvas, mark it up with the core tools, and finish by
copying, saving a new PNG, or dragging the flattened result into another app. The original
capture is never modified.

This phase makes live two existing stubs: the HUD **Annotate** button and the
**"Open in editor after capture"** setting.

## 2. Scope

**In scope (5a):**
- Editor in the main window's `/editor` route.
- Three entry points: HUD Annotate, Library "Edit", and the "open in editor after capture" setting.
- Nine core tools, each a non-destructive layer: **Arrow, Rectangle, Ellipse, Line, Text,
  Pen (freehand), Highlighter, Blur/Pixelate, Step counter**.
- Select / move / resize (Konva Transformer), delete, undo/redo, a contextual style toolbar
  (color, stroke width, font size).
- Export: **Copy** (clipboard), **Save as new PNG** (to `Pictures\Glint` + Library), **Drag out**.
- A minimal Vitest setup; the annotation reducer is built test-first.

**Out of scope (later 5 slices, explicitly):**
- Backgrounds / framing (padding, rounded corners, shadow, gradient backdrops) → **5b**.
- Crop / trim → **5b** (shares the canvas-resize machinery with framing).
- `.glint` re-editable document save/load → **5c**.
- Overwrite-original export — **intentionally never** (breaks the non-destructive guarantee;
  could be added later only as an explicit opt-in Settings toggle).
- Emoji/stamps, OCR, recording — other phases.

**Preserved global constraints:** local-first (no cloud/network/accounts/auth); recorder
isolation (the capture/editor path has zero ffmpeg/scap dependency); non-destructive (originals
untouched).

## 3. Architecture

**Chosen approach: a serializable annotation model is the single source of truth.** The editor's
truth is a plain, serializable array of annotation specs in a Zustand store — *not* Konva nodes.
Konva renders *from* that array. Three things fall out for free:
- **Undo/redo** = snapshot the array.
- **`.glint` save/load (5c)** = serialize/deserialize the array (no node-tree gymnastics).
- **Pure, testable logic** = reducer functions need no DOM.

**Flatten client-side.** Konva's `stage.toDataURL({ pixelRatio })` composites base + layers at
native capture resolution. Rust receives finished PNG bytes only; it never re-implements the
renderer. (Rejected: Konva nodes as source of truth — painful undo/persistence; server-side
flatten in Rust — duplicate renderer, no upside.)

### 3.1 Entry points & window model

The editor lives at `/editor` in the main window. A Rust `EditorSource` managed state holds the
base image for the current session. All entry points converge on one mechanism: set
`EditorSource`, show the main window, emit `editor-open`; the main window has a single listener on
`editor-open` that navigates to `/editor`; `/editor` then calls `editor_source()` to load the base.

- **HUD Annotate** → `editor_open_from_last()` — `EditorSource` from `LastCapture`, show main, tear
  down HUD, emit.
- **Library Edit** → `editor_open_capture(id)` — load the capture file by id, set `EditorSource`, emit.
- **"Open in editor after capture" ON** → in `finish_commit`, after the normal
  save/clipboard/latest.png/DB work, open the editor **instead of** the HUD. (The capture is still
  auto-saved when `auto_save` is on; the editor edits that image.)

### 3.2 Frontend state (`useEditorStore`, Zustand)

Fields: `base` `{ dataUrl, width, height, origin, captureId? }`; `annotations: Annotation[]`
(array order = z-order); `selectedId: string | null`; `tool: ToolId`; `style`
`{ color, strokeWidth, fontSize }`; `stepCounter: number`; history `past[] / future[]` (snapshots
of `annotations`).

`Annotation` is a discriminated union by `type`, all carrying `id`, `z`, `style`:
- `arrow` | `line`: `{ x1, y1, x2, y2 }`
- `rect` | `ellipse` | `blur`: `{ x, y, w, h }`
- `text`: `{ x, y, text }` (+ `fontSize` in style)
- `pen` | `highlight`: `{ points: number[] }` (flat x,y list)
- `step`: `{ x, y, number }`

**Pure reducer actions (test-first, Vitest):** `add`, `update`, `delete`, `reorder`, `undo`,
`redo`, `nextStep`, plus geometry helpers (arrow head points, step-badge auto-increment).

### 3.3 Konva rendering

A `Stage` scaled to fit the viewport, retaining a scale factor `s = stageW / baseW` for full-res
export. Layers:
- **base layer**: a `Konva.Image` of the capture.
- **annotation layer**: maps `annotations` → Konva nodes.
- a **Transformer** bound to the selected node for move/resize.

Interactions: pointer down/move/up on the stage creates and drags the active annotation; the
`select` tool uses the Transformer; `Delete` removes the selection; `Esc` cancels/deselects;
double-click a text node opens an HTML `<textarea>` overlay for editing (standard Konva pattern).

**Blur/Pixelate (the one tool with depth):** a blur annotation is a rectangular region rendered as
a *second, cached, filtered copy of the base image* (`Konva.Filters.Blur` or `Pixelate`,
`node.cache()`), clipped to the rect. It reads from the base image and never bakes pixels — fully
non-destructive and editable/movable like any other annotation.

### 3.4 Style & tool UI

A tool rail (the 9 tools + `select` pointer + undo/redo + export actions) and a contextual style
toolbar: color swatches (default **red**, plus yellow/green/blue/black/white), stroke width
(S/M/L), and font size for the text tool. Built with the existing design tokens via the
frontend-design skill.

### 3.5 Rust commands (all app-defined — no ACL)

- `editor_open_from_last() -> Result<(), String>`
- `editor_open_capture(id: i64) -> Result<(), String>`
- `editor_source() -> Result<EditorSourceDto, String>` where `EditorSourceDto =
  { image_data_url, width, height, origin, capture_id? }`
- `editor_copy(png_base64: String) -> Result<(), String>` — decode → `clipboard::copy_image`.
- `editor_save(png_base64: String) -> Result<String, String>` — decode, write to `Pictures\Glint`
  (`capture_filename` + `dedupe`), `write_thumb` + `insert_capture` + emit `capture-saved`; returns
  the dest path. (Same path as auto-save → the annotated result appears in the Library instantly.)
- `editor_flatten_temp(png_base64: String) -> Result<String, String>` — write a temp PNG, return
  its path so drag-out can lift a real file.

Reuses `write_thumb`, `db::{NewCapture, insert_capture}`, `paths`, `clipboard`, and the `image`
crate. No new Rust dependencies.

### 3.6 New dependencies

- Frontend: `konva` + `react-konva` (pure client-side, no network). `vitest` (dev) for the reducer.
- Rust: none.

## 4. Data flow (Copy / Save / Drag)

1. User opens the editor (one of the three entry points) → `/editor` loads the base via
   `editor_source()`.
2. Annotations are added/edited in `useEditorStore`; Konva re-renders from the array.
3. On finish: the editor flattens the Stage at full res → PNG base64, then:
   - **Copy** → `editor_copy` → clipboard.
   - **Save** → `editor_save` → new PNG in `Pictures\Glint`, thumbnail + DB row, `capture-saved`
     event → the Library reloads and shows it.
   - **Drag out** → `editor_flatten_temp` → temp path → `dragOut(path)` (proven plugin path).

## 5. Error handling

Every command returns `Result<_, String>`; the editor surfaces inline status (mirrors the HUD,
since the main window owns its own feedback). Decode/IO failures are non-fatal — they flash an
error and leave the editor untouched. A "Discard annotations?" confirm guards navigation away from
an editor with unsaved edits (5a sessions are ephemeral; persistence is 5c).

## 6. Testing

- **Vitest (new):** the annotation reducer built test-first — `add`/`update`/`delete`/`reorder`,
  `undo`/`redo` (including the redo-after-edit branch), `nextStep` auto-increment, and arrow/step
  geometry helpers.
- **Rust:** export/save reuses already-tested Phase 4 paths; add a Rust test only if a new pure
  helper appears.
- **Green gate:** `tsc` + `vite build` + `cargo test` + `vitest`.
- **Manual acceptance (human at screen):** annotate from each entry point; every tool draws,
  selects, moves, resizes, deletes; undo/redo; Copy pastes the annotated image; Save adds a new
  Library card (original preserved); drag-out drops the flattened PNG; blur redacts and stays
  movable; "open in editor after capture" routes straight to the editor.

## 7. Risks & mitigations

- **Blur non-destructiveness / performance** — cache the filtered base once and reuse; re-cache only
  on region change. Pixelate is cheaper than Gaussian if blur proves heavy.
- **Full-resolution export on HiDPI** — drive `pixelRatio` from `baseWidth / stageWidth` so output
  matches native capture pixels regardless of on-screen scaling.
- **Cross-window navigation (HUD → main editor)** — the single `editor-open` listener + `EditorSource`
  state keeps it uniform across all three entry points.
- **Scope creep into framing** — crop and backgrounds are firmly 5b; 5a ends at a flat annotated
  image on the original canvas size.
