import { describe, it, expect } from "vitest";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  nextStepNumber,
  eraseAt,
  DEFAULT_STYLE,
  snapAngle,
  duplicateAnnotation,
  nudgeAnnotation,
  reorder,
  type Annotation,
  type BoxAnno,
  type TwoPointAnno,
  type FreehandAnno,
  type StepAnno,
} from "./model";

const rect = (id: string): Annotation => ({
  id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, w: 10, h: 10,
});
const step = (id: string, number: number): StepAnno => ({
  id, type: "step", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, number,
});
const pen = (id: string, points: number[]): FreehandAnno => ({
  id, type: "pen", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, points,
});
const redactBox = (id: string): BoxAnno => ({
  id, type: "redact", z: 0,
  style: { color: "#000000", strokeWidth: 3, fontSize: 24, redactStyle: "solid" },
  x: 10, y: 10, w: 40, h: 20,
});
const spotlightBox = (id: string): BoxAnno => ({
  id, type: "spotlight", z: 0,
  style: { color: "#000000", strokeWidth: 3, fontSize: 24, region: "rect", fillOpacity: 0.6 },
  x: 10, y: 10, w: 40, h: 20,
});

describe("annotation model", () => {
  it("adds to the end (z-order)", () => {
    const list = addAnnotation(addAnnotation([], rect("a")), rect("b"));
    expect(list.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("updates by id, leaving others untouched", () => {
    const list = updateAnnotation([rect("a"), rect("b")], "b", { x: 99 } as Partial<Annotation>);
    expect((list[1] as { x: number }).x).toBe(99);
    expect((list[0] as { x: number }).x).toBe(0);
  });

  it("deletes by id", () => {
    const list = deleteAnnotation([rect("a"), rect("b")], "a");
    expect(list.map((a) => a.id)).toEqual(["b"]);
  });

  it("nextStepNumber is 1 when no steps exist", () => {
    expect(nextStepNumber([rect("a")])).toBe(1);
  });

  it("nextStepNumber is max+1 across existing steps", () => {
    expect(nextStepNumber([step("a", 1), step("b", 3), rect("c")])).toBe(4);
  });
});

describe("eraseAt", () => {
  it("returns the same array reference when nothing is under the circle", () => {
    const list = [pen("p", [0, 0, 10, 0, 20, 0])];
    expect(eraseAt(list, 100, 100, 5, null)).toBe(list);
  });

  it("drops a non-freehand shape by dropId, leaving others", () => {
    const list = [rect("a"), rect("b")];
    const next = eraseAt(list, 999, 999, 5, "a");
    expect(next.map((n) => n.id)).toEqual(["b"]);
  });

  it("trims covered vertices off the end of a freehand stroke", () => {
    // circle at (20,0) r=5 covers only the last vertex (20,0).
    const next = eraseAt([pen("p", [0, 0, 10, 0, 20, 0])], 20, 0, 5, null);
    expect(next).toHaveLength(1);
    expect((next[0] as FreehandAnno).points).toEqual([0, 0, 10, 0]);
  });

  it("splits a freehand stroke into two when erased in the middle", () => {
    // circle at (20,0) r=5 covers the middle vertex (20,0) of a 5-point line.
    const next = eraseAt([pen("p", [0, 0, 10, 0, 20, 0, 30, 0, 40, 0])], 20, 0, 5, null);
    expect(next).toHaveLength(2);
    expect((next[0] as FreehandAnno).points).toEqual([0, 0, 10, 0]);
    expect((next[1] as FreehandAnno).points).toEqual([30, 0, 40, 0]);
    // the split segment gets a fresh id; the first keeps the original
    expect(next[0].id).toBe("p");
    expect(next[1].id).not.toBe("p");
  });

  it("removes a freehand stroke entirely when no 2-point run survives", () => {
    // both vertices within the circle → no run of >=2 points remains.
    const next = eraseAt([pen("p", [0, 0, 2, 0])], 1, 0, 5, null);
    expect(next).toHaveLength(0);
  });
});

describe("DEFAULT_STYLE new fields", () => {
  it("has safe defaults for the new style fields", () => {
    expect(DEFAULT_STYLE.fill).toBeNull();
    expect(DEFAULT_STYLE.fillOpacity).toBe(1);
    expect(DEFAULT_STYLE.dashed).toBe(false);
    expect(DEFAULT_STYLE.arrowStart).toBe(false);
  });
});

describe("snapAngle", () => {
  it("snaps a near-horizontal vector to 0°", () => {
    const r = snapAngle(0, 0, 10, 1);
    expect(r.x2).toBeCloseTo(Math.hypot(10, 1), 5);
    expect(r.y2).toBeCloseTo(0, 5);
  });
  it("snaps a near-diagonal vector to 45° preserving length", () => {
    const len = Math.hypot(10, 9);
    const r = snapAngle(0, 0, 10, 9);
    expect(r.x2).toBeCloseTo(len * Math.SQRT1_2, 5);
    expect(r.y2).toBeCloseTo(len * Math.SQRT1_2, 5);
  });
  it("returns the point unchanged for a zero-length vector", () => {
    expect(snapAngle(5, 5, 5, 5)).toEqual({ x2: 5, y2: 5 });
  });
});

const arrowA = (id: string): Annotation =>
  ({ id, type: "arrow", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 }, x1: 0, y1: 0, x2: 5, y2: 5 });

describe("duplicateAnnotation", () => {
  it("gives the clone a new id and offsets a box by +12,+12", () => {
    const d = duplicateAnnotation(rect("a")) as BoxAnno;
    expect(d.id).not.toBe("a");
    expect([d.x, d.y]).toEqual([12, 12]);
    expect([d.w, d.h]).toEqual([10, 10]);
  });
  it("offsets both points of an arrow", () => {
    const d = duplicateAnnotation(arrowA("a")) as TwoPointAnno;
    expect([d.x1, d.y1, d.x2, d.y2]).toEqual([12, 12, 17, 17]);
  });
  it("duplicates a redact box preserving redactStyle", () => {
    const d = duplicateAnnotation(redactBox("a")) as BoxAnno;
    expect(d.type).toBe("redact");
    expect(d.id).not.toBe("a");
    expect([d.x, d.y]).toEqual([22, 22]);
    expect(d.style.redactStyle).toBe("solid");
  });
  it("duplicates a spotlight preserving region + dim", () => {
    const d = duplicateAnnotation(spotlightBox("a")) as BoxAnno;
    expect(d.type).toBe("spotlight");
    expect(d.id).not.toBe("a");
    expect([d.x, d.y]).toEqual([22, 22]);
    expect(d.style.region).toBe("rect");
    expect(d.style.fillOpacity).toBe(0.6);
  });
});

describe("nudgeAnnotation", () => {
  it("shifts a box", () => {
    const n = nudgeAnnotation(rect("a"), -1, 5) as BoxAnno;
    expect([n.x, n.y]).toEqual([-1, 5]);
  });
  it("shifts every freehand vertex", () => {
    const n = nudgeAnnotation(pen("a", [0, 0, 2, 4]), 3, 7) as FreehandAnno;
    expect(n.points).toEqual([3, 7, 5, 11]);
  });
  it("shifts a redact box", () => {
    const n = nudgeAnnotation(redactBox("a"), 5, -3) as BoxAnno;
    expect([n.x, n.y]).toEqual([15, 7]);
  });
  it("shifts a spotlight box", () => {
    const n = nudgeAnnotation(spotlightBox("a"), -4, 6) as BoxAnno;
    expect([n.x, n.y]).toEqual([6, 16]);
  });
});

describe("reorder", () => {
  it("moves an item forward one step", () => {
    const list = [rect("a"), rect("b"), rect("c")];
    expect(reorder(list, "a", "forward").map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("moves an item backward one step", () => {
    const list = [rect("a"), rect("b"), rect("c")];
    expect(reorder(list, "c", "backward").map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
  it("returns the same reference at the edges", () => {
    const list = [rect("a"), rect("b")];
    expect(reorder(list, "a", "backward")).toBe(list);
    expect(reorder(list, "b", "forward")).toBe(list);
  });
});
