import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Frame as FrameIcon } from "lucide-react";
import { useEditorStore } from "../editor/useEditorStore";
import type { SerializedDoc } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import { ToolRail } from "./editor/ToolRail";
import { StyleBar } from "./editor/StyleBar";
import { ExportBar } from "./editor/ExportBar";
import { ProjectBar } from "./editor/ProjectBar";
import { FramePanel } from "./editor/FramePanel";
import type { ToolId } from "../editor/model";
import "./editor/editor.css";

export default function EditorView() {
  const base = useEditorStore((s) => s.base);
  const loadDoc = useEditorStore((s) => s.loadDoc);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);

  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const remove = useEditorStore((s) => s.remove);
  const selectedId = useEditorStore((s) => s.selectedId);
  const frameEnabled = useEditorStore((s) => s.frame.enabled);
  const toggleFrame = useEditorStore((s) => s.toggleFrame);

  const projectName = useEditorStore((s) => s.projectName);
  const dirty = useEditorStore((s) => s.dirty);

  useEffect(() => {
    const label = projectName ?? "Untitled";
    getCurrentWindow().setTitle(`Glint — ${dirty ? "•" : ""}${label}`).catch(() => {});
    return () => { getCurrentWindow().setTitle("Glint").catch(() => {}); };
  }, [projectName, dirty]);

  useEffect(() => {
    const keys: Record<string, ToolId> = {
      v: "select", a: "arrow", l: "line", r: "rect", o: "ellipse",
      t: "text", p: "pen", h: "highlight", b: "blur", s: "step", c: "crop",
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("glint:save-project", { detail: { asNew: e.shiftKey } }));
        return;
      }
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

  // Load (or reload) the editor source from EditorState. Used on mount AND when
  // a `.glint` is opened while the editor is already mounted (editor-open fires
  // but the route doesn't remount). loadDoc hydrates base + doc atomically.
  const loadFromSource = useCallback(() => {
    let alive = true;
    getEditorSource()
      .then((src) => {
        const img = new Image();
        img.onload = () => {
          if (!alive) return;
          const project = src.projectPath
            ? { path: src.projectPath, name: src.projectPath.split(/[\\/]/).pop() ?? src.projectPath }
            : null;
          loadDoc(
            { image: img, width: src.width, height: src.height, origin: src.origin, captureId: src.captureId },
            (src.doc as SerializedDoc | null) ?? null,
            project,
          );
        };
        img.src = src.imageDataUrl;
      })
      .catch(() => {
        /* no source (navigated here directly) — show empty state */
      });
    return () => {
      alive = false;
    };
  }, [loadDoc]);

  useEffect(() => {
    const cancel = loadFromSource();
    return () => {
      cancel();
      reset();
    };
  }, [loadFromSource, reset]);

  // Reopen path: project_open emits editor-open after setting EditorState; if we
  // are already on /editor the route won't remount, so reload here.
  useEffect(() => {
    const p = listen("editor-open", () => loadFromSource());
    return () => { p.then((un) => un()); };
  }, [loadFromSource]);

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
        <ProjectBar />
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
