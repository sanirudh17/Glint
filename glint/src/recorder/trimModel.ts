/** trimModel.ts — pure timeline model for the trim window. Clips partition the
 *  original [0, duration]; kept clips (in order) form the output. */
export type Clip = { id: number; start: number; end: number; kept: boolean; speed: number };

let nextId = 1;
const mk = (start: number, end: number, kept: boolean, speed: number): Clip => ({ id: nextId++, start, end, kept, speed });

const EPS = 1e-4;

export function initClips(duration: number): Clip[] {
  return [mk(0, Math.max(0, duration), true, 1)];
}

/** Split the clip containing time `t` into two at `t`. No-op on a boundary/outside. */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  let didSplit = false;
  for (const c of clips) {
    if (!didSplit && t > c.start + EPS && t < c.end - EPS) {
      out.push(mk(c.start, t, c.kept, c.speed));
      out.push(mk(t, c.end, c.kept, c.speed));
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

/** Kept clips in source order as export segments — NOT merged (a speed boundary between
 *  adjacent kept clips must stay a boundary). */
export function keptSegments(clips: Clip[]): { start: number; end: number; speed: number }[] {
  return clips.filter((c) => c.kept).map((c) => ({ start: c.start, end: c.end, speed: c.speed }));
}

/** Exported duration: each kept clip contributes (end-start)/speed. */
export function outputDuration(clips: Clip[]): number {
  return clips.filter((c) => c.kept).reduce((a, c) => a + (c.end - c.start) / c.speed, 0);
}
