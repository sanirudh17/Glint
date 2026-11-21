import { type RefObject } from "react";
import type Konva from "konva";
import { Copy, Download, Share2, CheckCheck } from "../../icons";
import { useEditorStore } from "../../editor/useEditorStore";
import { useAppStore } from "../../store/useAppStore";
import { editorCopy, editorSave, editorFlattenTemp, editorDone, dragOut } from "../../lib/editor";
import { flatten } from "../../editor/flatten";

export function ExportBar({ stageRef }: { stageRef: RefObject<Konva.Stage | null> }) {
  const base = useEditorStore((s) => s.base);
  const rendering=useEditorStore(s=>s.renderingLook);
  // Feedback goes through the app's toast host (a clean corner toast) rather than
  // an inline status span — a long "Exported · <filename>" used to wrap inside
  // the toolbar and squash the buttons into a cramped box.
  const pushToast = useAppStore((s) => s.pushToast);

  const withPng = (fn: (png: string) => Promise<void>) => async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage);
    if (!png) { pushToast("Couldn't render the image"); return; }
    try { await fn(png); } catch { pushToast("Something went wrong"); }
  };

  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    pushToast(`Exported · ${dest.split(/[\\/]/).pop()}`);
  });
  const onCopy = withPng(async (png) => {
    await editorCopy(png);
    pushToast("Image copied");
  });
  const onDrag = async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage);
    if (!png) { pushToast("Couldn't render the image"); return; }
    try {
      const path = await editorFlattenTemp(png);
      dragOut(path);
    } catch { pushToast("Couldn't prepare drag"); }
  };
  const onDone = withPng(async (png) => {
    await editorDone(png);
  });

  return (
    <div className="editor-exportbar">
      <button
        className="editor-export-btn"
        disabled={!base || rendering}
        // Press-and-drag: the OS drag must start while the mouse button is held,
        // so this fires on pointer-down (like the HUD/Library drag). onClick
        // fires on release, when there's no held button to attach a drag to —
        // which is why this used to do nothing.
        onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();void onDrag();}}
        title="Press and drag onto any app"
      >
        <Share2 size={16} strokeWidth={1.5} /><span>Drag</span>
      </button>
      <button className="editor-export-btn" disabled={!base || rendering} onClick={onCopy} title="Copy the edited image">
        <Copy size={16} strokeWidth={1.5} /><span>Copy</span>
      </button>
      <button className="editor-export-btn" disabled={!base || rendering} onClick={onSave} title="Export a PNG to the Library">
        <Download size={16} strokeWidth={1.5} /><span>Export</span>
      </button>
      <button className="editor-export-btn editor-export-btn--primary editor-done-btn" disabled={!base || rendering} onClick={onDone} title="Finish — send to the corner HUD">
        <CheckCheck size={16} strokeWidth={1.5} aria-hidden="true" /><span>Done</span>
      </button>
    </div>
  );
}
