# Glint — Phase 12: Editor Essentials + "Done" Hand-off (Design)

**Date:** 2026-07-02
**Branch:** `phase-12-editor-essentials` → merge to `master`
**Status:** design (awaiting spec review)

## Goal

Make the annotation editor feel like CleanShot by (1) adding a **Done** hand-off that
turns the edited image into a bottom-left HUD, and (2) batching several small,
high-value editing improvements into one shippable phase.

This is the first slice of the CleanShot-parity backlog
(`docs/superpowers/IMPROVEMENTS-AND-ADDITIONS.md`, items A1/A4/A5/A6, B1/B2/B3/B8, E3).

## Non-goals (deferred to later phases)

Multi-select + group ops (A3), full text callouts (B5), window-frame chrome +
custom/image backgrounds (C), the Quick Access Overlay (E1). Out of scope permanently:
cloud/share, accounts, network.

---

## Part 1 — "Done" → bottom-left HUD

### Behaviour
A primary **Done** button in the editor top bar. On press:
1. Flatten the current composition to a PNG at native resolution (reuse `ExportBar`'s
   `flatten()` logic — crop + frame + annotations, Transformer hidden).
2. Hand the PNG to a new `editor_done` command, which makes it the current capture
   result and opens the existing post-capture HUD.
3. The editor (main window) **hides**; the **bottom-left HUD** shows with its normal
   actions (Copy · Save · Reveal-after-save · Copy path · drag-out · Annotate · Dismiss).

This mirrors the post-capture flow exactly — a capture produces a bottom-left HUD; now
"finishing an edit" produces the same HUD. Zero new HUD UI.

### Why this is a clean fit (grounded in code)
- `crate::hud::open` already builds the HUD **bottom-left of the primary monitor**,
  fresh each time, focus-less, torn down on the next capture/dismiss.
- The HUD reads `LastCaptureState` (`LastCapture { path, width, height, rgba, saved }`)
  via `hud_data`; its actions (`hud_copy`/`hud_save`/`hud_copy_path`/`hud_reveal`/
  `hud_dismiss` + drag) all operate on that state.
- The editor **already** couples to this layer legitimately: `editor_open_from_last`
  reads `LastCaptureState` and calls `crate::hud::teardown`. "Done" is the inverse
  (editor → set last capture → open HUD). **No isolation rule is touched** (the sacred
  rule constrains `recorder/`, not editor↔capture).

### Backend — new command `editor_done`
```
#[tauri::command]
fn editor_done(app, last: State<LastCaptureState>, png_base64: String) -> Result<(), String>
```
- Decode base64 → PNG bytes → `image` rgba8 (width, height). (Same `decode_png_arg`
  helper `editor_copy`/`editor_save` use.)
- Write the PNG to a temp file (reuse the `editor_flatten_temp` path convention) so the
  HUD's drag-out / copy-path / reveal have a real file. `saved: false` (temp, not yet in
  the Library — HUD shows **Save**, not Reveal).
- Set `LastCaptureState = LastCapture { path: temp, width, height, rgba, saved: false }`.
- Open the HUD **off the main thread** (webview build rule — `hud::open` must not run on
  the main thread): spawn a thread that calls `crate::hud::open(&app)` and, on success,
  hides the `main` window. (If the HUD fails to build, do **not** hide main — leave the
  editor visible and toast, so the user is never stranded with no window.)

### Frontend
- `lib/editor.ts`: `editorDone(pngBase64: string): Promise<void>` → `invoke("editor_done",
  { pngBase64 })` (camelCase key — Tauri maps to `png_base64`).
- `ExportBar.tsx`: add a **Done** button (primary). Reuse the existing `withPng` flatten
  wrapper: `const onDone = withPng(async (png) => { await editorDone(png); })`. Demote the
  current **Export** button from primary styling (Done becomes the primary action; Export
  stays available). Order: Drag · Copy · Export · **Done**.
- No editor-side navigation needed: the backend hides `main`; when the user later reopens
  (tray / hotkey / HUD "Annotate"), the app shows again.

### Edge cases
- No `base` → Done disabled (same guard as the other export buttons).
- Flatten returns "" (stage not laid out) → toast "Couldn't render the image", no hide.
- HUD build fails → toast, editor stays visible.

---

## Part 2 — Editor tool depth + workflow (batched small wins)

All model changes are **additive with safe defaults** so existing `.glint` docs and the
current tests keep working. `model.ts` functions stay pure.

