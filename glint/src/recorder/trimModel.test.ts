import { describe, it, expect } from "vitest";
import { initClips, splitClips, setKept, keepRanges, keptCount, keptSegments, keptClipsInOrder, reorderKept, segmentIndexAtSource, outputDuration, setSpeed } from "./trimModel";

describe("trimModel", () => {
  it("starts as one kept clip spanning the whole duration", () => {
    const c = initClips(10);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: 0, end: 10, kept: true });
    expect(keepRanges(c)).toEqual([[0, 10]]);
  });

  it("splits the clip under the playhead in two", () => {
    const c = splitClips(initClips(10), 4);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ start: 0, end: 4 });
    expect(c[1]).toMatchObject({ start: 4, end: 10 });
    expect(c.every((x) => x.kept)).toBe(true);
  });

  it("ignores a split exactly on a boundary (no zero-width clips)", () => {
    const once = splitClips(initClips(10), 4);
    expect(splitClips(once, 4)).toHaveLength(2);
    expect(splitClips(once, 0)).toHaveLength(2);
    expect(splitClips(once, 10)).toHaveLength(2);
  });

  it("delete (setKept false) drops a clip from the keep-ranges, merging neighbours", () => {
    let c = splitClips(initClips(10), 3); // [0-3][3-10]
    c = splitClips(c, 6);                 // [0-3][3-6][6-10]
    const mid = c[1].id;
    c = setKept(c, mid, false);
    expect(keepRanges(c)).toEqual([[0, 3], [6, 10]]);
    expect(keptCount(c)).toBe(2);
  });

  it("merges adjacent kept clips into one range", () => {
    let c = splitClips(initClips(10), 5); // [0-5][5-10], both kept
    expect(keepRanges(c)).toEqual([[0, 10]]);
  });

  it("seeds speed 1 and preserves it across split", () => {
    const c = splitClips(initClips(10), 4);
    expect(c.every((x) => x.speed === 1)).toBe(true);
  });

  it("keptSegments returns kept clips in order without merging (speed boundaries kept)", () => {
    let c = splitClips(initClips(10), 5); // [0-5][5-10] both kept
    c = setSpeed(c, c[1].id, 2);          // second segment at 2x
    expect(keptSegments(c)).toEqual([
      { start: 0, end: 5, speed: 1 },
      { start: 5, end: 10, speed: 2 },
    ]);
  });

  it("keptSegments drops deleted clips", () => {
    let c = splitClips(initClips(10), 3);
    c = splitClips(c, 6); // [0-3][3-6][6-10]
    c = setKept(c, c[1].id, false);
    expect(keptSegments(c)).toEqual([
      { start: 0, end: 3, speed: 1 },
      { start: 6, end: 10, speed: 1 },
    ]);
  });

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
    const c = splitClips(initClips(10), 5);
    const ordered = keptClipsInOrder(c);
    expect(ordered.map((x) => [x.start, x.end])).toEqual([[0, 5], [5, 10]]);
    expect(ordered.every((x) => typeof x.id === "number")).toBe(true);
  });

  it("split assigns the right half an order just after the left", () => {
    const c = splitClips(initClips(10), 4);
    const [a, b] = c;
    expect(a.order).toBeLessThan(b.order); // left plays before right by default
  });

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

  it("segmentIndexAtSource finds the play-order segment covering a source time", () => {
    const segs = [ { start: 20, end: 30 }, { start: 0, end: 10 } ]; // reordered play order
    expect(segmentIndexAtSource(segs, 25)).toBe(0); // inside the first play segment (20-30)
    expect(segmentIndexAtSource(segs, 5)).toBe(1);  // inside the second (0-10)
    expect(segmentIndexAtSource(segs, 15)).toBe(-1); // in a gap → none
  });

  it("outputDuration is speed-weighted over kept clips", () => {
    let c = splitClips(initClips(12), 4); // [0-4][4-12]
    c = setSpeed(c, c[0].id, 2);          // 4/2 = 2  + 8/1 = 8 → 10
    expect(outputDuration(c)).toBeCloseTo(10, 6);
  });
});
