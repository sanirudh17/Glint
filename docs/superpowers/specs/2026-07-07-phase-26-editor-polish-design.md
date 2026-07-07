# Phase 26 — Editor polish: multi-region spotlight + four small wins

**Date:** 2026-07-07
**Status:** Design approved — awaiting spec review → plan.

## Context

Glint is a local-first Windows CleanShot X clone (Tauri v2 + React 19 + TS + Konva).
Phase 25 shipped redact + spotlight tools, delayed capture, and video presets, but
**deferred multi-region spotlight** as the next base. This phase delivers that plus four
developer-oriented editor wins in the same "polish bundle" shape as Phase 25.

This is intended as the **last feature phase before packaging/distribution** (the final
roadmap phase). Deliberately out of scope, project-wide: cloud/sharing, scrolling capture,
GIF, AI.

**Whole-phase properties:**
- Entirely in the capture/editor path (`glint/src/editor/`, `glint/src/views/editor/`).
  **Recorder isolation honored** — the recorder path is untouched.
- Expected to be **front-end only** (TypeScript/React/Konva). No Rust changes anticipated;
  persistence uses `localStorage`. `cargo` stays green because it's unchanged.
- **Green gate:** `npx tsc --noEmit` (0 errors) + `npx vitest run` (all pass) from `glint/`;
  `cargo clippy --all-targets` + `cargo test` still clean from `glint/src-tauri/`.

## Feature 1 — Multi-region spotlight (Approach B)

