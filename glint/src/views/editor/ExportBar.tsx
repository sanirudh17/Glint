import type { RefObject } from "react";
import type Konva from "konva";
import { Copy, Download, Share2, Check } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { useAppStore } from "../../store/useAppStore";
import { computeLayout, exportPixelRatio } from "../../editor/composition";
import { editorCopy, editorSave, editorFlattenTemp, editorDone, dragOut } from "../../lib/editor";

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

  const onCopy = withPng(async (png) => {
    await editorCopy(png);
    pushToast("Copied to clipboard");
  });
  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    pushToast(`Exported · ${dest.split(/[\\/]/).pop()}`);
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
      <button className="editor-export-btn" onClick={onSave} title="Export a PNG to the Library">
        <Download size={16} strokeWidth={1.75} /> Export
      </button>
      <button className="editor-export-btn editor-export-btn--primary" onClick={onDone} title="Finish — send to the corner HUD">
        <Check size={16} strokeWidth={1.75} /> Done
      </button>
    </div>
  );
}
