# Clip Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag kept clips into a new playback order in the recording trim editor, with correct preview and export.

**Architecture:** Kept clips gain an explicit `order` sort key decoupled from source position; the `Clip[]` array stays source-ordered so the existing source-time timeline, `keepRanges`, and waveform are untouched. A new filmstrip of draggable tiles sets the order; `keptSegments` (sorted by `order`) is the single source of truth for the filmstrip, preview schedule, and export payload. The Rust export is made order-preserving (it currently sorts by start).

**Tech Stack:** React 19 + TypeScript + Vite + Vitest (frontend, `glint/`); Rust + Tauri v2 + cargo test (backend, `glint/src-tauri/`); lucide-react icons; pointer events for drag.

## Global Constraints

- **Recorder isolation (SACRED):** all changes live in the recorder path (`recorder/trimModel.ts`, `recorder/TrimFilmstrip.tsx`, `recorder/TrimView.tsx`, `recorder/trim.css`, `src-tauri/src/recorder/trim.rs`). Import nothing from capture / editor / overlay / ocr.
- **Green gate** (must pass before every commit that touches that side): from `glint/src-tauri`: `cargo clippy --all-targets` (0 warnings) + `cargo test`; from `glint`: `npx tsc --noEmit` + `npx vitest run`.
- **Model stays pure + unit-tested:** `trimModel.ts` imports nothing from React/Tauri; every new function has vitest coverage.
- **Commit trailer (REQUIRED on every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```
- **Base branch:** `master`. Work happens on `phase-23-clip-reordering` (already created).

## File Structure

- `glint/src-tauri/src/recorder/trim.rs` (modify) — `validate_segments` becomes order-preserving.
- `glint/src/recorder/trimModel.ts` (modify) — `Clip.order`; `keptSegments` sorts by order; new `keptClipsInOrder`, `reorderKept`, `segmentIndexAtSource`.
- `glint/src/recorder/trimModel.test.ts` (modify) — new + updated tests.
- `glint/src/recorder/TrimFilmstrip.tsx` (create) — the draggable filmstrip component.
- `glint/src/recorder/TrimView.tsx` (modify) — render the filmstrip; wire reorder through `commit`; rewrite the preview rAF loop to follow play order.
- `glint/src/recorder/trim.css` (modify) — filmstrip styles.

---

### Task 1: Backend — `validate_segments` preserves caller order

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs:166-193` (`validate_segments`)
- Modify (test): `glint/src-tauri/src/recorder/trim.rs:851-863` (`validate_sorts_rejects_overlap_oob_and_bad_speed`)

**Interfaces:**
- Produces: `validate_segments(&[KeepSegment], f64) -> Result<Vec<KeepSegment>, String>` — same signature; now returns segments **in the caller's order** (was: sorted by `start`). Still rejects empty list, empty/inverted/NaN region, out-of-bounds, overlapping source spans, speed outside [0.5, 2].

- [ ] **Step 1: Update the existing test to expect caller order**

Replace the `assert_eq!` block at the top of `validate_sorts_rejects_overlap_oob_and_bad_speed` (keep the rename for clarity) so a reordered, non-overlapping input is returned unchanged:

```rust
    #[test]
    fn validate_preserves_order_rejects_overlap_oob_and_bad_speed() {
        // Play order is preserved (segments are NOT re-sorted by start) so a reordered
        // sequence survives to concat; only overlap/bounds/speed are validated.
        assert_eq!(
            validate_segments(&[seg(3.0, 4.0, 1.0), seg(0.0, 1.0, 2.0)], 10.0).unwrap(),
            vec![seg(3.0, 4.0, 1.0), seg(0.0, 1.0, 2.0)]
        );
        assert!(validate_segments(&[seg(0.0, 2.0, 1.0), seg(1.0, 3.0, 1.0)], 10.0).is_err()); // overlap
        assert!(validate_segments(&[seg(0.0, 11.0, 1.0)], 10.0).is_err());                    // oob
        assert!(validate_segments(&[seg(2.0, 2.0, 1.0)], 10.0).is_err());                     // empty
        assert!(validate_segments(&[], 10.0).is_err());                                       // empty list
        assert!(validate_segments(&[seg(0.0, 5.0, 3.0)], 10.0).is_err());                     // speed too high
        assert!(validate_segments(&[seg(0.0, 5.0, 0.25)], 10.0).is_err());                    // speed too low
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd glint/src-tauri && cargo test validate_preserves_order`
Expected: FAIL — the old function sorts, so it returns `[seg(0,1,2), seg(3,4,1)]`, not the caller order (or the test name doesn't exist yet).

- [ ] **Step 3: Rewrite `validate_segments` to validate on a sorted copy but return caller order**

Replace the body (lines 168-193) with:

```rust
pub fn validate_segments(segments: &[KeepSegment], duration: f64) -> Result<Vec<KeepSegment>, String> {
    use std::cmp::Ordering;
    if segments.is_empty() {
        return Err("nothing to keep".into());
    }
    // Per-segment validity (bounds, non-empty, speed) — order-independent.
    for s in segments {
        // Reject empty/inverted regions AND NaN (partial_cmp is None for NaN → rejected).
        if !matches!(s.end.partial_cmp(&s.start), Some(Ordering::Greater)) {
            return Err("empty keep-region".into());
        }
        if s.start < -1e-6 || s.end > duration + 1e-3 {
            return Err("keep-region out of bounds".into());
        }
        // NaN fails both comparisons → rejected.
        if !(s.speed >= 0.5 - 1e-9 && s.speed <= 2.0 + 1e-9) {
            return Err("speed out of range".into());
        }
    }
    // Non-overlap is checked on a SORTED COPY (each source span may be used at most once), but
    // the segments are RETURNED in the caller's order so a reordered play sequence survives to
    // concat unchanged.
    let mut sorted = segments.to_vec();
    sorted.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(Ordering::Equal));
    let mut prev_end = 0.0;
    for (i, s) in sorted.iter().enumerate() {
        if i > 0 && s.start < prev_end - 1e-6 {
            return Err("overlapping keep-regions".into());
        }
        prev_end = s.end;
    }
    Ok(segments.to_vec())
}
```

Also update the doc comment above the function (line 166-167) to:

```rust
/// Validate kept segments: non-empty list, each region non-empty and within [0, duration],
/// source spans non-overlapping, and speed in [0.5, 2]. Returns them in the CALLER's order
/// (play order) — overlap is checked on a sorted copy but the order is preserved so a
/// reordered sequence concatenates as arranged.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd glint/src-tauri && cargo test validate_preserves_order`
Expected: PASS.

- [ ] **Step 5: Run the full backend gate**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Expected: 0 clippy warnings; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs
git commit -m "$(printf 'feat(p23): trim export preserves segment order for reordering\n\nvalidate_segments checked non-overlap by sorting AND returned the sorted vec,\nso the export always concatenated in source order. It now validates overlap on\na sorted copy but returns segments in the caller order, letting a reordered play\nsequence survive to concat.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 2: Model — `order` field, play-order `keptSegments`, `keptClipsInOrder`

**Files:**
- Modify: `glint/src/recorder/trimModel.ts`
- Modify (test): `glint/src/recorder/trimModel.test.ts`

**Interfaces:**
- Produces:
  - `type Clip = { id: number; start: number; end: number; kept: boolean; speed: number; order: number }`
  - `keptSegments(clips: Clip[]) => { start: number; end: number; speed: number }[]` — now sorted by `order` (was array order); still maps to exactly those three fields.
  - `keptClipsInOrder(clips: Clip[]) => Clip[]` — kept clips sorted by `order` (retains full Clip incl. `id`), for the filmstrip.
  - `initClips`, `splitClips` unchanged signatures; `splitClips` assigns the right half an `order` that slots it immediately after the left in play order.

- [ ] **Step 1: Write the failing tests**

Add to `trimModel.test.ts` (and add `keptClipsInOrder` to the import on line 2):

```ts
  it("keptSegments follows play order (order key), not array order", () => {
    let c = splitClips(initClips(10), 5); // [0-5 order0][5-10 order1]
    // Manually flip the play order: make the second clip sort first.
    c = c.map((x, i) => (i === 1 ? { ...x, order: -1 } : x));
    expect(keptSegments(c)).toEqual([
      { start: 5, end: 10, speed: 1 },
      { start: 0, end: 5, speed: 1 },
    ]);
  });

  it("keptClipsInOrder returns kept clips (with ids) in play order", () => {
    let c = splitClips(initClips(10), 5);
    const ordered = keptClipsInOrder(c);
    expect(ordered.map((x) => [x.start, x.end])).toEqual([[0, 5], [5, 10]]);
    expect(ordered.every((x) => typeof x.id === "number")).toBe(true);
  });

  it("split assigns the right half an order just after the left", () => {
    const c = splitClips(initClips(10), 4);
    const [a, b] = c;
    expect(a.order).toBeLessThan(b.order); // left plays before right by default
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: FAIL — `keptClipsInOrder` is not exported; `order` is undefined.

- [ ] **Step 3: Add the `order` field and the two order-aware functions**

In `trimModel.ts`, update the type, `mk`, `initClips`, `splitClips`, and `keptSegments`, and add `keptClipsInOrder`:

```ts
export type Clip = { id: number; start: number; end: number; kept: boolean; speed: number; order: number };

let nextId = 1;
const mk = (start: number, end: number, kept: boolean, speed: number, order: number): Clip =>
  ({ id: nextId++, start, end, kept, speed, order });

const EPS = 1e-4;

export function initClips(duration: number): Clip[] {
  return [mk(0, Math.max(0, duration), true, 1, 0)];
}

/** Split the clip containing time `t` into two at `t`. No-op on a boundary/outside. The right
 *  half slots immediately AFTER the left in play order (midway to the next-larger order). */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  let didSplit = false;
  for (const c of clips) {
    if (!didSplit && t > c.start + EPS && t < c.end - EPS) {
      const gt = clips.map((x) => x.order).filter((o) => o > c.order).sort((a, b) => a - b)[0];
      const rightOrder = gt !== undefined ? (c.order + gt) / 2 : c.order + 1;
      out.push(mk(c.start, t, c.kept, c.speed, c.order));
      out.push(mk(t, c.end, c.kept, c.speed, rightOrder));
      didSplit = true;
    } else {
      out.push(c);
    }
  }
  return out;
}
```

Replace `keptSegments` and add `keptClipsInOrder`:

```ts
/** Kept clips in PLAY order (by `order`) as export/preview segments — NOT merged (a speed
 *  boundary between adjacent kept clips must stay a boundary). */
export function keptSegments(clips: Clip[]): { start: number; end: number; speed: number }[] {
  return clips
    .filter((c) => c.kept)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ start: c.start, end: c.end, speed: c.speed }));
}