**Problem.** Today each spotlight annotation renders its *own* full-canvas dim group with a
single destination-out cut-out (`SpotlightRegion` in `AnnotationNode.tsx`). Two spotlights
therefore stack two dim layers: overlaps double-darken and neither region is truly bright
(each layer still dims through the other's hole). A spotlight effect needs **one** dim layer
with **N** holes.

**Approach B (chosen over "one annotation holding N regions").** Keep spotlights as ordinary
`BoxAnno`s — no model change, existing `.glint` docs unaffected, and every gesture
(select/drag/resize/delete/nudge/duplicate) keeps working with zero new interaction code. Move
*only the dim rendering* into one shared component.

**Design.**
- New render component `SpotlightDimLayer` (in `AnnotationNode.tsx` or a sibling file) takes
  the list of spotlight annotations and the base dimensions. It renders **one** cached Konva
  `Group` containing:
  - a single full-canvas black `Rect` at the shared dim opacity, then
  - one `Rect`/`Ellipse` per spotlight region with `globalCompositeOperation="destination-out"`
    (rect vs ellipse per each region's `style.region`).
  The group is cached (`node.cache({0,0,baseWidth,baseHeight})`) so the composite is isolated
  to the group's own buffer and never erases the base image — same technique the current single
  spotlight uses. Re-cache on any change to the spotlight set, geometry, dim, or base size.
- `SpotlightRegion` (per annotation) is reduced to **only** its invisible-but-hittable rect
  (`id={a.id}`, `fill=#fff opacity=0`, draggable) for selection/drag/resize/delete. It no longer
  draws any dim of its own.
- **Z-order.** `EditorStage` renders `SpotlightDimLayer` **once**, as the first (bottom) child
  of the annotations clip group — above the base screenshot (which lives in a separate, lower
  Konva layer) and **below all annotations**. So the dim affects *the screenshot* while every
  annotation (vector marks and image-effects alike) renders on top and stays fully visible. This
  is simpler and more robust than interleaving image-effects vs. marks (which would fracture the
  user's bring-forward/send-back z-ordering). The per-annotation spotlight hit-rects still render
  in their normal place in the annotation list (z-order only affects hit-testing).
- **Shared dim value.** Because there is one overlay, dim is conceptually a single property of
  the whole effect. Each spotlight annotation still carries `style.fillOpacity` (model stays
  uniform), but the StyleBar dim slider, when a spotlight is selected, updates the dim on **all**
  spotlight annotations together via a new store action `setSpotlightDim(v)` (updates every
  `type==="spotlight"` annotation's `fillOpacity`, one undo step). `SpotlightDimLayer` resolves
  the shared dim as the selected spotlight's `fillOpacity`, else the first spotlight's, else the
  seed default (0.6). Since the slider keeps them equal, this is unambiguous in practice.

**Export.** Unchanged path — the shared dim layer bakes into the flattened PNG via the existing
stage `toDataURL`, exactly like the current single spotlight. No backend export change.

**Edge cases.** Zero spotlights → `SpotlightDimLayer` renders nothing (no dim). One spotlight →
identical to today's look. Deleting/duplicating a spotlight re-caches the shared layer.

## Feature 2 — Per-tool style persistence

**Problem.** The editor store already keeps per-tool style memory (`toolStyles`), but
`loadDoc`/`reset` clear it, so it resets every time the editor opens — preferred colors/sizes
don't survive between captures or restarts.

**Design.**
- Persist `toolStyles` to `localStorage` under a stable key (`glint.editor.toolStyles`) on every
  `setStyle`. Hydrate it on store creation (and keep it through `loadDoc`/`reset` instead of
  wiping — the map is a user *preference*, not document state).
- Pure helpers `loadToolStyles()` / `saveToolStyles(map)` with a try/catch + shape validation
  (drop unknown keys / malformed styles → fall back to `{}`), unit-tested. Corrupt or absent
  storage degrades to today's behavior (empty map → `DEFAULT_STYLE`).
- Does **not** touch `.glint` documents: annotation styles inside a saved doc are independent;
  `toolStyles` only seeds the *next new* annotation per tool.

## Feature 3 — Eyedropper / color picker

**Design.**
- An eyedropper toggle button in the StyleBar's color area (it sets `style.color`, so it applies
  to whatever tool is active), plus the keyboard shortcut `i` (listed in the cheatsheet).
- Clicking it enters **pick mode** (a store flag `picking: boolean`, or local StyleBar state
  lifted as needed). While picking, `EditorStage` suppresses normal draw/drag; the next canvas
  click samples a pixel and exits pick mode back to the prior tool.
- **Sampling.** Draw the base `HTMLImageElement` to an offscreen canvas once (memoized) and read
  `getImageData` at the pointer mapped into image pixels. A pure `sampleColorAt(imageData, x, y)
  → "#rrggbb"` function (unit-tested) does the readback; a pure pointer→image-coordinate mapper
  (reuse existing layout math) converts stage coords. Sampling reads the **base screenshot**
  (not annotations/frame) — the point is to grab colors from the captured image.
- A small color swatch follows the cursor during pick mode (minimal loupe). Esc cancels pick mode.

## Feature 4 — Shortcuts cheatsheet

**Design.** Press `?` (Shift+/) in the editor to open a modal overlay listing every shortcut —
tool keys (`v/a/l/r/o/t/p/h/b/k/f/s/e/c`, plus the new eyedropper `i`) and actions (undo/redo,
duplicate, delete, nudge, save, spotlight/redact, etc.), grouped (Tools / Editing / File). Esc or
a click on the backdrop closes it; a small `?` affordance in the UI opens it too. Purely
presentational component driven from a static, single-source shortcut table (kept next to the
key map so the two don't drift). A light smoke test asserts it renders and lists a couple known
keys.

## Feature 5 — Copy / export at 2×

**Design.**
- A `1× / 2×` scale toggle in the export bar (default 1× = native composition pixels). The
  choice persists to `localStorage` (`glint.editor.exportScale`).
- `ExportBar.flatten()` multiplies the existing `exportPixelRatio(layout, stageW)` by the scale,
  applied to **Copy / Export / Drag**. **Done stays native** (it hands off to the corner HUD for
  further action, where a supersampled image would be surprising).
- **Honest caveat (documented in UI tooltip + spec):** 2× supersamples — the *base image* just
  scales up (bigger file, no new detail), while the *vector layers* (annotations, frame, window
  chrome, text) render at genuinely higher resolution and look crisper. Best value on framed /
  annotated compositions.
- The scale-multiplied pixel-ratio math is trivially unit-testable (a pure `scaledPixelRatio`).

## Testing

- **Unit (vitest):** `sampleColorAt`, pointer→image mapping, `loadToolStyles`/`saveToolStyles`
  (round-trip + corrupt-input fallback), export scale math, and any pure spotlight-dim resolution
  helper. Cheatsheet smoke test.
- **Manual / at-screen:** multi-region spotlight (two+ regions, overlap, no double-dark, each
  bright; drag/resize/delete each; dim slider moves all together; export bakes correctly);
  eyedropper picks the right color; style memory survives reopen + restart; `?` overlay; 2× export
  produces a larger, crisper-vector PNG.

## Isolation & compatibility

- All edits confined to `editor/` + `views/editor/` (+ possibly a tiny `lib/editor` helper). The
  recorder path (`recorder/`, `settings/` recorder keys) is not touched.
- No annotation-model schema change → existing `.glint` files load unchanged. `toolStyles` and
  `exportScale` are preferences in `localStorage`, never in the doc.

## Acceptance criteria

1. Multiple spotlight regions dim the background once (no double-darkening) with every region
   bright; each is individually selectable/movable/resizable/deletable; the dim slider adjusts all
   together; the effect bakes into Copy/Export/Done.
2. Per-tool style choices persist across editor reopen and app restart; `.glint` docs unaffected.
3. Eyedropper sets the current color from a clicked pixel of the base screenshot.
4. `?` opens a readable shortcut cheatsheet; Esc closes it.
5. A 2× toggle produces a 2× PNG on Copy/Export/Drag with visibly sharper vector layers.
6. Full green gate passes; recorder path unchanged.
