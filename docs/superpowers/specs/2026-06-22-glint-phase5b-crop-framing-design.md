# Glint Phase 5b — Crop + Backgrounds/Framing — Design

**Status:** Approved (brainstorming). Next: implementation plan (writing-plans).
**Branch:** `phase-5b-composition` (off `master` @ Phase 5a merged).
**Predecessors:** 5a annotation editor (merged). **Successor:** 5c `.glint` save/load + export refinements.

## Goal

Add the *composition layer* to the annotation editor: **crop** the screenshot, and wrap it in a
**background/frame** (the CleanShot-style "beautiful screenshot" — padding, solid/gradient/transparent
backdrop, rounded corners, drop shadow, optional aspect-ratio presets). Both are non-destructive,
serializable, and rendered live (WYSIWYG) in the existing Konva stage.

## Constraints (inherited, still binding)

- **Local-first.** No cloud, network, uploads, accounts. Gradient presets and all backdrops are
  computed in-app (color-stop arrays / fills) — **no bundled image assets, no downloads**.
- **Recorder isolation.** The editor path has zero ffmpeg/scap/recorder dependency. Unchanged here.
- **Non-destructive.** Crop and frame never bake or discard original pixels; they are stored as state
  and applied at render/export. The source capture is never modified.
- **Serializable.** Crop + frame are plain data so 5c can persist the whole document to `.glint`.

## Scope

**In:** crop tool; frame panel with solid/gradient/transparent backgrounds, padding, rounded corners,
drop shadow, aspect presets (Auto / 1:1 / 16:9 / 4:3); live Konva rendering of the composition;
export pipeline updated to flatten the framed composition at native resolution; a pure, unit-tested
`composition.ts` layout module.

**Out (explicitly deferred):** image/wallpaper backgrounds (declined — keeps it asset-free); `.glint`
save/load (5c); custom gradient authoring (presets only this phase); per-side / asymmetric padding.

## Chosen approach (approved)

**Live in Konva, composite at export (WYSIWYG).** The editor canvas *becomes* the framed
composition. The existing export (`stage.toDataURL`) already captures the whole stage, so the flatten
is unchanged in shape — only the resolution math updates. Rejected alternatives: apply-frame-only-at-
export (blind editing) and destructive pixel-baking (loses original, breaks 5c serialization + undo).

## Composition model (editor state)

Two additions to `useEditorStore`, alongside `annotations` — together these form the serializable
"document":

```ts
crop: { x: number; y: number; w: number; h: number } | null   // image-space; null = full frame

type FrameBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; gradientId: string }
  | { type: "transparent" };

interface FrameConfig {
  enabled: boolean;
  background: FrameBackground;
  padding: number;   // 0–100 → fraction of the content's long edge (0 = none, 100 = ~25%/side)
  radius: number;    // screenshot corner radius, image-native px
  shadow: number;    // 0–100 intensity (0 = no shadow)
  aspect: "auto" | "1:1" | "16:9" | "4:3";
}
frame: FrameConfig;   // always present; frame.enabled gates rendering
```

- **Defaults:** `crop: null`; `frame: { enabled:false, background:{type:"gradient", gradientId:"<first preset>"},
  padding:40, radius:12, shadow:35, aspect:"auto" }`. With `enabled:false` the canvas looks exactly as it
  does today.
- **Undo:** crop is *structural* → the history snapshot extends from `annotations` to
  `{ annotations, crop }` (a contained change to the existing undo/redo). Frame styling is *live* tweak
  state (like the current style-bar color/width — not in the undo stack); a **Reset frame** button
  restores defaults.
- **Annotations + crop:** annotations are kept in original image coordinates. A crop clips what's
  visible but never deletes annotations — un-cropping (or reset) brings them back.

## Pure layout module: `glint/src/editor/composition.ts`

All non-trivial math lives here, pure and unit-tested (no Konva, no React):

```ts
interface Layout {
  // All values in image-native px (the "composition" coordinate space).
  contentW: number; contentH: number;          // cropped screenshot size
  contentX: number; contentY: number;          // top-left of the screenshot within the composition
  compositionW: number; compositionH: number;  // full framed output size
  paddingPx: number;                            // resolved padding (per side)
  cropX: number; cropY: number;                 // resolved crop origin (0,0 when no crop)
}

function computeLayout(imageW, imageH, crop, frame): Layout;
// - content = crop ?? full image
// - frame disabled → composition == content, offset (0,0), no padding
// - frame enabled → paddingPx = round(padding/100 * 0.25 * max(contentW,contentH))
//   base composition = content + 2*paddingPx each axis
//   aspect != auto → letterbox: enlarge the composition on whichever single
//   axis is deficient until W:H equals the target ratio (content never shrinks),
//   re-centering content (contentX/Y absorb the extra space)
function exportPixelRatio(layout: Layout, stageW: number): number;  // compositionW / stageW
function normalizeRect(r): {x,y,w,h};   // fold negative w/h from an up-left crop drag
```

