import { describe, it, expect } from "vitest";
import { initClips, splitClips, setKept, keepRanges, keptCount, keptSegments, keptClipsInOrder, outputDuration, setSpeed } from "./trimModel";

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

  it("outputDuration is speed-weighted over kept clips", () => {
    let c = splitClips(initClips(12), 4); // [0-4][4-12]
    c = setSpeed(c, c[0].id, 2);          // 4/2 = 2  + 8/1 = 8 → 10
    expect(outputDuration(c)).toBeCloseTo(10, 6);
  });
});
