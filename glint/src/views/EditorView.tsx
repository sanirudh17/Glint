import { useEffect, useRef } from "react";
import type Konva from "konva";
import { useEditorStore } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import { ToolRail } from "./editor/ToolRail";
import { StyleBar } from "./editor/StyleBar";
import type { ToolId } from "../editor/model";
import "./editor/editor.css";

export default function EditorView() {
  const base = useEditorStore((s) => s.base);
  const setBase = useEditorStore((s) => s.setBase);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);

  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const remove = useEditorStore((s) => s.remove);
  const selectedId = useEditorStore((s) => s.selectedId);

  useEffect(() => {
    const keys: Record<string, ToolId> = {
      v: "select", a: "arrow", l: "line", r: "rect", o: "ellipse",
      t: "text", p: "pen", h: "highlight", b: "blur", s: "step",
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        useEditorStore.getState().pushHistory();
        remove(selectedId);
        return;
      }
      const t = keys[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool, undo, redo, remove, selectedId]);

  useEffect(() => {
    let alive = true;
    getEditorSource()
      .then((src) => {
        const img = new Image();
        img.onload = () => {
          if (alive)
            setBase({
              image: img,
              width: src.width,
              height: src.height,
              origin: src.origin,
              captureId: src.captureId,
            });
        };
        img.src = src.imageDataUrl;
      })
      .catch(() => {
        /* no source (e.g. navigated here directly) — show empty state */
      });
    return () => {
      alive = false;
      reset();
    };
  }, [setBase, reset]);

  if (!base) {
    return (
      <div className="editor-empty">
        <span className="label">Editor</span>
        <p>Take a capture and choose Annotate, or open one from the Library.</p>
      </div>
    );
  }

  return (
    <div className="editor-view">
      <StyleBar />
      <div className="editor-main">
        <ToolRail />
        <EditorStage ref={stageRef} />
      </div>
    </div>
  );
}