/** Kept clips (full Clip, incl. id) in play order — drives the reorder filmstrip. */
export function keptClipsInOrder(clips: Clip[]): Clip[] {
  return clips.filter((c) => c.kept).sort((a, b) => a.order - b.order);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: PASS — including the pre-existing tests (they use `toMatchObject`/`toEqual` on `{start,end,speed}`, which the new `order` field doesn't disturb).

- [ ] **Step 5: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean (no consumers reference `order` yet; `mk` is internal).

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/trimModel.ts glint/src/recorder/trimModel.test.ts
git commit -m "$(printf 'feat(p23): clip play-order key (keptSegments sorts by it)\n\nClip gains an order sort key decoupled from source position; keptSegments and\nnew keptClipsInOrder return kept clips in play order. Array stays source-ordered\nso the timeline is untouched. Split slots the right half just after the left.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 3: Model — `reorderKept`

**Files:**
- Modify: `glint/src/recorder/trimModel.ts`
- Modify (test): `glint/src/recorder/trimModel.test.ts`

**Interfaces:**
- Consumes: `keptClipsInOrder` (Task 2).
- Produces: `reorderKept(clips: Clip[], from: number, to: number) => Clip[]` — moves the kept clip at play-order index `from` to index `to` (0-based over the kept subsequence, `to` = destination index in the final sequence). Rewrites only the moved clip's `order`; the array (source order) is unchanged. No-op for out-of-range or `from === to`.

- [ ] **Step 1: Write the failing tests**

Add to `trimModel.test.ts` (add `reorderKept` to the import):

```ts
  it("reorderKept moves a kept clip to a new play-order slot", () => {
    let c = splitClips(initClips(30), 10); // [0-10][10-30]
    c = splitClips(c, 20);                 // [0-10][10-20][20-30], play order A,B,C
    // Move C (index 2) to the front (index 0) → play order C,A,B.
    c = reorderKept(c, 2, 0);
    expect(keptSegments(c).map((s) => s.start)).toEqual([20, 0, 10]);
    // The source array order is unchanged.
    expect(c.map((x) => x.start)).toEqual([0, 10, 20]);
  });

  it("reorderKept moving forward lands at the destination index", () => {
    let c = splitClips(initClips(30), 10);
    c = splitClips(c, 20); // A,B,C at 0,10,20
    c = reorderKept(c, 0, 2); // move A to end → B,C,A
    expect(keptSegments(c).map((s) => s.start)).toEqual([10, 20, 0]);
  });

  it("reorderKept is a no-op for out-of-range or same index", () => {
    const c = splitClips(initClips(20), 10);
    expect(reorderKept(c, 0, 0)).toBe(c);
    expect(reorderKept(c, 5, 0)).toBe(c);
    expect(reorderKept(c, 0, 9)).toBe(c);
  });

  it("split after reorder keeps the two halves adjacent in play order", () => {
    let c = splitClips(initClips(30), 10);
    c = splitClips(c, 20);      // A(0-10) B(10-20) C(20-30)
    c = reorderKept(c, 2, 0);   // C,A,B
    // Split A (source 0-10) at 5. Its halves must stay adjacent, right after C.
    c = splitClips(c, 5);
    expect(keptSegments(c).map((s) => [s.start, s.end])).toEqual([
      [20, 30], [0, 5], [5, 10], [10, 20],
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: FAIL — `reorderKept` is not defined.

- [ ] **Step 3: Implement `reorderKept`**

Add to `trimModel.ts`:

```ts
/** Move the kept clip at play-order index `from` to index `to` (0-based over the kept
 *  subsequence; `to` is the destination index in the final sequence). Rewrites only the moved
 *  clip's `order` key — the array (source order) is unchanged. No-op for bad indices. */
export function reorderKept(clips: Clip[], from: number, to: number): Clip[] {
  const kept = keptClipsInOrder(clips);
  if (from < 0 || from >= kept.length || to < 0 || to >= kept.length || from === to) return clips;
  const moved = kept[from];
  const rest = kept.filter((_, i) => i !== from);
  const before = rest[to - 1];
  const after = rest[to];
  let order: number;
  if (!before) order = after.order - 1;        // to front
  else if (!after) order = before.order + 1;    // to end
  else order = (before.order + after.order) / 2; // between neighbors
  return clips.map((c) => (c.id === moved.id ? { ...c, order } : c));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/trimModel.ts glint/src/recorder/trimModel.test.ts
git commit -m "$(printf 'feat(p23): reorderKept moves a kept clip to a new play-order slot\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 4: Model — `segmentIndexAtSource` (preview play-start helper)

**Files:**
- Modify: `glint/src/recorder/trimModel.ts`
- Modify (test): `glint/src/recorder/trimModel.test.ts`

**Interfaces:**
- Produces: `segmentIndexAtSource(segs: { start: number; end: number }[], t: number) => number` — index of the play-order segment whose `[start, end)` contains source time `t`, or `-1` if `t` falls in no kept segment (a gap). Used by the preview loop to decide where to resume when Play is pressed.

- [ ] **Step 1: Write the failing test**

Add to `trimModel.test.ts` (add `segmentIndexAtSource` to the import):

```ts
  it("segmentIndexAtSource finds the play-order segment covering a source time", () => {
    const segs = [ { start: 20, end: 30 }, { start: 0, end: 10 } ]; // reordered play order
    expect(segmentIndexAtSource(segs, 25)).toBe(0); // inside the first play segment (20-30)
    expect(segmentIndexAtSource(segs, 5)).toBe(1);  // inside the second (0-10)
    expect(segmentIndexAtSource(segs, 15)).toBe(-1); // in a gap → none
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: FAIL — `segmentIndexAtSource` is not defined.

- [ ] **Step 3: Implement `segmentIndexAtSource`**

Add to `trimModel.ts`:

```ts
/** Index of the play-order segment whose [start, end) contains source time `t`, or -1 if `t`
 *  lies in no kept segment. The preview loop uses it to resume from the clicked position. */
export function segmentIndexAtSource(segs: { start: number; end: number }[], t: number): number {
  return segs.findIndex((s) => t >= s.start - EPS && t < s.end - EPS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/trimModel.ts glint/src/recorder/trimModel.test.ts
git commit -m "$(printf 'feat(p23): segmentIndexAtSource — resume preview from a clicked position\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 5: Filmstrip component + wire reorder into TrimView

**Files:**
- Create: `glint/src/recorder/TrimFilmstrip.tsx`
- Modify: `glint/src/recorder/TrimView.tsx` (import + render the filmstrip; add `doReorder`)

**Interfaces:**
- Consumes: `keptClipsInOrder`, `reorderKept` (Tasks 2–3); `Clip` type; `commit(next: EditState)` in TrimView.
- Produces (component): `TrimFilmstrip({ clips, disabled, onReorder })` where `clips: Clip[]`, `disabled: boolean`, `onReorder: (from: number, to: number) => void`. Renders one tile per `keptClipsInOrder(clips)` entry (index badge, duration, speed badge), pointer-drag to reorder. Renders `null` when fewer than 2 kept clips.

- [ ] **Step 1: Create the filmstrip component**

Create `glint/src/recorder/TrimFilmstrip.tsx`:

```tsx
/** TrimFilmstrip.tsx — reorderable strip of kept clips (playback order) for the trim editor.
 *  Recorder-owned; drags with pointer events (WebView2-safe) + elementFromPoint hit-testing. */
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { keptClipsInOrder, type Clip } from "./trimModel";

const secs = (start: number, end: number, speed: number) => `${((end - start) / speed).toFixed(1)}s`;

export function TrimFilmstrip({
  clips,
  disabled,
  onReorder,
}: {
  clips: Clip[];
  disabled: boolean;
  onReorder: (from: number, to: number) => void;
}) {
  const ordered = keptClipsInOrder(clips);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Fewer than 2 kept clips → nothing to reorder.
  if (ordered.length < 2) return null;

  // Map a client-x to the tile index under it (via the tile's data-strip-index attribute).
  const indexAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const tile = el?.closest<HTMLElement>("[data-strip-index]");
    if (!tile) return null;
    const n = Number(tile.dataset.stripIndex);
    return Number.isFinite(n) ? n : null;
  };

  const onPointerDown = (e: React.PointerEvent, i: number) => {
    if (disabled) return;
    e.preventDefault();
    setDragFrom(i);
    setOverIndex(i);
    const move = (ev: PointerEvent) => {
      const idx = indexAt(ev.clientX, ev.clientY);
      if (idx != null) setOverIndex(idx);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const to = indexAt(ev.clientX, ev.clientY);
      setDragFrom(null);
      setOverIndex(null);
      if (to != null && to !== i) onReorder(i, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="trim-filmstrip" ref={rowRef} role="listbox" aria-label="Clip order">
      {ordered.map((c, i) => (
        <div
          key={c.id}
          data-strip-index={i}
          className={
            "trim-strip-tile" +
            (dragFrom === i ? " trim-strip-tile--dragging" : "") +
            (overIndex === i && dragFrom !== null && dragFrom !== i ? " trim-strip-tile--over" : "")
          }
          onPointerDown={(e) => onPointerDown(e, i)}
          title="Drag to reorder"
        >
          <GripVertical size={13} className="trim-strip-grip" />
          <span className="trim-strip-index">{i + 1}</span>
          <span className="trim-strip-dur">{secs(c.start, c.end, c.speed)}</span>
          {c.speed !== 1 && <span className="trim-strip-speed">{c.speed}×</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire the filmstrip into TrimView**

In `glint/src/recorder/TrimView.tsx`:

Add to the model import on line 8 (`keptClipsInOrder`, `reorderKept`, `segmentIndexAtSource` — the last is used in Task 7, add all three now):

```ts
import { initClips, splitClips, setKept, setSpeed, keepRanges, keptCount, keptSegments, keptClipsInOrder, reorderKept, segmentIndexAtSource, outputDuration, type Clip } from "./trimModel";
```

Add the component import near the other component imports (after line 10):

```ts
import { TrimFilmstrip } from "./TrimFilmstrip";
```

Add a `doReorder` callback next to `doDelete`/`doSplit` (after `doDelete`, around line 200):

```ts
  const doReorder = useCallback((from: number, to: number) => {
    const next = reorderKept(clips, from, to);
    if (next !== clips) commit({ ...edit, clips: next });
  }, [commit, edit, clips]);
```

Render the filmstrip. Place it between the timeline block and the actions row. Find the `<div className="trim-actions">` (line 375) and insert immediately before it:

```tsx
      <TrimFilmstrip clips={clips} disabled={exporting !== null} onReorder={doReorder} />

```

- [ ] **Step 3: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run the frontend test + build gate**

Run: `cd glint && npx vitest run && npx tsc --noEmit`
Expected: all pass (no test asserts filmstrip markup; logic lives in the tested model).

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/TrimFilmstrip.tsx glint/src/recorder/TrimView.tsx
git commit -m "$(printf 'feat(p23): reorderable clip filmstrip in the trim editor\n\nA strip of kept-clip tiles in play order; pointer-drag to reorder, committed to\nthe edit history (undo/redo free). Reorder flows to export via keptSegments.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 6: Filmstrip styles

**Files:**
- Modify: `glint/src/recorder/trim.css`

**Interfaces:**
- Consumes: the class names emitted by `TrimFilmstrip` (`trim-filmstrip`, `trim-strip-tile`, `trim-strip-tile--dragging`, `trim-strip-tile--over`, `trim-strip-grip`, `trim-strip-index`, `trim-strip-dur`, `trim-strip-speed`).

- [ ] **Step 1: Add the filmstrip CSS**

Append to `glint/src/recorder/trim.css`:

```css
/* Reorderable clip filmstrip (playback order) — sits between the timeline and the actions. */
.trim-filmstrip {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; overflow-x: auto; scrollbar-width: thin;
}
.trim-strip-tile {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  height: 30px; padding: 0 10px; box-sizing: border-box;
  background: #1b1d27; color: #e8e8ee;
  border: 1px solid rgba(255,255,255,0.12); border-radius: 7px;
  cursor: grab; user-select: none; -webkit-user-select: none;
  transition: border-color 120ms var(--ease, ease), background 120ms var(--ease, ease);
}
.trim-strip-tile:active { cursor: grabbing; }
.trim-strip-tile--dragging { opacity: 0.5; }
/* Insertion target: a bright accent edge marks where the dragged tile will land. */
.trim-strip-tile--over { border-color: var(--accent); box-shadow: -2px 0 0 0 var(--accent); }
.trim-strip-grip { opacity: 0.5; }
.trim-strip-index {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px;
  font-size: 11px; font-weight: 600; background: var(--accent-subtle); color: var(--text, #e8e8ee);
}
.trim-strip-dur { font-size: 12px; font-variant-numeric: tabular-nums; opacity: 0.85; }
.trim-strip-speed {
  font-size: 10px; font-variant-numeric: tabular-nums;
  padding: 1px 4px; border-radius: 3px; background: rgba(255,255,255,0.1);
}
```

- [ ] **Step 2: Typecheck (CSS is import-only; confirm nothing broke)**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add glint/src/recorder/trim.css
git commit -m "$(printf 'style(p23): clip filmstrip tiles + drag/insertion states (accent-aware)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 7: Preview loop follows play order

**Files:**
- Modify: `glint/src/recorder/TrimView.tsx` (the playback rAF loop ~line 236-265, and `togglePlay` ~line 267)

**Interfaces:**
- Consumes: `keptSegments` (play order), `segmentIndexAtSource` (Task 4), existing refs `videoRef`, `camVideoRef`, `clipsRef`, `draggingRef`, `setPlayhead`, `setPlaying`.
- Produces: playback that plays kept clips in play order — seeking across source on a reordered/gap boundary, switching `playbackRate` per clip.

- [ ] **Step 1: Add a play-order cursor ref**

In `TrimView.tsx`, near the other refs (after `viewStartRef`, around line 77), add:

```ts
  // Which play-order segment the preview is currently in (index into keptSegments).
  const segCursorRef = useRef(0);
```

- [ ] **Step 2: Set the cursor when playback starts**

Replace `togglePlay` (line 267) with a version that seats the cursor from the current source time:

```ts
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      const segs = keptSegments(clipsRef.current);
      if (segs.length === 0) return;
      let idx = segmentIndexAtSource(segs, v.currentTime);
      if (idx < 0) { idx = 0; try { v.currentTime = segs[0].start; } catch { /* ignore */ } }
      segCursorRef.current = idx;
      v.play(); setPlaying(true);
    } else { v.pause(); setPlaying(false); }
  };
```

- [ ] **Step 3: Rewrite the rAF loop to walk segments in play order**

Replace the playback `useEffect` (lines 236-265) with:

```ts
  // Playback engine: a rAF loop (~60 Hz) walks the KEPT segments in PLAY order. Within a
  // segment the <video> plays naturally; at a segment boundary it seeks to the next segment's
  // source start (covers reordered jumps and deleted gaps uniformly) and switches playbackRate.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !draggingRef.current) {
        const segs = keptSegments(clipsRef.current); // play order
        if (segs.length === 0) { v.pause(); setPlaying(false); return; }
        let idx = segCursorRef.current;
        if (idx < 0 || idx >= segs.length) idx = 0;
        let seg = segs[idx];
        let t = v.currentTime;
        // Reached the end of this segment's SOURCE span → advance to the next play-order segment.
        if (t >= seg.end - 0.02) {
          if (idx + 1 >= segs.length) { v.pause(); setPlaying(false); raf = requestAnimationFrame(tick); return; }
          idx += 1;
          segCursorRef.current = idx;
          seg = segs[idx];
          try { v.currentTime = seg.start; } catch { /* ignore */ }
          t = seg.start;
        }
        const rate = seg.speed;
        if (v.playbackRate !== rate) v.playbackRate = rate;
        // Slave the webcam overlay to the same time base (correct drift; match speed).
        const cv = camVideoRef.current;
        if (cv) {
          if (Math.abs(cv.currentTime - t) > 0.15) { try { cv.currentTime = t; } catch { /* ignore */ } }
          if (cv.playbackRate !== rate) cv.playbackRate = rate;
        }
        setPlayhead(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
```

Note: `rangesRef` is no longer read by the loop (the ordered cursor replaces the gap-scan). Leave the `rangesRef` declaration in place — the timeline rendering still uses `ranges`.

- [ ] **Step 4: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean. If `rangesRef` becomes unused and eslint/tsc flags it, keep the `ranges` variable (used by the timeline) and remove only the now-dead `rangesRef` line if nothing else reads it; otherwise leave as-is.

- [ ] **Step 5: Run the frontend gate**

Run: `cd glint && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/TrimView.tsx
git commit -m "$(printf 'feat(p23): preview plays clips in filmstrip order (seek on boundary)\n\nThe rAF loop now walks keptSegments in play order, seeking to the next segment\nsource start at each boundary and switching playbackRate per clip. Play resumes\nfrom the segment under the current playhead.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH')"
```

---

### Task 8: Full green gate + at-screen acceptance

**Files:** none (verification only).

- [ ] **Step 1: Run the complete gate**

Run:
```bash
cd glint/src-tauri && cargo clippy --all-targets && cargo test
cd ../ && npx tsc --noEmit && npx vitest run
```
Expected: 0 clippy warnings; all Rust tests pass; tsc clean; all vitest pass.

- [ ] **Step 2: At-screen acceptance (user-driven)**

Launch the app (`npm run tauri dev`), record a short clip, open the trim editor, and verify:
- Split the recording into ≥ 3 clips (S at the playhead). The filmstrip shows numbered tiles.
- Drag a tile to a new position; the tile order updates and the insertion edge highlights while dragging.
- Press Play: the preview plays the clips in the new order, with clean cuts at reordered boundaries and correct per-clip speed; a webcam overlay (if present) stays in sync.
- Undo (Ctrl+Z) restores the previous order; Redo (Ctrl+Shift+Z) re-applies it.
- Save copy: the exported file plays back in the reordered sequence with the expected duration.
- Reorder + a webcam recording still composites the webcam correctly in the export.

- [ ] **Step 3: Report results to the user** and, once accepted, proceed to the ROADMAP entry + `--no-ff` merge to master (handled outside this plan).

---

## Self-Review

**Spec coverage:**
- Play-order key on kept clips → Task 2 (`order`, `keptSegments` sort).
- `reorderKept` pure function → Task 3.
- Filmstrip UI (numbered tiles, ≥2 kept, pointer-drag) → Tasks 5–6.
- Preview follows play order, seek on discontinuity → Task 7 (+ `segmentIndexAtSource` Task 4).
- Undo/redo covers reorder → Task 5 (`doReorder` routes through `commit`, which snapshots `clips` incl. `order`).
- Export in play order → Task 1 (backend order-preserving) + Task 5 (frontend already sends `keptSegments(clips)`).
- Isolation, purity, unit tests → every task; model funcs tested in `trimModel.test.ts`.
- Spec's "backend unchanged" claim was **corrected**: Task 1 handles the required `validate_segments` change (it sorted by start). This is a spec inaccuracy resolved in the plan; no functional gap.

**Placeholder scan:** none — every code step shows complete code and exact commands.

**Type consistency:** `Clip` includes `order` (Task 2) and every `mk` call passes it; `keptSegments` → `{start,end,speed}` (unchanged shape for export/`KeepSegment`); `keptClipsInOrder`/`reorderKept`/`segmentIndexAtSource` names are used identically in Tasks 3–7 and the TrimView import; `TrimFilmstrip` props (`clips`, `disabled`, `onReorder`) match the render site in Task 5.
