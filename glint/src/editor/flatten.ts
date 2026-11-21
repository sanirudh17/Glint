import type Konva from "konva";
import { useEditorStore } from "./useEditorStore";
import { computeLayout, exportPixelRatio } from "./composition";
import { withoutEditorChrome } from "./privacy";

/**
 * Flatten the stage to base64 PNG (no data-url prefix) at the native composition
 * resolution. Reads crop/frame from the store so the pixel-ratio scales the
 * (fit-to-viewport) stage back up to the full framed composition's native pixels.
 */
export function flatten(stage: Konva.Stage): string {
  const { base, crop, frame, canvasSize } = useEditorStore.getState();
  if (!base) return "";

  // Guard against a not-yet-laid-out stage: a zero width would make pixelRatio
  // Infinity, which corrupts the canvas and yields a blank/throwing toDataURL.
  const stageW = stage.width();
  if (!stageW) return "";

  // Hide the selection Transformer during export so handles don't bake into the image.
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }

  const layout = computeLayout(canvasSize?.width??base.width, canvasSize?.height??base.height, crop, frame);
  const pixelRatio = exportPixelRatio(layout, stageW); // native resolution
  let url: string;
  try {
    return withoutEditorChrome(stage,()=>{if(frame.enabled&&frame.outputSize) {
      const image=stage.toCanvas({pixelRatio:frame.outputSize.width/layout.compositionW});
      const output=document.createElement('canvas');output.width=frame.outputSize.width;output.height=frame.outputSize.height;
      output.getContext('2d')!.drawImage(image,0,0,output.width,output.height);url=output.toDataURL('image/png');
    } else url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });return url.split(',')[1]??'';});
  } finally {
    // Always restore Transformer nodes even if toDataURL throws.
    if (tr) { tr.nodes(hadNodes); tr.getLayer()?.batchDraw(); }
  }
}

