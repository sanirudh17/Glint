import { useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { Copy, Save, Share2 } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { editorCopy, editorSave, editorFlattenTemp, dragOut } from "../../lib/editor";

/** Flatten the stage to base64 PNG (no data-url prefix) at native capture resolution. */
function flatten(stage: Konva.Stage, baseWidth: number): string {
  // Hide the selection Transformer during export so handles don't bake into the image.
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }

  const pixelRatio = baseWidth / stage.width(); // stage.width() is the scaled px width
  let url: string;
  try {
    url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });
  } finally {
    // Always restore Transformer nodes even if toDataURL throws.
    if (tr) { tr.nodes(hadNodes); tr.getLayer()?.batchDraw(); }
  }
  return url.split(",")[1] ?? "";
}

export function ExportBar({ stageRef }: { stageRef: RefObject<Konva.Stage | null> }) {
  const base = useEditorStore((s) => s.base);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (m: string) => {
    setStatus(m);
    window.setTimeout(() => setStatus(null), 1900);
  };

  const withPng = (fn: (png: string) => Promise<void>) => async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, base.width);
    try { await fn(png); } catch { flash("Something went wrong"); }
  };

  const onCopy = withPng(async (png) => {
    await editorCopy(png);
    flash("Copied to clipboard");
  });
  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    flash(`Saved · ${dest.split(/[\\/]/).pop()}`);
  });
  const onDrag = async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, base.width);
    try {
      const path = await editorFlattenTemp(png);
      dragOut(path);
    } catch { flash("Couldn't prepare drag"); }
  };

  return (
    <div className="editor-exportbar">
      {status && <span className="editor-status">{status}</span>}
      <button className="editor-export-btn" onClick={onDrag} title="Drag out">
        <Share2 size={16} strokeWidth={1.75} /> Drag
      </button>
      <button className="editor-export-btn" onClick={onCopy} title="Copy to clipboard">
        <Copy size={16} strokeWidth={1.75} /> Copy
      </button>
      <button className="editor-export-btn editor-export-btn--primary" onClick={onSave} title="Save a new PNG">
        <Save size={16} strokeWidth={1.75} /> Save
      </button>
    </div>
  );
}
