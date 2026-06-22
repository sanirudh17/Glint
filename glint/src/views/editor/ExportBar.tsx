import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { Copy, Save, Share2 } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { editorCopy, editorSave, editorFlattenTemp, dragOut } from "../../lib/editor";

/** Flatten the stage to base64 PNG (no data-url prefix) at native capture resolution. */
function flatten(stage: Konva.Stage, baseWidth: number): string {
  // Guard against a not-yet-laid-out stage: a zero width would make pixelRatio
  // Infinity, which corrupts the canvas and yields a blank/throwing toDataURL.
  const stageW = stage.width();
  if (!stageW) return "";

  // Hide the selection Transformer during export so handles don't bake into the image.
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }

  const pixelRatio = baseWidth / stageW; // stageW is the scaled px width
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
  const timer = useRef<number | undefined>(undefined);

  // One live status message at a time; clears any pending timer so rapid clicks
  // don't let an earlier message cut a later one short.
  const flash = (m: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setStatus(m);
    timer.current = window.setTimeout(() => setStatus(null), 1900);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const withPng = (fn: (png: string) => Promise<void>) => async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, base.width);
    if (!png) { flash("Couldn't render the image"); return; }
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
    if (!png) { flash("Couldn't render the image"); return; }
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
