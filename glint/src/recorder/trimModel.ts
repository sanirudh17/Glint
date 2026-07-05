/** trimModel.ts — pure timeline model for the trim window. Clips partition the
 *  original [0, duration]; kept clips (in order) form the output. */
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

/** Set a clip's kept flag (delete = false, restore = true). */
export function setKept(clips: Clip[], id: number, kept: boolean): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, kept } : c));
}

/** Ordered kept spans, with adjacent kept clips merged into one range. */
export function keepRanges(clips: Clip[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const c of clips) {
    if (!c.kept) continue;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last[1] - c.start) < EPS) last[1] = c.end;
    else ranges.push([c.start, c.end]);
  }
  return ranges;
}

export function keptCount(clips: Clip[]): number {
  return clips.filter((c) => c.kept).length;
}

/** Set a clip's speed factor (0.5 | 1 | 1.5 | 2). */
export function setSpeed(clips: Clip[], id: number, speed: number): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, speed } : c));
}

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

/** Exported duration: each kept clip contributes (end-start)/speed. */
export function outputDuration(clips: Clip[]): number {
  return clips.filter((c) => c.kept).reduce((a, c) => a + (c.end - c.start) / c.speed, 0);
}
