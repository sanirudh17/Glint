import { describe, it, expect } from "vitest";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  nextStepNumber,
  type Annotation,
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
