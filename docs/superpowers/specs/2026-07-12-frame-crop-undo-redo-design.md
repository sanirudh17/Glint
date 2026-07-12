# Frame & Crop join undo/redo — design

**Date:** 2026-07-12
**Status:** Design — approved, pending spec review
**Base branch:** `master` (per project convention; work on a `phase-29-*`-style branch → `--no-ff` merge after at-screen acceptance)

## Problem

In the annotation editor, applying a **Frame** ("filter"-style) change is irreversible.
Every Frame control — background (Solid / Gradient / Transparent), Window / Browser
chrome, **Padding / Radius / Shadow**, Aspect — plus the **"Reset frame"** button is
explicitly *"live tweak state, never in history"* (`useEditorStore.ts:304`). So once the
user applies a frame they cannot undo it, view the result, and continue editing or back
it out. The user wants to apply, view, and revert Frame edits the same way annotations
already work.

Crop is mostly fine: the crop tool commits with **Enter** (`pushHistory()` → `setCrop()`),
so Ctrl+Z restores the previous crop and Esc cancels before applying. The one gap is the
**"Reset crop"** button, which bypasses history and cannot be undone.

## Decision

Bring **Frame** into the same undo/redo history as annotations and crop (chosen model:
*undo/redo covers them* — reuse the existing Undo/Redo buttons + Ctrl+Z / Ctrl+Shift+Z, no
new reversibility system). Make **Reset frame**, **Reset crop**, and the **Frame on/off
toggle** undoable too. Coalesce continuous gestures (slider drags, text entry) so one
gesture is one undo step.

## Design

### 1. History snapshot gains `frame`

Today one history step is:

```ts
interface DocSnapshot { annotations: Annotation[]; crop: Crop | null }
```

Extend it to include the frame:

```ts
interface DocSnapshot { annotations: Annotation[]; crop: Crop | null; frame: FrameConfig }
```

Add a single helper so no push site can forget `frame`:

```ts
const snapshot = (s: EditorState): DocSnapshot => ({
  annotations: s.annotations, crop: s.crop, frame: s.frame,
});
```

Route every existing push/restore site through it: `pushHistory`, `duplicate`,
`bringForward`, `sendBackward`, `nudge`, `clearAll`, `undo`, `redo`. `undo`/`redo` restore
`frame` alongside `annotations` + `crop` (they already spread the snapshot, so once the
snapshot carries `frame` the restore is automatic).

`FrameConfig` is a plain nested object; snapshots hold a reference to the frame object at
push time. Because `setFrame`/`setChrome`/`toggleFrame` always create a **new** frame object
(`{ ...s.frame, ...patch }`), the referenced snapshot is never mutated in place — the same
immutability the annotation history already relies on. No deep clone needed.

Serialization is unaffected: `SerializedDoc` already carries `frame`, so `.glint` save/load
does not change. `loadDoc` still clears history.

### 2. Coalescing — one gesture = one undo step

Approach: **UI-side gesture checkpoints**, mirroring the existing `StyleBar` slider pattern
(`onPointerDown` → `pushHistory()`), rather than a store-side gesture timer. The store cannot
see gesture boundaries; the UI can.

- **Padding / Radius / Shadow sliders:** checkpoint on `pointerdown` (before the drag
  mutates), then the continuous `onChange` just calls `setFrame`. One undo step per drag.
  The `Slider` component is local to `FramePanel.tsx`, so this is a small, contained change
  there (add an `onPointerDown` on the range input that calls `pushHistory()`).
- **Discrete controls** (background type Solid/Gradient/Transparent, solid-color swatches,
  custom color, gradient swatches, Aspect Auto/1:1/16:9/4:3, Window None/Window/Browser,
  chrome theme/buttons): checkpoint once *before* a value-changing click. Skip the checkpoint
  when the click is a no-op (e.g. re-selecting the already-active aspect, or picking the
  color that is already set) so no dead undo steps accumulate.
- **Title / URL text fields:** checkpoint on `focus` (one undo step per editing session,
  not per keystroke).

Net: dragging Radius from 12→60 is a single Ctrl+Z; typing a browser URL is a single Ctrl+Z.

### 3. Resets & toggle become undoable (guarded)

Make these checkpoint before mutating, guarded so they never create a redundant step when
there is nothing to change:

- `resetFrame`: checkpoint then reset, **only if** the current frame differs from a fresh
  default frame.
- `resetCrop`: checkpoint then clear, **only if** `crop !== null`.
- `toggleFrame`: checkpoint then flip `enabled`.

Placing the guard + checkpoint inside the store methods (rather than at the call site) keeps
the reset buttons in `FramePanel.tsx` as simple `onClick={() => resetFrame()}` calls and
guarantees the no-op guard is consistent.

### 4. Crop

No change beyond the Reset-crop fix above. The crop tool's Enter-confirm already pushes
history; Esc still cancels without applying.

## Components / boundaries

- **`useEditorStore.ts`** — owns the history model. Changes: `DocSnapshot` type, `snapshot`
  helper, all push/restore sites, guarded `resetFrame`/`resetCrop`/`toggleFrame`.
- **`FramePanel.tsx`** — owns the Frame controls. Changes: gesture checkpoints on sliders
  (pointerdown), discrete controls (guarded pre-click), and text fields (focus). Reset
  buttons unchanged (checkpointing moved into the store).
- Everything else (EditorStage, CropOverlay, EditorView keybindings, ExportBar, `.glint`
  serialization) is untouched. **Recorder isolation honored** — this is editor-only, zero
  `src-tauri` / `src/recorder` diff.

## Testing

Unit tests in `useEditorStore.test.ts` (pure store logic, node/vitest):

1. **Undo restores frame:** enable frame + set padding, `pushHistory()`, change padding,
   `undo()` → padding (and `enabled`) restored to the pre-change value; `redo()` re-applies.
2. **Frame + annotations + crop restore together** in one undo step (snapshot integrity).
3. **Reset frame is undoable:** mutate frame, `resetFrame()`, `undo()` → the mutated frame
   returns.
4. **Reset frame is a no-op when already default:** `resetFrame()` on a default frame pushes
   **no** history entry (`past` unchanged).
5. **Reset crop is undoable**, and a no-op (no history entry) when `crop` is already null.
6. **`toggleFrame` is undoable** (undo restores the prior `enabled`).

Slider-drag coalescing is a DOM/pointer interaction (not unit-testable in node) — verified
at-screen. Existing store/composition tests must stay green (the added `frame` field rides
along in snapshots without changing annotation/crop behavior).

## Green gate

- From `glint/`: `npx tsc --noEmit` and `npx vitest run`.
- No Rust change, so `cargo` gates are not required for this work.
- At-screen acceptance by the user before the `--no-ff` merge into `master`.

## Risks

- **A forgotten push site** leaves frame out of one history step. Mitigation: the single
  `snapshot()` helper is the only constructor of a `DocSnapshot`; every site uses it.
- **Redundant undo steps** from pointerdown-without-change on sliders (matches an existing
  minor `StyleBar` wart). Accepted for sliders; discrete controls and resets are guarded
  against no-ops.
- **Coalescing granularity** feels wrong at-screen (too coarse/fine). Mitigation: the
  checkpoint boundary is per-gesture (pointerdown / focus / discrete click), which matches
  user intuition and the existing nudge/StyleBar behavior; tunable if needed.
