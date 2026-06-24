import { describe, it, expect } from "vitest";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  nextStepNumber,
  eraseAt,
  type Annotation,
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
