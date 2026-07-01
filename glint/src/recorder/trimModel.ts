/** trimModel.ts — pure timeline model for the trim window. Clips partition the
 *  original [0, duration]; kept clips (in order) form the output. */
export type Clip = { id: number; start: number; end: number; kept: boolean };

let nextId = 1;
const mk = (start: number, end: number, kept: boolean): Clip => ({ id: nextId++, start, end, kept });

const EPS = 1e-4;

export function initClips(duration: number): Clip[] {
  return [mk(0, Math.max(0, duration), true)];
}

/** Split the clip containing time `t` into two at `t`. No-op on a boundary/outside. */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  let didSplit = false;
  for (const c of clips) {
    if (!didSplit && t > c.start + EPS && t < c.end - EPS) {
      out.push(mk(c.start, t, c.kept));
      out.push(mk(t, c.end, c.kept));
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
