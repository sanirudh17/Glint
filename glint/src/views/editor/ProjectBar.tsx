import { useCallback, useEffect } from "react";
import { FolderOpen, Save } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { useAppStore } from "../../store/useAppStore";
import {
  saveProject, openProject, pickSavePath, pickOpenPath, pushRecentProject,
} from "../../lib/editor";

/**
 * ProjectBar — `.glint` document actions (Open / Save / Save As).
 * Save writes to the current project path silently; Save As (or an Untitled
 * Save) opens the native dialog. The single save implementation also serves the
 * Ctrl+S / Ctrl+Shift+S shortcuts via the `glint:save-project` window event.
 */
export function ProjectBar() {
  const markSaved = useEditorStore((s) => s.markSaved);
  const projectName = useEditorStore((s) => s.projectName);
  const pushToast = useAppStore((s) => s.pushToast);

  const doSave = useCallback(async (asNew: boolean) => {
    const { projectPath, annotations, crop, frame } = useEditorStore.getState();
    const doc = { annotations, crop, frame };
    let path = asNew ? null : projectPath;
    if (!path) {
      path = await pickSavePath(projectName ?? "Untitled.glint");
      if (!path) return; // cancelled
    }
    try {
      const saved = await saveProject(doc, path);
      const name = saved.split(/[\\/]/).pop() ?? saved;
      markSaved(saved, name);
      await pushRecentProject(saved);
    } catch {
      pushToast("Couldn't save the project");
    }
  }, [markSaved, projectName, pushToast]);

  const doOpen = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try {
      await openProject(path); // Rust sets EditorState + shows editor; editor-open reloads us
      await pushRecentProject(path);
    } catch {
      pushToast("Couldn't open the project");
    }
  }, [pushToast]);

  // Keyboard shortcuts (Ctrl+S / Ctrl+Shift+S) dispatch this event from EditorView.
  useEffect(() => {
    const onSaveEvent = (e: Event) => {
      const asNew = Boolean((e as CustomEvent<{ asNew: boolean }>).detail?.asNew);
      void doSave(asNew);
    };
    window.addEventListener("glint:save-project", onSaveEvent);
    return () => window.removeEventListener("glint:save-project", onSaveEvent);
  }, [doSave]);

  return (
    <div className="editor-projectbar" role="toolbar" aria-label="Project">
      <button className="editor-export-btn" onClick={doOpen} title="Open a .glint project">
        <FolderOpen size={16} strokeWidth={1.75} /> Open
      </button>
      <button className="editor-export-btn" onClick={() => doSave(false)} title="Save project (Ctrl+S)">
        <Save size={16} strokeWidth={1.75} /> Save
      </button>
      <button className="editor-export-btn" onClick={() => doSave(true)} title="Save project as… (Ctrl+Shift+S)">
        Save As
      </button>
    </div>
  );
}
