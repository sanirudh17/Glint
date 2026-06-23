import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./useEditorStore";
import type { Annotation } from "./model";
import type { Crop } from "./composition";

const rect = (id: string): Annotation => ({
  id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, w: 10, h: 10,
});

beforeEach(() => useEditorStore.getState().reset());

describe("useEditorStore", () => {
  it("adds annotations and tracks selection", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["a"]);
    expect(useEditorStore.getState().selectedId).toBe("a");
  });

  it("undo restores the prior snapshot; redo re-applies it", () => {
    const s = useEditorStore.getState();
    s.pushHistory();
    s.add(rect("a"));
    s.undo();
    expect(useEditorStore.getState().annotations).toEqual([]);
    s.redo();
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["a"]);
  });

  it("a new gesture after undo clears the redo future", () => {
    const s = useEditorStore.getState();
    s.pushHistory(); s.add(rect("a"));
    s.undo();
    s.pushHistory(); s.add(rect("b"));
    s.redo(); // nothing to redo — future was cleared
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["b"]);
  });

  it("remove clears selection when the removed item was selected", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.remove("a");
    expect(useEditorStore.getState().selectedId).toBeNull();
  });

  it("setStyle merges into the current style", () => {
    useEditorStore.getState().setStyle({ color: "#00f" });
    expect(useEditorStore.getState().style.color).toBe("#00f");
    expect(useEditorStore.getState().style.strokeWidth).toBe(3);
  });

  it("undo with empty history is a no-op", () => {
    const s = useEditorStore.getState();
    s.undo();
    expect(useEditorStore.getState().annotations).toEqual([]);
  });

  it("clearAll wipes annotations in one undoable step", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.add(rect("b"));
    s.clearAll();
    expect(useEditorStore.getState().annotations).toEqual([]);
    expect(useEditorStore.getState().selectedId).toBeNull();
    // One undo brings every annotation back.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("clearAll on an empty canvas does not push a history entry", () => {
    const s = useEditorStore.getState();
    s.clearAll();
    expect(useEditorStore.getState().past).toEqual([]);
  });

  it("update changes an annotation and does not push history", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.update("a", { x: 42 } as Partial<Annotation>);
    expect((useEditorStore.getState().annotations[0] as { x: number }).x).toBe(42);
    expect(useEditorStore.getState().past).toEqual([]);
  });
});

describe("useEditorStore — composition", () => {
  it("setCrop / resetCrop update crop", () => {
    const c: Crop = { x: 1, y: 2, w: 3, h: 4 };
    useEditorStore.getState().setCrop(c);
    expect(useEditorStore.getState().crop).toEqual(c);
    useEditorStore.getState().resetCrop();
    expect(useEditorStore.getState().crop).toBeNull();
  });

  it("crop is part of the undo snapshot", () => {
    const s = useEditorStore.getState();
    s.pushHistory();           // snapshot { annotations: [], crop: null }
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.undo();
    expect(useEditorStore.getState().crop).toBeNull();
    s.redo();
    expect(useEditorStore.getState().crop).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("setFrame merges, toggleFrame flips enabled, resetFrame restores defaults", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 80 });
    expect(useEditorStore.getState().frame.padding).toBe(80);
    s.toggleFrame(true);
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    s.resetFrame();
    expect(useEditorStore.getState().frame.padding).toBe(40);
    expect(useEditorStore.getState().frame.enabled).toBe(false);
  });

  it("frame changes do NOT push history", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 99 });
    expect(useEditorStore.getState().past).toEqual([]);
  });
});
