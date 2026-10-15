# Phase 3 — Screenshot looks bundle

Status: complete for the agreed screenshot bundle. Acceptance checks and the final production build passed. Phase 4 has not started.
Branch: `phase-3-screenshot-looks`, based on Phase 2 commit `1f473b7`.

## Verified repository paths and assumptions

- Editor entry: `glint/src/views/EditorView.tsx`. There is no `EditorSidebar`;
  screenshot frame controls live in `glint/src/views/editor/FramePanel.tsx`.
- Shared looks: `glint/src/look/model.ts`, `LookControls.tsx`, `presets.ts` and
  `gradients.json`. The shared preset store already serves screenshots and Studio.
- Gradient rendering: `glint/src/editor/gradients.ts` currently supports 16 linear
  presets. Screenshot layout is in `glint/src/editor/composition.ts`.
- Screenshot rendering/export: `glint/src/views/editor/EditorStage.tsx` and
  `ExportBar.tsx`. Export flattens the actual Konva stage at composition resolution.
- Existing image backgrounds, window/browser chrome, custom shadow colors and
  solid/dashed borders should be extended and tested rather than recreated.
- `glint/src/editor/model.ts` already has pen, straight arrow and text annotations.
  `useEditorStore.ts` already has forward/backward layer actions, but `StyleBar.tsx`
  does not expose layer ordering or curved arrows/text style presets.
- `.glint` documents already embed the source PNG and serialized annotations.
  `glint/src-tauri/src/editor/document.rs` preserves the document payload;
  `ProjectBar.tsx` and `EditorView.tsx` already save and reopen editable projects.
- `glint/src/overlay/Loupe.tsx` already implements a pixel magnifier and hex color
  readout, wired through `SelectionLayer.tsx`, with visibility tests.
- Current aspect options already include 9:16 and 4:5. The remaining ratios and
  named export sizes must also preserve existing Studio preview/export behavior
  when stored in a shared look preset.

## Implementation plan and task commits

The user selected the screenshot bundle only. Existing image backgrounds,
window/browser frames, editable documents, pen/arrow tools and hex magnifier were
retained. Model-based background removal is explicitly deferred. No model or
inference dependency was added, and Phase 4 is not authorized by this completion.

| Task | Shipped behavior | Commit |
| --- | --- | --- |
| Gradients | 48 presets in five collections; old IDs/colors retained; editable angle, two/three colors, linear/radial/conic/mesh styles, grain and screenshot color matching | `9d3e88a` |
| Framing and sizes | Auto Balance, 3:2 and 1.91:1, six exact social/export sizes, custom resolution and a text watermark; existing border controls reused | `d84b4b7` |
| Image composition | File import/drop, movable/resizable image layers, side-by-side layout, canvas expansion, source-layer ordering and embedded save/reopen | `4d9ab11` |
| Annotation controls | Arrow bend, plain/heading/label/code text styles, themed font sizing and annotation ordering | `97484e5` |
| Preview and inspector | Worker-based procedural rendering, export readiness, readable image-layer buttons, full-width size choice and explicit pixel dimensions | `2a34749` |
| Compact editor | Toolbar remains usable at 760 px; source-layer drag/resize commits whole-pixel values | `f91c888` |

Auto Balance uses equal margins of about 10% of the shorter content edge and clears
fixed aspect/output-size constraints. Canvas dimensions add or trim source space
at the right/bottom; export dimensions change resolution and framing. Source images
stay below annotations, so privacy tools can cover the combined pixels.

All new serialized fields are optional. Existing `.glint` documents keep their
version and layout defaults. Screenshots and Studio still use the existing shared
look-preset store. Procedural rendering adds a small worker script, not wallpapers.

## Acceptance checklist

