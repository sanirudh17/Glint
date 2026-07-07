import { useCallback, useEffect, useRef, useState } from "react";
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
import { ShortcutCheatsheet } from "./editor/ShortcutCheatsheet";
import type { ToolId } from "../editor/model";
import "./editor/editor.css";

export default function EditorView() {
  const base = useEditorStore((s) => s.base);
  const loadDoc = useEditorStore((s) => s.loadDoc);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);
  // Timestamp of the last arrow-key nudge, for history coalescing.
  const lastNudge = useRef(0);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const remove = useEditorStore((s) => s.remove);
  const selectedId = useEditorStore((s) => s.selectedId);
  const frameEnabled = useEditorStore((s) => s.frame.enabled);
  const toggleFrame = useEditorStore((s) => s.toggleFrame);

  const projectName = useEditorStore((s) => s.projectName);
  const dirty = useEditorStore((s) => s.dirty);

  // Set-title on name/dirty change; reset-on-unmount lives in a separate effect
  // so it doesn't fire on every dep change (which would briefly flash "Glint").
  useEffect(() => {
    const label = projectName ?? "Untitled";
    getCurrentWindow().setTitle(`Glint — ${dirty ? "•" : ""}${label}`).catch(() => {});
  }, [projectName, dirty]);
  useEffect(() => () => { getCurrentWindow().setTitle("Glint").catch(() => {}); }, []);

  useEffect(() => {
    const keys: Record<string, ToolId> = {
      v: "select", a: "arrow", l: "line", r: "rect", o: "ellipse",
      t: "text", p: "pen", h: "highlight", b: "blur", k: "redact", f: "spotlight",
      s: "step", e: "eraser", c: "crop",
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Block single-key shortcuts only while a TEXT-ENTRY field is focused (the
      // annotation textarea, project name, font-size, chrome title/url) — where a
      // key means "type a character". Do NOT block for non-text inputs like the
      // dim/opacity RANGE slider or the COLOR picker: those keep focus after you
      // drag them, and blocking there is exactly why pressing Delete right after
      // adjusting the dim slider was silently swallowed (the spotlight wouldn't
      // delete, so its dim looked "stuck"). Delete-all worked because it's a button
      // click, not a keyboard shortcut.
      const tag = target.tagName;
      const inputType = tag === "INPUT" ? (target as HTMLInputElement).type : "";
      const isTextEntry =
        tag === "TEXTAREA" ||
        (tag === "INPUT" &&
          !["range", "color", "checkbox", "radio", "button", "submit"].includes(inputType));
      if (isTextEntry) return;
      // `?` (Shift+/) toggles the shortcut cheatsheet — handle before the tool keys.
      if (e.key === "?") {
        e.preventDefault();
        setCheatsheetOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("glint:save-project"));
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
      const st = useEditorStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId) st.duplicate(selectedId);
        return;
      }
      if (selectedId && e.key.startsWith("Arrow") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d],
        };
        const mv = delta[e.key];
        if (mv) {
          // Coalesce a burst of rapid nudges into ONE undo step (only the first
          // nudge after a ~400ms gap records history).
          const now = Date.now();
          const fresh = now - lastNudge.current > 400;
          lastNudge.current = now;
          st.nudge(selectedId, mv[0], mv[1], fresh);
        }
        return;
      }
      // Single-key tool shortcuts must not fire on modifier combos, or e.g.
      // Ctrl+Shift+S would select Step and Ctrl+C would select Crop.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        setCheatsheetOpen(false);
        useEditorStore.getState().setPicking(false);
        return;
      }
      // Eyedropper toggle — intentionally NOT in the `keys` tool map; it toggles
      // pick mode rather than selecting a tool. Only meaningful with a drawing tool
      // active (it sets the next annotation's color), so it's a no-op in select mode.
      if (e.key.toLowerCase() === "i") {
        const st = useEditorStore.getState();
        if (st.tool === "select") return;
        e.preventDefault();
        st.setPicking(!st.picking);
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
    // Reload when a project is opened while the editor is ALREADY mounted (the
    // route doesn't remount). On a cold open the editor-open event fires before
    // this listener subscribes, so only the mount effect loads — no double-load.
    // Track the in-flight reload's canceller so unmount (or a new editor-open)
    // can abort a pending image load — otherwise its alive guard stays true and
    // loadDoc could repopulate the store after reset() has cleared it.
    let cancelReload: (() => void) | null = null;
    const p = listen("editor-open", () => {
      cancelReload?.();
      cancelReload = loadFromSource();
    });
    return () => {
      cancelReload?.();
      p.then((un) => un());
    };
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
      <ShortcutCheatsheet open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
    </div>
  );
}
