import { useEffect, useRef } from "react";
import type Konva from "konva";
import { Frame as FrameIcon } from "lucide-react";
import { useEditorStore } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import { ToolRail } from "./editor/ToolRail";
import { StyleBar } from "./editor/StyleBar";
import { ExportBar } from "./editor/ExportBar";
import { FramePanel } from "./editor/FramePanel";
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
  const frameEnabled = useEditorStore((s) => s.frame.enabled);
  const toggleFrame = useEditorStore((s) => s.toggleFrame);

  useEffect(() => {
    const keys: Record<string, ToolId> = {
      v: "select", a: "arrow", l: "line", r: "rect", o: "ellipse",
      t: "text", p: "pen", h: "highlight", b: "blur", s: "step", c: "crop",
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
      // No-op when the tool is already active — avoids a needless store update
      // (and selection clear) on a repeated tool key, e.g. "c" mid-crop.
      if (t && t !== useEditorStore.getState().tool) setTool(t);
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
      <div className="editor-topbar">
        <StyleBar />
        <div className="editor-frame-slot">
          <button
            className={`editor-export-btn${frameEnabled ? " editor-export-btn--primary" : ""}`}
            onClick={() => toggleFrame()}
            title="Frame & background"
            aria-pressed={frameEnabled}
          >
            <FrameIcon size={16} strokeWidth={1.75} /> Frame
          </button>
        </div>
        <ExportBar stageRef={stageRef} />
      </div>
      <div className="editor-main">
        <ToolRail />
        <EditorStage ref={stageRef} />
        {frameEnabled && <FramePanel />}
      </div>
    </div>
  );
}
