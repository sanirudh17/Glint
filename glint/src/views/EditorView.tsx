import { useEffect, useRef } from "react";
import type Konva from "konva";
import { useEditorStore } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import "./editor/editor.css";

export default function EditorView() {
  const base = useEditorStore((s) => s.base);
  const setBase = useEditorStore((s) => s.setBase);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);

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
      <div className="editor-main">
        <EditorStage ref={stageRef} />
      </div>
    </div>
  );
}
