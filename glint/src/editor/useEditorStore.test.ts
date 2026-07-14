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

  it("discardDraft removes the draft AND pops the history entry onDown pushed", () => {
    const s = useEditorStore.getState();
    s.pushHistory(); // onDown snapshots the pre-draft state
    s.add(rect("draft"));
    expect(useEditorStore.getState().annotations).toHaveLength(1);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().discardDraft("draft");
    // No phantom shape and no wasted undo step remain.
    expect(useEditorStore.getState().annotations).toHaveLength(0);
    expect(useEditorStore.getState().past).toHaveLength(0);
    expect(useEditorStore.getState().selectedId).toBeNull();
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

  it("undo restores frame changes; redo re-applies them", () => {
    const s = useEditorStore.getState();
    s.setFrame({ padding: 20 });
    s.pushHistory(); // checkpoint at padding 20 (as a slider pointer-down would)
    s.setFrame({ padding: 80 });
    expect(useEditorStore.getState().frame.padding).toBe(80);
    s.undo();
    expect(useEditorStore.getState().frame.padding).toBe(20);
    s.redo();
    expect(useEditorStore.getState().frame.padding).toBe(80);
  });

  it("one undo step restores frame, crop, and annotations together", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.pushHistory(); // checkpoint: [a], crop null, default frame
    s.setFrame({ shadow: 90 });
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.add(rect("b"));
    s.undo();
    const st = useEditorStore.getState();
    expect(st.annotations.map((a) => a.id)).toEqual(["a"]);
    expect(st.crop).toBeNull();
    expect(st.frame.shadow).toBe(DEFAULT_FRAME.shadow);
  });

  it("resetFrame is undoable and no-ops when already default", () => {
    const s = useEditorStore.getState();
    s.resetFrame(); // frame already default → records no history
    expect(useEditorStore.getState().past).toHaveLength(0);
    s.setFrame({ padding: 88 });
    s.resetFrame();
    expect(useEditorStore.getState().frame.padding).toBe(DEFAULT_FRAME.padding);
    s.undo();
    expect(useEditorStore.getState().frame.padding).toBe(88);
  });

  it("resetCrop is undoable and no-ops when there is no crop", () => {
    const s = useEditorStore.getState();
    s.resetCrop(); // crop already null → records no history
    expect(useEditorStore.getState().past).toHaveLength(0);
    s.setCrop({ x: 0, y: 0, w: 10, h: 10 });
    s.resetCrop();
    expect(useEditorStore.getState().crop).toBeNull();
    s.undo();
    expect(useEditorStore.getState().crop).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it("toggleFrame is undoable", () => {
    const s = useEditorStore.getState();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
    s.toggleFrame();
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    s.undo();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
  });

  it("setCornerRadius sets the value without pushing history; undo/redo restore it", () => {
    const s = useEditorStore.getState();
    s.setCornerRadius(30);
    expect(useEditorStore.getState().cornerRadius).toBe(30);
    expect(useEditorStore.getState().past).toEqual([]); // the UI checkpoints, not the setter
    s.pushHistory();
    s.setCornerRadius(70);
    s.undo();
    expect(useEditorStore.getState().cornerRadius).toBe(30);
    s.redo();
    expect(useEditorStore.getState().cornerRadius).toBe(70);
  });

  it("loadDoc hydrates cornerRadius (defaults to 0 for legacy docs)", () => {
    const s = useEditorStore.getState();
    s.loadDoc(fakeBase(), { annotations: [], crop: null, frame: DEFAULT_FRAME } as never, null);
    expect(useEditorStore.getState().cornerRadius).toBe(0);
    s.loadDoc(fakeBase(), { annotations: [], crop: null, frame: DEFAULT_FRAME, cornerRadius: 45 } as never, null);
    expect(useEditorStore.getState().cornerRadius).toBe(45);
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

describe("window chrome — model & persistence", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("defaults to no chrome", () => {
    expect(DEFAULT_FRAME.chrome).toEqual({ style: "none", theme: "light", buttons: "mac", title: "", url: "" });
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    expect(useEditorStore.getState().frame.chrome.style).toBe("none");
  });

  it("mergeFrame defaults chrome for a legacy doc that lacks it", () => {
    // A legacy frame object with no `chrome` key still hydrates with the default chrome.
    const legacy = { ...DEFAULT_FRAME } as Record<string, unknown>;
    delete legacy.chrome;
    useEditorStore.getState().loadDoc(
      fakeBase(),
      { annotations: [], crop: null, frame: legacy as never },
      null,
    );
    expect(useEditorStore.getState().frame.chrome).toEqual(DEFAULT_FRAME.chrome);
  });

  it("resetFrame clears chrome back to none", () => {
    const s = useEditorStore.getState();
    s.setFrame({ chrome: { style: "window", theme: "dark", buttons: "mac", title: "X", url: "" } });
    expect(useEditorStore.getState().frame.chrome.style).toBe("window");
    s.resetFrame();
    expect(useEditorStore.getState().frame.chrome).toEqual(DEFAULT_FRAME.chrome);
  });
});

describe("window chrome — setChrome action", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("selecting Window auto-enables the frame", () => {
    const s = useEditorStore.getState();
    expect(useEditorStore.getState().frame.enabled).toBe(false);
    s.setChrome({ style: "window" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    expect(useEditorStore.getState().frame.chrome.style).toBe("window");
  });

  it("selecting Browser auto-enables the frame", () => {
    useEditorStore.getState().setChrome({ style: "browser" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
  });

  it("selecting None does NOT disable an enabled frame", () => {
    const s = useEditorStore.getState();
    s.toggleFrame(true);
    s.setChrome({ style: "none" });
    expect(useEditorStore.getState().frame.enabled).toBe(true);
    expect(useEditorStore.getState().frame.chrome.style).toBe("none");
  });

  it("switching to Window prefills the title from the project name when empty", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, { path: "C:/x/Report.glint", name: "Report.glint" });
    useEditorStore.getState().setChrome({ style: "window" });
    expect(useEditorStore.getState().frame.chrome.title).toBe("Report.glint");
  });

  it("does not overwrite a title the user already set", () => {
    const s = useEditorStore.getState();
    s.loadDoc(fakeBase(), null, { path: "C:/x/Report.glint", name: "Report.glint" });
    s.setChrome({ style: "window", title: "Mine" });
    s.setChrome({ theme: "dark" }); // unrelated change must keep the title
    expect(useEditorStore.getState().frame.chrome.title).toBe("Mine");
  });

  it("setChrome does not push undo history", () => {
    useEditorStore.getState().setChrome({ style: "browser" });
    expect(useEditorStore.getState().past).toEqual([]);
  });
});

describe("setSpotlightDim", () => {
  it("sets fillOpacity on every spotlight, leaving other annotations untouched", () => {
    const s = useEditorStore.getState();
    s.reset();
    s.add({ id: "s1", type: "spotlight", z: 0, style: { ...DEFAULT_STYLE, fillOpacity: 0.6, region: "rect" }, x: 0, y: 0, w: 10, h: 10 });
    s.add({ id: "s2", type: "spotlight", z: 0, style: { ...DEFAULT_STYLE, fillOpacity: 0.6, region: "ellipse" }, x: 5, y: 5, w: 10, h: 10 });
    s.add({ id: "r1", type: "rect", z: 0, style: { ...DEFAULT_STYLE }, x: 0, y: 0, w: 4, h: 4 });
    useEditorStore.getState().setSpotlightDim(0.25);
    const out = useEditorStore.getState().annotations;
    expect(out.filter((a) => a.type === "spotlight").every((a) => a.style.fillOpacity === 0.25)).toBe(true);
    // The non-spotlight rect keeps its original DEFAULT_STYLE opacity (1) — untouched.
    expect(out.find((a) => a.id === "r1")!.style.fillOpacity).toBe(1);
  });
});
