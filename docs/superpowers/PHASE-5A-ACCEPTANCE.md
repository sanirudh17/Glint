# Phase 5a — Annotation Editor — Acceptance

**Branch:** `phase-5a-editor`
**Status:** Implementation complete; automated gate green. Manual (human-at-screen) acceptance pending.

## Automated gate (green)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vite build` | clean (only the pre-existing Konva vendor chunk-size advisory) |
| `npx vitest run` | 13 passed, 0 failed (3 files) |
| `cargo test` | 34 passed, 0 failed, 2 ignored (real-capture smoke) |
| `cargo clippy --all-targets` | clean (0 warnings) |

Frontend unit tests this phase: `editor/model` (5), `editor/useEditorStore` (7), `editor/smoke` (1).
Rust: `settings::` gained `apply_update_sets_open_in_editor_bool` (the `open_in_editor` setting).

## Architecture (how it holds together)

- **The annotation array is the single source of truth.** A Zustand store (`editor/useEditorStore.ts`)
  holds `{ base, annotations, selectedId, tool, style, past, future }`. Konva renders *from* that array —
  every shape on screen is a projection of a serializable annotation. This is what makes undo/redo,
  and (in a later phase) `.glint` save/load and unit-testing, fall out for free.
- **Gesture-grained undo.** Mutations (`add`/`update`/`remove`) never auto-snapshot. The caller calls
  `pushHistory()` exactly once at the *start* of a gesture (shape creation, a drag, a transform, a
  delete). `pushHistory` clears the redo future. So one drag = one undo step, not one-per-pixel.
- **Native-resolution flatten.** The stage is rendered scaled-to-fit, but export computes
  `pixelRatio = base.width / stage.width()` and calls `stage.toDataURL({ pixelRatio })`, so the PNG
  comes out at the *original capture* resolution regardless of how the editor was sized on screen.
  The selection Transformer is hidden during the flatten (try/finally restore) so its handles never
  bake into the image.
- **Non-destructive throughout.** Save writes a **new** PNG to `Pictures\Glint` (and inserts a Library
  row, reusing the Phase 4 save/thumbnail path) — it never overwrites the source capture. Blur is a
  cached, clipped, blurred *copy* of the base image computed at render time — never baked into stored
  pixels.
- **Recorder isolation preserved.** The editor path pulls in `konva`/`react-konva` only; it has no
  ffmpeg/scap/recorder dependency.

## What shipped

- **Three entry points into the editor** (all open the existing main window and route to `/editor`):
  1. HUD **Annotate** action → `editor_open_from_last` (encodes the last capture, tears down the HUD).
  2. Library card **Edit** (pencil) button → `editor_open_capture(id)` (reads the saved file).
  3. Capture with the **Open in editor** setting ON → `finish_commit` routes straight into the editor
     instead of the HUD.
- **Ten tools** on the left rail: Select (V), Arrow (A), Line (L), Rectangle (R), Ellipse (O),
  Text (T), Pen (P), Highlighter (H), Blur (B), Step counter (S), plus Undo / Redo buttons.
- **Style bar** (top): 6 color swatches, S/M/L stroke widths, and a font-size input that appears for
  the Text tool. Applying a style sets the tool default *and* restyles the current selection (merging
  onto the selection's own style, not clobbering its other properties).
- **Selection & editing:** click to select (Select tool), drag to move, Transformer to resize
  (rotation disabled), `Delete`/`Backspace` to remove.
- **Keyboard:** single-key tool shortcuts, `Ctrl+Z` undo / `Ctrl+Shift+Z` redo, `Delete` — all
  suppressed while typing in an input.
- **Export bar** (top-right): **Drag** (drops a flattened temp PNG into any app via the proven
  drag-out path), **Copy** (clipboard), **Save** (new PNG to `Pictures\Glint`, shows in Library).

## Manual checklist (human at screen)

**Entry**
- [ ] HUD **Annotate** opens the editor with the just-captured image as the base.
- [ ] Library card **Edit** (pencil) opens the editor with that saved capture.
- [ ] With **Settings → Auto-save → Open in editor** ON, a new capture opens the editor directly
      (no HUD); with it OFF, capture behaves as before (HUD/auto-save).

**Tools** (draw each; confirm it renders and is created in red `#E5484D` by default)
- [ ] Arrow, Line — drag from start to end; arrowhead on the arrow.
- [ ] Rectangle, Ellipse — drag to size; dragging up-left also works (no inversion glitch).
- [ ] Text — click places editable text.
- [ ] Pen — freehand stroke follows the cursor smoothly.
- [ ] Highlighter — fat, translucent stroke.
- [ ] Step — numbered badge; consecutive steps increment (1, 2, 3…).
- [ ] Blur — drag a region; the area under it is blurred (and only that area).

**Style**
- [ ] Switching swatches/widths changes the *next* shape's color/width.
- [ ] Selecting an existing shape and clicking a swatch recolors it **without** resetting its width.
- [ ] Font-size input appears only for the Text tool and changes text size.

**Select / move / resize / undo**
- [ ] Select tool: click a shape → Transformer handles appear; drag to move; resize via handles.
- [ ] Arrow/Line and Blur drag to the correct place (no "teleport" or doubled offset).
- [ ] `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo one whole gesture at a time.
- [ ] Select a shape and press `Delete` → it's removed (and undoable).

**Export (the payoff)**
- [ ] **Copy** → paste into another app shows the **annotated** image.
- [ ] **Save** → a new PNG lands in `Pictures\Glint` and a card appears in the Library; the original
      capture is untouched.
- [ ] Open a saved annotated PNG and confirm its pixel dimensions equal the **original capture's**
      dimensions (native resolution, not the on-screen editor size).
- [ ] No selection handles / Transformer chrome are visible in any exported image.
- [ ] **Drag** the export button → drops the annotated PNG into Explorer / a chat as a real file.

## Known limitations (intentionally deferred)

- **Pen/Highlighter can't be repositioned after drawing** (freehand has no x/y origin). Dragging one
  is a harmless no-op today; a guard is noted for polish.
- **Step numbers don't fill gaps** — deleting step 2 then adding a step yields 3, not 2 (`max + 1`).
- **Transformer resize** is visual; for shapes it does not yet write scaled geometry back to the
  store on resize-end (move and handle-resize of box shapes is fine for 5a; full scale→geometry
  commit is a polish item).
- **Image cropping, backgrounds/framing** (5b) and **`.glint` save/load** (5c) are later sub-phases.
