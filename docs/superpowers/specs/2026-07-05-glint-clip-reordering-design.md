# Phase 23 — Clip reordering (trim editor)

**Status:** Design approved, ready for implementation plan.
**Scope:** One deferred ROADMAP item — let the user drag kept clips into a new playback
order in the recording trim editor. Entirely inside the isolated recorder path.

## Problem

The trim editor can split, delete, speed-adjust, and fade clips, but kept clips always
export in **source order**. Reordering was parked in Phase 20 because the timeline model
assumes `Clip[]` array order == source-time order: the timeline positions each clip by its
source time (`left = start/duration`), `keepRanges` merges kept spans by time-adjacency, and
export concatenates `keptSegments` in array order. Introducing a play order that differs from
source order must not disturb any of that existing, unit-tested behavior.

## Chosen approach: filmstrip below the timeline

Reordering is **added** as a self-contained strip rather than by rewriting the timeline.

- The existing **source-time timeline** (split / delete / speed / waveform / playhead / zoom)
  is untouched — it remains the "source view."
- A new **filmstrip row** under the timeline shows one tile per kept clip, left-to-right in
  **play order**. Dragging a tile reorders it. The row reads plainly as "this is the order it
  plays in."
- The Rust export already concatenates segments in whatever order it is handed, so the
  backend is unchanged.

Rejected alternatives: dragging clips directly on the timeline (overloads the timeline so it
no longer means source time — confusing, and breaks the waveform/playhead mapping) and making
the timeline itself repack into an output-order strip (largest change — remaps waveform and
playhead). The filmstrip is the most reliable and least complicated option because it does not
touch working, tested code.

## Components

### Model — `src/recorder/trimModel.ts` (pure, unit-tested)

Kept clips gain an explicit **play order** decoupled from source position. The `Clip[]` array
stays in source order (so the timeline and `keepRanges` are unchanged); play order is a
separate concept layered on top.

- **Ordering representation:** add `order: number` to `Clip` (a sort key). `initClips` sets
  `order` = source position so initial play order == source order (today's behavior). Only
  kept clips' `order` values are meaningful for output; deleted clips retain a value so a
  restore returns them to a sensible spot.
- **`keptSegments(clips)`** returns kept clips sorted by `order` (was: array order). This is
  the single behavioral change that carries the new order into export and preview.
- **`outputDuration(clips)`** unchanged — a sum over kept clips, independent of order.
- **`reorderKept(clips, fromIndex, toIndex)`** — new pure function. Takes the play-order
  positions of the kept clips (0-based over the kept subsequence), moves one, and rewrites the
  `order` keys so the kept sequence reflects the new arrangement. Non-kept clips are unaffected.
- **Split** (`splitClips`): the two halves inherit the parent's play-order slot and stay
  adjacent (e.g. parent keeps its `order`, the right half takes a key placed immediately after,
  before the next kept clip — fractional/renumbered keys, decided in the plan).
- **Delete / restore** (`setKept`): unchanged flag toggle; a restored clip re-enters the play
  order at its source-adjacent position (its existing `order` key already encodes that).
- `keepRanges`, `keptCount`, `setSpeed` unchanged.

### UI — `src/recorder/TrimView.tsx` + `trim.css`

- A **filmstrip row** rendered from `keptSegments(clips)` (already in play order). One tile per
  kept clip showing: **index** (1, 2, 3…), **duration** (`(end-start)/speed`), and a **speed
  badge** when ≠ 1×. Numbered tiles, no thumbnails (thumbnails are an easy later add).
- **Drag-to-reorder** via pointer events, matching the editor's existing pointer-drag style
  (not HTML5 DnD). Dragging a tile shows an insertion indicator; drop calls `reorderKept`.
- The row appears only when there are **≥ 2 kept clips** (nothing to reorder otherwise).
- Placed under the timeline, above/among the actions row; visually distinct from the
  source-time timeline so the two views aren't confused.

### Preview — `TrimView.tsx` rAF loop

The existing `requestAnimationFrame` preview loop already plays kept clips with per-clip
`playbackRate` and switches speed at boundaries. It is extended to follow **play order**:

- Build the playback schedule from `keptSegments` (play order) — a list of
  `{ sourceStart, sourceEnd, speed }` with cumulative output offsets.
- Each frame maps output-time → the active segment + source time. When advancing to the next
  segment and it is **not source-contiguous** with the previous (the reorder/delete case),
  seek the `<video>` (`currentTime`) to the next segment's `sourceStart`; otherwise let it play
  through as today.
- This reuses existing machinery (the loop already switches `playbackRate` at boundaries); the
  only addition is the seek-on-discontinuity, which the delete case already implies and reorder
  generalizes.

### Undo / redo — existing `EditState` history

Play order joins the tracked edit state so reorders undo/redo like split/delete/speed/fades.
Since `order` lives on `Clip`, and history already snapshots `clips`, this is largely free;
verify the history captures order changes and that reorder pushes one history entry per drop.

### Export — backend unchanged

`recorder_trim_export` already builds per-segment `trim`/`setpts` filters and concatenates
`keptSegments` in the given order. The frontend simply sends the reordered `keptSegments`.
No Rust change beyond confirming order-agnosticism (it is: concat follows the list order, and
each speed boundary is preserved because segments stay un-merged).

## Data flow

1. User drags a filmstrip tile → `reorderKept(clips, from, to)` → new `clips` with rewritten
   `order` keys → pushed to `EditState` history.
2. `keptSegments(clips)` (sorted by `order`) drives the filmstrip render, the preview schedule,
   the output-duration readout, and the export payload — one source of truth.
3. Export sends the ordered `keptSegments`; Rust concatenates in that order.

## Testing

- **Model (vitest, pure):** `reorderKept` moves the right clip and preserves the others'
  relative order; `keptSegments` reflects play order after reorder; reorder then split keeps
  halves adjacent; delete-then-restore returns a clip to its source-adjacent slot; reorder is a
  no-op with < 2 kept clips; `outputDuration` invariant under reorder.
- **Preview (unit-testable schedule):** the output→(segment, source-time) mapping and the
  discontinuity/seek decision are extracted as pure helpers and tested (contiguous → no seek;
  reordered/deleted boundary → seek to next `sourceStart`).
- **At-screen acceptance:** reorder 3 clips; preview plays in the new order with correct speeds
  and clean cuts; exported file matches the previewed order and duration; undo/redo restores
  order; interaction with an existing webcam overlay export still composites correctly.

## Isolation

All changes live in the recorder path (`recorder/trimModel.ts`, `recorder/TrimView.tsx`,
`recorder/trim.css`, and — only if a confirming touch is needed — `recorder/trim.rs`). Nothing
is imported from capture / editor / overlay / ocr. The model stays pure and unit-tested; the
normalized model ↔ export boundary is unchanged.

## Out of scope

Thumbnails on tiles, transitions between clips, cross-recording clips, and any change to the
source-time timeline's split/delete/speed/waveform behavior.