### 2a. Model — `Style` gains optional fields
```
interface Style {
  color: string; strokeWidth: number; fontSize: number;
  fill?: string | null;      // rect/ellipse interior; null/undefined = no fill (today's look)
  fillOpacity?: number;      // 0..1, default 1 (used only when fill set)
  dashed?: boolean;          // dashed stroke for line/arrow/rect/ellipse; default false
  arrowStart?: boolean;      // arrow tool: draw a head at the start too; default false
}
```
- `DEFAULT_STYLE` keeps `fill: null, fillOpacity: 1, dashed: false, arrowStart: false`.
- Rendering (`EditorStage`): rect/ellipse pass `fill` (with `fillOpacity` via rgba or
  Konva `opacity` on fill) when set; `dash: [12,8]` when `dashed`; arrow uses
  `pointerAtBeginning` when `arrowStart`. Arrowhead size already scales with strokeWidth.

### 2b. StyleBar — contextual controls
Extend `StyleBar` (which already applies style to the active tool default **and** the
selection) with tool-aware extras:
- rect / ellipse: a **Fill** control — a "none" chip + the palette + custom picker, plus a
  small **opacity** slider (shown only when a fill is set).
- line / arrow: a **dashed** toggle.
- arrow: a **start-head** toggle.
Existing color/width/fontSize controls are unchanged.

### 2c. 45°-constrain while drawing (B8)
In `EditorStage`'s line/arrow draw handler: when **Shift** is held, snap the second point
so the segment angle is the nearest multiple of 45° (pure helper `snapAngle(x1,y1,x2,y2)`
in `model.ts`, unit-tested). Does not affect rect/ellipse.

### 2d. Duplicate (A1) — Ctrl+D
- `model.ts`: `duplicateAnnotation(a): Annotation` → deep-ish clone with `newId()` and a
  +12,+12 px offset (offsets `x/y`, both points of two-point annos, or every vertex of
  freehand; steps get the next step number). Pure, unit-tested.
- Store: `duplicate(id)` → pushHistory, add the clone, select it.
- `EditorView` keydown: Ctrl/Cmd+D → duplicate the selection (guard: only when something
  is selected; `preventDefault`).

### 2e. Arrow-key nudge (A4)
- `model.ts`: `nudgeAnnotation(a, dx, dy): Annotation` (pure) — shifts x/y, both points,
  every freehand vertex, or step x/y.
- `EditorView` keydown: Arrow keys nudge the selection by 1px (10px with Shift). One
  `pushHistory()` at the start of a nudge run is enough; to keep it simple each keydown
  pushes history (undo coalescing is a later nicety). Ignored when typing in an input.

### 2f. Z-order (A5) — bring forward / send back
- Store: `bringForward(id)` / `sendBackward(id)` reorder within `annotations` (the array
  order IS paint order; the `z` field is normalized on reorder). Pure reorder helper in
  `model.ts`, unit-tested.
- Shortcuts: Ctrl+] / Ctrl+[ in `EditorView`. (Optional tiny buttons in StyleBar when a
  shape is selected — nice but not required for the phase.)

### 2g. Per-tool style memory (A6)
- Store: replace the single `style` default behaviour with a `toolStyles:
  Partial<Record<ToolId, Style>>` map. `setTool(t)` loads `toolStyles[t] ?? DEFAULT_STYLE`
  into the active `style`; `setStyle(patch)` updates the active `style` **and** writes it
  back to `toolStyles[currentTool]`. Net effect: picking a red arrow leaves the next arrow
  red without changing the rect's colour. Selection-editing still patches the selected
  annotation's own style (unchanged).

---

## Testing

- **model.test.ts:** defaults for the new Style fields; `snapAngle` (0/45/90/…);
  `duplicateAnnotation` (new id, offset, per-type); `nudgeAnnotation` (per-type);
  z-order reorder helper.
- **useEditorStore.test.ts:** `duplicate` selects the clone + pushes history;
  `bringForward`/`sendBackward` reorder; `toolStyles` — switching tools restores that
  tool's last style; `setStyle` writes back per tool.
- **Rust:** `editor_done` decode path reuses the tested `decode_png_arg`; a small test
  that a valid base64 PNG decodes to expected dims (mirrors `editor_copy`). HUD/window
  behaviour is verified at-screen.
- Existing 63 vitest + 103 cargo tests must stay green.

## Isolation & constraints
- Recorder untouched; `recorder/*` isolation greps stay clean.
- Editor↔capture/hud coupling is pre-existing and allowed.
- Local-only; no network; no new capability files (no new window labels — reuses `hud`).

## At-screen acceptance
1. Annotate → **Done** → editor hides, bottom-left HUD appears with the annotated image;
   Copy / Save / drag / Annotate / Dismiss all act on the edited result.
2. Fill + opacity on rect/ellipse; dashed line/arrow; arrow start-head; Shift = 45° lines.
3. Ctrl+D duplicates (offset, selected); arrow keys nudge (Shift = 10px); Ctrl+]/[ reorder.
4. Per-tool style memory: red arrow doesn't recolour the next rectangle.
5. Undo/redo covers duplicate, nudge, z-order; existing tools unaffected.
