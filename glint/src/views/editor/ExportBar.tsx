import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { Copy, Download, Share2 } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { computeLayout, exportPixelRatio } from "../../editor/composition";
import { editorCopy, editorSave, editorFlattenTemp, dragOut } from "../../lib/editor";

/**
 * Flatten the stage to base64 PNG (no data-url prefix) at the native composition
 * resolution. Reads crop/frame from the store so the pixel-ratio scales the
 * scaled-down stage back to the full framed composition's native pixels.
 */
function flatten(stage: Konva.Stage): string {
  const { base, crop, frame } = useEditorStore.getState();
  if (!base) return "";

  // Guard against a not-yet-laid-out stage: a zero width would make pixelRatio
  // Infinity, which corrupts the canvas and yields a blank/throwing toDataURL.
  const stageW = stage.width();
  if (!stageW) return "";

  // Hide the selection Transformer during export so handles don't bake into the image.
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }

  const layout = computeLayout(base.width, base.height, crop, frame);
  const pixelRatio = exportPixelRatio(layout, stageW); // → native composition px
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
    const png = flatten(stage);
    if (!png) { flash("Couldn't render the image"); return; }
    try { await fn(png); } catch { flash("Something went wrong"); }
  };

  const onCopy = withPng(async (png) => {
    await editorCopy(png);
    flash("Copied to clipboard");
  });
  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    flash(`Exported · ${dest.split(/[\\/]/).pop()}`);
  });
  const onDrag = async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage);
    if (!png) { flash("Couldn't render the image"); return; }
    try {
      const path = await editorFlattenTemp(png);
      dragOut(path);
    } catch { flash("Couldn't prepare drag"); }
  };

  return (
    <div className="editor-exportbar">
      {status && <span className="editor-status">{status}</span>}
      <button
        className="editor-export-btn"
        // Press-and-drag: the OS drag must start while the mouse button is held,
        // so this fires on pointer-down (like the HUD/Library drag). onClick
        // fires on release, when there's no held button to attach a drag to —
        // which is why this used to do nothing.
        onPointerDown={onDrag}
        title="Press and drag onto any app"
      >
        <Share2 size={16} strokeWidth={1.75} /> Drag
      </button>
      <button className="editor-export-btn" onClick={onCopy} title="Copy to clipboard">
        <Copy size={16} strokeWidth={1.75} /> Copy
      </button>
      <button className="editor-export-btn editor-export-btn--primary" onClick={onSave} title="Export a PNG to the Library">
        <Download size={16} strokeWidth={1.75} /> Export
      </button>
    </div>
  );
}
