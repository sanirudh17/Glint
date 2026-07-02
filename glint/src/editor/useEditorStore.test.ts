import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore, DEFAULT_FRAME } from "./useEditorStore";
import type { EditorBase } from "./useEditorStore";
import { DEFAULT_STYLE, type Annotation } from "./model";
import type { Crop } from "./composition";

const fakeBase = (): EditorBase => ({
  image: {} as HTMLImageElement,
  width: 100,
  height: 80,
  origin: "project",
  captureId: null,
});

const sampleAnno = () =>
  ({ id: "a1", type: "rect", x: 1, y: 2, w: 3, h: 4, style: {} }) as never;

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

describe("loadDoc", () => {
  it("hydrates annotations + crop + frame atomically and clears history + dirty", () => {
    const s = useEditorStore.getState();
    // dirty the store first so we can prove loadDoc clears it
    s.pushHistory();
    s.add(sampleAnno());
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useEditorStore.getState().past.length).toBe(1);

    useEditorStore.getState().loadDoc(
      fakeBase(),
      {
        annotations: [sampleAnno()],
        crop: { x: 0, y: 0, w: 50, h: 40 },
        frame: { ...DEFAULT_FRAME, enabled: true },
      },
      { path: "C:/x/My Shot.glint", name: "My Shot.glint" },
    );

    const after = useEditorStore.getState();
    expect(after.annotations.length).toBe(1);
    expect(after.crop).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(after.frame.enabled).toBe(true);
    expect(after.past.length).toBe(0);
    expect(after.future.length).toBe(0);
    expect(after.projectPath).toBe("C:/x/My Shot.glint");
    expect(after.projectName).toBe("My Shot.glint");
    expect(after.dirty).toBe(false);
  });

  it("with null doc + null project loads a clean empty session", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    const after = useEditorStore.getState();
    expect(after.annotations).toEqual([]);
    expect(after.crop).toBeNull();
    expect(after.frame).toEqual(DEFAULT_FRAME);
    expect(after.projectPath).toBeNull();
    expect(after.projectName).toBeNull();
    expect(after.dirty).toBe(false);
  });
});

describe("dirty tracking", () => {
  it("flips dirty on a document mutation", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().add(sampleAnno());
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("does NOT flip dirty on setTool or select", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    useEditorStore.getState().setTool("rect");
    useEditorStore.getState().select("a1");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("markSaved clears dirty and records the path/name", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    useEditorStore.getState().add(sampleAnno());
    useEditorStore.getState().markSaved("C:/x/Saved.glint", "Saved.glint");
    const after = useEditorStore.getState();
    expect(after.dirty).toBe(false);
    expect(after.projectPath).toBe("C:/x/Saved.glint");
    expect(after.projectName).toBe("Saved.glint");
  });
});

describe("per-tool style memory", () => {
  beforeEach(() => useEditorStore.getState().reset());
  it("remembers each tool's last style independently", () => {
    const s = useEditorStore.getState();
    s.setTool("arrow");
    s.setStyle({ color: "#0000ff" });
    s.setTool("rect");
    expect(useEditorStore.getState().style.color).toBe(DEFAULT_STYLE.color); // rect uncustomized
    s.setTool("arrow");
    expect(useEditorStore.getState().style.color).toBe("#0000ff"); // arrow remembered
  });
});

describe("duplicate / z-order / nudge actions", () => {
  beforeEach(() => useEditorStore.getState().reset());
  it("duplicate adds a clone, selects it, and is undoable", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.duplicate("a");
    const st = useEditorStore.getState();
    expect(st.annotations.length).toBe(2);
    expect(st.selectedId).not.toBe("a");
    expect(st.selectedId).toBe(st.annotations[1].id);
    st.undo();
    expect(useEditorStore.getState().annotations.length).toBe(1);
  });
  it("bringForward / sendBackward reorder paint order", () => {
    const s = useEditorStore.getState();
    s.add(rect("a")); s.add(rect("b"));
    s.bringForward("a");
    expect(useEditorStore.getState().annotations.map((x) => x.id)).toEqual(["b", "a"]);
    s.sendBackward("a");
    expect(useEditorStore.getState().annotations.map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("nudge shifts the annotation and is undoable", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.nudge("a", 10, 0);
    expect((useEditorStore.getState().annotations[0] as { x: number }).x).toBe(10);
    useEditorStore.getState().undo();
    expect((useEditorStore.getState().annotations[0] as { x: number }).x).toBe(0);
  });
});
