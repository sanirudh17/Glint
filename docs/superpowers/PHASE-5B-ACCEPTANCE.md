# Phase 5b — Crop + Backgrounds/Framing — Acceptance

**Branch:** `phase-5b-composition`
**Status:** ACCEPTED (user at-screen, incl. the shadow/checkerboard/colors refinement round). Merged to `master`.

## Automated gate (green)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vite build` | clean (only the pre-existing Konva vendor chunk-size advisory) |
| `npx vitest run` | 30 passed, 0 failed (5 files) |
| `cargo test` | 34 passed, 0 failed, 2 ignored (real-capture smoke) |
| `cargo clippy --all-targets` | clean (0 warnings) |

Frontend unit tests added this phase: `editor/composition` (7), `editor/gradients` (4),
`editor/useEditorStore` composition group (4 new → 13 total). **No Rust changes this phase** — export
reuses the existing `editor_copy` / `editor_save` / `editor_flatten_temp` commands unchanged.

## Architecture (how it holds together)

- **One pure layout module owns all the geometry.** `editor/composition.ts` (`computeLayout`,
  `exportPixelRatio`, `normalizeRect`) is pure, Konva-free, and unit-tested. Given the base image size,
  an optional crop, and the layout-relevant frame fields, it returns the full framed geometry in
  image-native pixels (content size/offset, composition size, padding, crop origin). `EditorStage`,
  `ExportBar`, and `CropOverlay` all consume the same `Layout` — there is a single source of truth for
  where every pixel goes.
- **Frame off + no crop is the identity.** With `frame.enabled === false` and `crop === null`,
  `computeLayout` returns `contentX/Y = 0`, `cropX/Y = 0`, `composition = image`. Every downstream
  mapping (`imgPoint`, the annotation layer offset, the text-edit overlay, the export pixel-ratio)
  reduces to its pre-5b form, so the editor is byte-identical to Phase 5a until you turn the frame on
  or crop. (Verified by review, tracing each coordinate.)
- **Non-destructive + serializable composition.** `crop` (`{x,y,w,h} | null`) and `frame`
  (`FrameConfig`: background / padding / radius / shadow / aspect) are plain JSON-able store state.
  The crop renders via Konva's built-in `Image.crop` (a sub-region view — no pixel copy); the original
  capture is never touched. This sets up 5c `.glint` persistence.
- **Crop joins the undo snapshot; frame styling is live.** History snapshots widened from
  `Annotation[]` to `DocSnapshot = { annotations, crop }`, so a crop is one undoable step
  (`pushHistory()` before `setCrop`). Frame styling is live tweak state (like the style bar) and is
  reset via **Reset frame** rather than undo.
- **Live WYSIWYG, flattened at native resolution.** The editor canvas *is* the framed composition:
  a background layer (solid / gradient / transparent), the screenshot as a rounded, shadowed card, and
  the offset+clipped annotation layer. Export keeps `stage.toDataURL`, now with
  `pixelRatio = exportPixelRatio(layout, stage.width())` so the screenshot exports at true native
  resolution and the backdrop/padding scale with it. Transparent background → PNG with alpha.
- **Local-first, recorder isolation preserved.** Gradients are computed color-stop arrays
  (`editor/gradients.ts`) — no bundled image assets, no network. The editor path still pulls in
  `konva`/`react-konva` only; no ffmpeg/scap/recorder dependency, no new Rust deps.

## What shipped

- **Crop tool** (`C` / rail): drag/resize an 8-handle rectangle with a dimmed surround over the
  screenshot; **Enter** applies, **Esc** cancels; clamped to image bounds; re-entry starts from the
  current crop. **Reset crop** lives in the Frame panel.
- **Frame toggle + panel** (top bar → right dock): background segmented control (Solid swatches +
  custom color · 8 gradient presets · Transparent), Padding / Radius / Shadow sliders, Aspect presets
  (Auto / 1:1 / 16:9 / 4:3), and **Reset frame** / **Reset crop**.
- **Live frame rendering**: backdrop fill, rounded-corner screenshot card, drop shadow, padding, and
  aspect letterboxing (content re-centers; never shrinks).
- **Native-resolution export** of the full framed composition through Copy / Save / Drag (unchanged
  Rust commands).

## At-screen manual checklist (human acceptance)

Run `npm run tauri dev`, open the editor (capture → Annotate, or Library → Edit).

- [ ] **Frame off + no crop = unchanged.** Draw/select/move/text-edit/export behave exactly as Phase 5a.
- [ ] **Crop:** press `C`, drag/resize the rectangle; **Enter** applies → only the cropped region shows;
      annotations outside the crop are clipped (not deleted); **Esc** cancels; **Reset crop** restores.
- [ ] **Crop undo:** after applying a crop, **Ctrl+Z** restores the previous crop; **Ctrl+Shift+Z** redoes.
- [ ] **Frame toggle:** click **Frame** → screenshot insets on the backdrop with rounded corners + shadow;
      toggling off restores the bare screenshot (config remembered).
- [ ] **Backgrounds:** Solid (each preset swatch + the custom color picker), each Gradient preset,
      and Transparent (the padding area shows the app backdrop, not a fill).
- [ ] **Sliders:** Padding, Radius, Shadow each visibly change the composition; **Reset frame** restores
      defaults (padding 40, radius 12, shadow 35, gradient background, off).
- [ ] **Aspect:** 1:1 / 16:9 / 4:3 letterbox the composition and keep the screenshot centered; Auto = none.
- [ ] **Export fidelity:** Save / Copy / Drag → the PNG dimensions equal the native composition size, the
      screenshot region is at native resolution, a **transparent** background exports with alpha, and no
      crop overlay / selection chrome is baked in.
- [ ] **Annotations + frame:** strokes stay clipped to the screenshot card (don't spill onto the backdrop);
      a selected annotation's Transformer handles are fully visible even at the screenshot edge.

## Known limitations (deferred)

- **Image/wallpaper backgrounds** are out of scope (keeps the app asset-free); backgrounds are
  solid/gradient/transparent only.
- **Custom gradient authoring** is deferred — presets only this phase.
- **Per-side / asymmetric padding** is deferred (single padding slider).
- **Transformer resize still doesn't commit scaled geometry back to the store** (carried over from 5a;
  store/Konva divergence on resize) — unchanged this phase.
- **`editor_flatten_temp` temp PNGs are not swept** (carried over from 5a) — a startup sweep is a later
  polish item.
- Drawing a stroke that *starts* in the frame padding (frame on) is allowed but clipped to the
  screenshot, so it can be invisible — a minor papercut, not a correctness issue.
