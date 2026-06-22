import { useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";

/** Fit the base image inside the available box without upscaling past 1:1. */
function fitScale(boxW: number, boxH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH, 1);
}

export const EditorStage = forwardRef<Konva.Stage>(function EditorStage(_props, ref) {
  const base = useEditorStore((s) => s.base);
  const select = useEditorStore((s) => s.select);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  if (!base) return <div className="editor-canvas" ref={wrapRef} />;

  const scale = fitScale(box.w, box.h, base.width, base.height);
  const stageW = Math.max(1, Math.round(base.width * scale));
  const stageH = Math.max(1, Math.round(base.height * scale));

  return (
    <div className="editor-canvas" ref={wrapRef}>
      <Stage
        ref={ref}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          // Click on empty stage clears selection.
          if (e.target === e.target.getStage()) select(null);
        }}
      >
        <Layer>
          <KonvaImage image={base.image} width={base.width} height={base.height} listening={false} />
        </Layer>
        <Layer name="annotations" />
      </Stage>
    </div>
  );
});
