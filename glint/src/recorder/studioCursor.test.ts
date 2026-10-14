import { expect, it } from "vitest";
import { cursorAt, smoothPath, sourcePoint } from "./studioCursor";
import type { StudioEvents } from "./studioModel";
it("smooths rate-independently and tracks actual movement for idle hiding", () => {
  const path = smoothPath([{ t: 0, kind: "cursor", x: 0, y: 0 }, { t: .1, kind: "cursor", x: 100, y: 100 }, { t: 2, kind: "cursor", x: 100, y: 100 }], .5);
  expect(path[1].x).toBeGreaterThan(0); expect(path[1].x).toBeLessThan(100);
  expect(cursorAt(path, 2)?.movedAt).toBe(.1);
  expect(smoothPath([{ t: 0, kind: "cursor", x: 0, y: 0 }, { t: .1, kind: "cursor", x: 100, y: 100 }], 0)[1].x).toBe(100);
});
it("maps global physical coordinates on a scaled, negative-origin monitor", () => {
  const events = { geometry: { x: -1500, y: 200, width: 1200, height: 800 } } as StudioEvents;
  expect(sourcePoint(-900, 600, events, 600, 400)).toEqual({ x: 300, y: 200 });
});
it("strong smoothing suppresses rapid cursor jitter while zero preserves every sample", () => {
  const events = Array.from({ length: 241 }, (_, i) => ({ t: i / 120, kind: "cursor" as const, x: 500 + (i % 2 ? 30 : -30), y: 300 }));
  const raw = smoothPath(events, 0), filtered = smoothPath(events, 1);
  const travel = (points: typeof raw) => points.slice(121).reduce((sum, p, i) => sum + Math.abs(p.x - points[i + 120].x), 0);
  expect(raw[1].x).toBe(530);
  expect(travel(filtered)).toBeLessThan(travel(raw) * .05);
});