Tested: frame-off identity; padding math; each aspect preset's letterboxing + centering;
crop offset; negative-drag normalization; export pixel-ratio yields native content resolution.

## Rendering (EditorStage restructure)

The stage size becomes `compositionW/H × fitScale(viewport)`. Layers, bottom to top:

1. **Background layer** (only when `frame.enabled`): a `Rect` filling the stage.
   - solid → `fill`; gradient → `fillLinearGradient*` from the preset's color-stops + angle;
     transparent → no rect (stage stays clear → alpha in export).
2. **Screenshot card:** at `(contentX, contentY)`, size `contentW×contentH`:
   - a rounded `Rect` (radius `frame.radius`) carrying the **shadow** (`shadowBlur/Opacity` from
     `frame.shadow`) — drawn first so it sits under the image;
   - the base `Image` with Konva's built-in `crop={cropX,cropY,contentW,contentH}`, clipped to the
     same rounded rect (a `Group` with a rounded-rect `clipFunc`). Radius/shadow apply only when the
     frame is enabled; disabled → plain image, no rounding/shadow.
3. **Annotation layer:** offset so image-point `(cropX,cropY)` maps to `(contentX,contentY)` — i.e.
   layer position `(contentX - cropX, contentY - cropY)` — and **clipped** to the content rect (rounded
   when framed) so strokes never spill onto the backdrop. Annotation geometry stays in image coords;
   creation math (`imgPoint`) subtracts the same offset.
4. **Transformer + crop overlay** as today / as below.

Gradient presets: a small bundled table in `composition.ts` (or a sibling `gradients.ts`) —
`{ id, label, stops: [{offset,color}], angleDeg }`. ~8 tasteful presets. No assets.

## Crop tool

A **Crop** entry in the left rail. Activating it enters crop mode:

- a draggable/resizable rectangle (8 handles) with a dimmed surround, initialized to the current
  content bounds;
- **Enter** confirms → `setCrop(normalizeRect(rect))`; **Esc** / switching tools cancels;
- a **Reset crop** affordance clears `crop` back to `null`;
- annotations remain visible but non-interactive while cropping.

Crop is in image-space and clamped to image bounds. Re-entering crop starts from the existing crop.

## Frame panel

A **Frame** toggle in the top bar opens a panel docked on the right (slides in), so the style bar
isn't crowded. Contents:

- **Background:** segmented Solid / Gradient / Transparent. Solid → the shared swatches + custom color
  picker (reused from the style bar). Gradient → a row of preset chips.
- **Padding** slider (0–100), **Radius** slider, **Shadow** slider (0 = off).
- **Aspect** select: Auto / 1:1 / 16:9 / 4:3.
- **Reset frame** button.

Toggling the panel on sets `frame.enabled = true`; a master on/off keeps the last config.

## Export pipeline

`ExportBar` flatten is unchanged in shape (`stage.toDataURL`), now capturing the full composition.
Resolution: `pixelRatio = exportPixelRatio(layout, stage.width())` so the screenshot inside always
exports at its true native resolution and the backdrop/padding scale with it. Transparent background
→ PNG with alpha (Konva `toDataURL` preserves it). Copy / Save / Drag all reuse the same flattened
PNG and the existing Rust commands unchanged.

## UI layout summary

- Left rail: existing tools **+ Crop**.
- Top bar: StyleBar (left) · **Frame toggle** · ExportBar (right).
- Right: **Frame panel** (visible when toggled).
- Frame off + no crop → identical to today's editor.

## Testing

- **Vitest (pure):** `composition.ts` — layout for frame-off, padding, each aspect preset, crop offset,
  pixel-ratio, rect normalization. Store: crop set/reset, crop undo/redo (snapshot now includes crop),
  frame config set/reset, `frame.enabled` gating.
- **At-screen (manual, as 5a):** live frame rendering (each background type), crop drag/confirm/reset,
  annotations clipped to the screenshot, shadow/radius/aspect visuals, and **export fidelity** —
  exported PNG dimensions = native composition size, screenshot region at native resolution,
  transparent background exports with alpha.

## File-level changes (anticipated)

- New: `glint/src/editor/composition.ts` (+ `.test.ts`); `glint/src/editor/gradients.ts`;
  `glint/src/views/editor/CropOverlay.tsx`; `glint/src/views/editor/FramePanel.tsx`.
- Modify: `useEditorStore.ts` (crop + frame state, crop in history); `EditorStage.tsx` (composition
  layout, background layer, screenshot card, layer offset/clip, crop mode); `ToolRail.tsx` (Crop tool);
  `ExportBar.tsx` (pixel-ratio via `exportPixelRatio`); `EditorView.tsx` (mount Frame panel/toggle);
  `model.ts` (`ToolId` gains `"crop"`); `editor.css` (panel + crop overlay styles).
- Rust: none expected (export reuses existing `editor_copy`/`editor_save`/`editor_flatten_temp`).