- [x] Each new option appears correctly in preview and the exported PNG.
- [x] Shared looks continue working in Studio preview and native export.
- [x] Default choices produce a useful result with one action.
- [x] Existing `.glint` documents retain their appearance and editable annotations.
- [x] Added image layers and new annotation fields survive save/reopen and undo.
- [x] No cloud service, accounts, analytics or bundled wallpaper assets are added.
- [x] Optional background-removal scope is explicitly recorded before Phase 3 closes.

## Verification evidence

- 243 frontend tests passed. After the final image-geometry change, the focused
  71 model/store/image-layer tests and TypeScript check passed again.
- 228 native tests passed; two existing real-display capture tests remain ignored.
- The final full Tauri debug production build passed. Packaged screenshot worker
  startup and the Studio backdrop were also checked in that binary.
- `scripts/screenshot-phase3-check.mjs` passed in the real WebView2 editor, including
  all 48 preset buttons, gradient geometries/colors/angle/grain, both new ratios,
  all six exact PNG export sizes, Auto Balance, watermark/border, image composition,
  four text styles, ordering, save/reopen and a shared-look native MP4 export.
- `scripts/screenshot-phase3-interaction.mjs` passed real pointer drag/resize,
  browser image drop, source-layer redaction pixels, persistence and a 1080p mesh
  responsiveness check. Maximum measured main-thread probe delay was 76.3 ms;
  the costly mesh computation runs in a worker.
- Dark desktop and compact light layouts were inspected. All toolbar buttons fit
  the 760 px viewport after the compact-layout correction.
- Static UI scan: zero failures; one warning concerns existing em dashes in source
  comments/copy. Screenshot shadow effects have explicit media-rendering exemptions.

Artifacts: OS temp folder `glint-phase3-1up5dn`, including `result.json`,
`interaction-result.json`, `production-smoke.json`, exported PNGs, UI captures and the decoded shared-look
video frame. Test-created Library captures were removed by exact returned paths;
recent-project settings were restored. No user source media was edited.

For a fresh validation run, first generate a synthetic video fixture with
`python scripts/studio-phase2-fixture.py`, then pass its root to
`node scripts/screenshot-phase3-fixture.mjs <video-fixture-root>`. With the app running
and WebView2 debugging on port 9227, open the generated `Legacy.glint`, then run:

```powershell
node scripts/screenshot-phase3-check.mjs <screenshot-fixture-root>
node scripts/screenshot-phase3-interaction.mjs <screenshot-fixture-root>
```

The fixtures contain fake demo text and generated images only.

## Deferred: optional background removal

No model download, inference runtime, new package dependency or background-removal
control is part of Phase 3, as explicitly requested.

A small candidate for a later opt-in implementation is **U²-NetP in ONNX format**.
It would run locally through **ONNX Runtime CPU for Windows x64**, called from the
Rust backend through its C API. Python/PyTorch would not need to ship in the app.

| Proposed downloadable artifact | Verified size |
| --- | --- |
| `u2netp.onnx` from the rembg model release | 4,574,861 bytes, approximately 4.57 MB |
| Full `onnxruntime-win-x64-1.31.0.zip` CPU release archive | 82,887,349 bytes, approximately 82.89 MB |
| Combined upstream downloads | Approximately 87.46 MB |

These are upstream archive sizes, not a finalized Glint download budget. A later
implementation could package only the required runtime files or use a reduced
operator build; that size must be measured before approval. The model's suitability
for window screenshots, edge quality, notices and redistribution requirements
still need review. No inference-quality claim is made here.

Sizes were checked from publisher release metadata on October 14, 2026:
[rembg model release](https://api.github.com/repos/danielgatis/rembg/releases/tags/v0.0.0),
[ONNX Runtime v1.31.0 release](https://api.github.com/repos/microsoft/onnxruntime/releases/tags/v1.31.0).
Runtime integration reference: [ONNX Runtime C/C++ documentation](https://onnxruntime.ai/docs/get-started/with-cpp).
Model reference: [U²-Net upstream](https://github.com/xuebinqin/U-2-Net).

Phase 4 remains unstarted. The next phase or any background-removal experiment
requires the user's decision.
