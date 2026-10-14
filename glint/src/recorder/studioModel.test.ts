import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "../look/model";
import { DEFAULT_CURSOR, hydrateProject, sourceTimeAt, type StudioProject } from "./studioModel";
import { splitClips } from "./trimModel";
const project: StudioProject = { version: 1, look: DEFAULT_LOOK, cursor: DEFAULT_CURSOR, crop: { x: 30, y: 20, w: 600, h: 400 }, clips: [{ id: 1, start: 1, end: 5, speed: 2, order: 1, kept: true }, { id: 2, start: 8, end: 10, speed: .5, order: 0, kept: true }], fadeIn: .5, fadeOut: 1, cam: null, zoomSegments: [], masks: [] };
describe("Studio projects", () => {
  it("round-trips crop, look, effects and reordered timeline", () => {
    expect(hydrateProject(JSON.parse(JSON.stringify(project)), 10)).toEqual(project);
  });
  it("rejects unknown versions and invalid cuts", () => {
    expect(() => hydrateProject({ ...project, version: 2 } as unknown as StudioProject, 10)).toThrow("newer");
    expect(() => hydrateProject(project, 3)).toThrow("invalid");
  });
  it("maps cursor time through speed changes and reordered cuts", () => {
    expect(sourceTimeAt(project.clips, 2)).toBe(9);
    expect(sourceTimeAt(project.clips, 4.5)).toBe(2);
  });
  it("keeps split ids unique after reopening", () => {
    const reopened = hydrateProject({ ...project, clips: project.clips.map((c) => ({ ...c, id: c.id + 500 })) }, 10);
    const split = splitClips(reopened.clips, 3);
    expect(new Set(split.map((c) => c.id)).size).toBe(split.length);
  });
});
