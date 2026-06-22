import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";
import { newId, nextStepNumber, type Annotation } from "../../editor/model";
import { AnnotationNode } from "./AnnotationNode";

function fitScale(boxW: number, boxH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH, 1);
}

export const EditorStage = forwardRef<Konva.Stage>(function EditorStage(_props, ref) {
  const base = useEditorStore((s) => s.base);
  const annotations = useEditorStore((s) => s.annotations);
  const tool = useEditorStore((s) => s.tool);
  const style = useEditorStore((s) => s.style);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const add = useEditorStore((s) => s.add);
  const update = useEditorStore((s) => s.update);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const wrapRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const draftId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Attach the Transformer to the selected node (select tool only).
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (selectedId && tool === "select") {
      const node = layer.findOne(`#${selectedId}`);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, annotations]);

  if (!base) return <div className="editor-canvas" ref={wrapRef} />;

  const scale = fitScale(box.w, box.h, base.width, base.height);
  const stageW = Math.max(1, Math.round(base.width * scale));
  const stageH = Math.max(1, Math.round(base.height * scale));

  // Pointer position in image (unscaled) coordinates.
  const imgPoint = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return { x: p.x / scale, y: p.y / scale };
  };

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    // Select tool: empty click clears selection; node clicks are handled by nodes.
    if (tool === "select") {
      if (e.target === stage) select(null);
      return;
    }
    const { x, y } = imgPoint(stage);
    pushHistory();
    const id = newId();
    draftId.current = id;
    let a: Annotation;
    switch (tool) {
      case "arrow":
      case "line":
        a = { id, type: tool, z: 0, style: { ...style }, x1: x, y1: y, x2: x, y2: y };
        break;
      case "rect":
      case "ellipse":
      case "blur":
        a = { id, type: tool, z: 0, style: { ...style }, x, y, w: 0, h: 0 };
        break;
      case "text":
        a = { id, type: "text", z: 0, style: { ...style }, x, y, text: "Text" };
        draftId.current = null; // text is placed immediately, not dragged
        break;
      case "step": {
        const number = nextStepNumber(useEditorStore.getState().annotations);
        a = { id, type: "step", z: 0, style: { ...style }, x, y, number };
        draftId.current = null;
        break;
      }
      case "pen":
      case "highlight":
        a = { id, type: tool, z: 0, style: { ...style }, points: [x, y] };
        break;
      default:
        return;
    }
    add(a);
  };

  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = draftId.current;
    if (!id) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const { x, y } = imgPoint(stage);
    const a = useEditorStore.getState().annotations.find((n) => n.id === id);
    if (!a) return;
    if (a.type === "arrow" || a.type === "line") {
      update(id, { x2: x, y2: y } as Partial<Annotation>);
    } else if (a.type === "rect" || a.type === "ellipse" || a.type === "blur") {
      update(id, { w: x - a.x, h: y - a.y } as Partial<Annotation>);
    } else if (a.type === "pen" || a.type === "highlight") {
      update(id, { points: [...a.points, x, y] } as Partial<Annotation>);
    }
  };

  const onUp = () => {
    draftId.current = null;
  };

  return (
    <div className="editor-canvas" ref={wrapRef}>
      <Stage
        ref={ref}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      >
        <Layer listening={false}>
          <KonvaImage image={base.image} width={base.width} height={base.height} />
        </Layer>
        <Layer ref={layerRef}>
          {annotations.map((a) => (
            <AnnotationNode
              key={a.id}
              anno={a}
              // Freehand strokes (pen/highlight) have no x/y origin, so dragging
              // them can't reposition anything — keep them non-draggable rather
              // than offer a dead gesture that just burns an undo step.
              draggable={tool === "select" && a.type !== "pen" && a.type !== "highlight"}
              baseImage={base.image}
              baseWidth={base.width}
              baseHeight={base.height}
              onSelect={() => tool === "select" && select(a.id)}
              onDragStart={() => pushHistory()}
              onChange={(patch) => update(a.id, patch)}
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            ignoreStroke
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
            onTransformStart={() => pushHistory()}
          />
        </Layer>
      </Stage>
    </div>
  );
});
