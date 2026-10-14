# Phase 3 — Screenshot looks bundle

Status: repository audit and task plan prepared. Implementation has not started.
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

1. Expand procedural gradients to 40–60 categorized presets, keeping old IDs and
   appearance. Add angle, three-stop/radial/conic/mesh choices, optional grain,
   screenshot color sampling and a blurred-screenshot background. Verify shared
   preset roundtrips and preview/export agreement.
2. Extend the existing look controls with Auto Balance, remaining aspect ratios,
   named output sizes and watermarks. Preserve legacy layout defaults and existing
   chrome/border behavior.
3. Add movable image layers, side-by-side arrangement, canvas expansion and resize
   controls. Include layer content in saved projects and ensure privacy effects
   operate on the combined source pixels.
4. Add curved arrow and text style controls and expose existing layer ordering.
   Keep pen/arrow behavior and document undo/reopen compatibility.
5. Run focused pure-logic tests, real editor preview/export checks, old-document
   reopening and a full build. Record evidence and complete the acceptance checklist.
6. Optional model-based background removal is awaiting a scope decision. The
   build plan labels it low priority and opt-in, and instructs the agent to ask
   when a task exceeds its size estimate. It needs a model download, inference
   runtime, licensing/size verification and local inference validation; it is
   substantially larger than another screenshot control.

## Acceptance checklist

- [ ] Each new option appears correctly in preview and the exported PNG.
- [ ] Shared looks continue working in Studio preview and native export.
- [ ] Default choices produce a useful result with one action.
- [ ] Existing `.glint` documents retain their appearance and editable annotations.
- [ ] Added image layers and new annotation fields survive save/reopen and undo.
- [ ] No cloud service, accounts, analytics or bundled wallpaper assets are added.
- [ ] Optional background-removal scope is explicitly recorded before Phase 3 closes.

No Phase 3 feature is marked shipped or cut at this planning checkpoint.
