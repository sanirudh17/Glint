import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Group, Rect, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";
import { newId, nextStepNumber, type Annotation, type TextAnno } from "../../editor/model";
import { computeLayout } from "../../editor/composition";
import { getGradient, konvaGradient } from "../../editor/gradients";
import { AnnotationNode } from "./AnnotationNode";
import { CropOverlay } from "./CropOverlay";

function fitScale(boxW: number, boxH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH, 1);
}

/** Trace a rounded-rect path (clamped radius) for a Group clipFunc. */
function roundedRectPath(ctx: Konva.Context, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const EditorStage = forwardRef<Konva.Stage>(function EditorStage(_props, ref) {
  const base = useEditorStore((s) => s.base);
  const annotations = useEditorStore((s) => s.annotations);
  const tool = useEditorStore((s) => s.tool);
  const style = useEditorStore((s) => s.style);
  const selectedId = useEditorStore((s) => s.selectedId);
  const crop = useEditorStore((s) => s.crop);
  const frame = useEditorStore((s) => s.frame);
  const select = useEditorStore((s) => s.select);
  const add = useEditorStore((s) => s.add);
  const update = useEditorStore((s) => s.update);
  const remove = useEditorStore((s) => s.remove);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const setCrop = useEditorStore((s) => s.setCrop);
  const setTool = useEditorStore((s) => s.setTool);

  const wrapRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const draftId = useRef<string | null>(null);

  // Which text annotation (if any) is open for inline editing, and where to float
  // its DOM <textarea>. Text is rendered by Konva but edited via a real textarea
  // overlaid at the node's screen position (Konva has no text input of its own).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBox, setEditBox] = useState<{ left: number; top: number; fontSize: number } | null>(null);
  const editing = annotations.find((a) => a.id === editingId && a.type === "text") as
    | TextAnno
    | undefined;

  // Composition geometry (crop + frame) drives the stage size and every
  // coordinate mapping. Computed before the early return so the hooks below —
  // which run unconditionally — can use it. With frame off + no crop the layout
  // is the identity (compositionW/H == image size, offsets 0).
  const layout = base ? computeLayout(base.width, base.height, crop, frame) : null;
  const compW = layout?.compositionW ?? 1;
  const compH = layout?.compositionH ?? 1;
  const scale = layout ? fitScale(box.w, box.h, compW, compH) : 1;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Attach the Transformer to the selected node (select tool only, and never to
  // a node that's currently being text-edited — its handles would float around
  // the hidden node).
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (selectedId && tool === "select" && selectedId !== editingId) {
      const node = layer.findOne(`#${selectedId}`);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, annotations, editingId]);

  // Position the editing textarea over the text node's on-screen location.
  // Recomputed when the edit target, its origin, font size, or the scale change
  // (not on every keystroke, so the box stays put while typing).
  useLayoutEffect(() => {
    if (!editing || !layout) {
      setEditBox(null);
      return;
    }
    const cont = layerRef.current?.getStage()?.container().getBoundingClientRect();
    if (!cont) return;
    // Image coords → screen: shift by the content offset (cropX→contentX), then
    // scale. With frame off + no crop this reduces to editing.x * scale.
    setEditBox({
      left: cont.left + (editing.x - layout.cropX + layout.contentX) * scale,
      top: cont.top + (editing.y - layout.cropY + layout.contentY) * scale,
      fontSize: editing.style.fontSize * scale,
    });
  }, [editingId, scale, editing?.x, editing?.y, editing?.style.fontSize,
      layout?.cropX, layout?.cropY, layout?.contentX, layout?.contentY]);

  // Focus + select-all when the editor opens.
  useEffect(() => {
    if (editingId && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [editingId]);

  // Grow the textarea to fit its contents (no wrapping — matches Konva, which
  // only breaks on explicit newlines).
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el || !editBox) return;
    el.style.width = "auto";
    el.style.height = "auto";
    el.style.width = `${el.scrollWidth + 2}px`;
    el.style.height = `${el.scrollHeight}px`;
  }, [editing?.text, editBox]);

  const commitEdit = () => {
    const id = editingId;
    if (!id) return;
    const a = useEditorStore.getState().annotations.find((n) => n.id === id);
    // Drop a text annotation the user left blank.
    if (a && a.type === "text" && !a.text.trim()) remove(id);
    setEditingId(null);
  };

  if (!base || !layout) return <div className="editor-canvas" ref={wrapRef} />;

  const stageW = Math.max(1, Math.round(compW * scale));
  const stageH = Math.max(1, Math.round(compH * scale));
  // The annotation layer is offset so image point (cropX,cropY) lands at the
  // content's top-left (contentX,contentY). Frame off + no crop → (0,0).
  const offX = layout.contentX - layout.cropX;
  const offY = layout.contentY - layout.cropY;
  // Clip annotations to the content only when there's actually something to clip
  // against — a frame backdrop or a crop. With frame off + no crop, content == the
  // full image, so no clip is needed and omitting it keeps this path byte-identical
  // to Phase 5a (strokes that bleed a hair past the edge render as they did before).
  const clipContent = frame.enabled || crop !== null;

  // Frame visuals (no-op when the frame is off: r=0, no shadow → plain image).
  const r = frame.enabled ? frame.radius : 0;
  // Shadow scales with the screenshot's long edge (so it reads the same on any
  // capture size) and ramps clearly across the slider — even a low setting is
  // plainly visible and the max is bold. (Tuned up after at-screen feedback that
  // the old fixed-px values were barely visible on large captures.)
  const shadowProps =
    frame.enabled && frame.shadow > 0
      ? (() => {
          const longEdge = Math.max(layout.contentW, layout.contentH);
          const t = frame.shadow / 100; // 0..1
          return {
            shadowColor: "#000",
            shadowBlur: Math.round((0.02 + t * 0.1) * longEdge), // 2%..12% of long edge
            shadowOpacity: 0.2 + t * 0.5, // 0.2..0.7
            shadowOffsetY: Math.round((0.01 + t * 0.05) * longEdge), // 1%..6% of long edge
          };
        })()
      : {};

  // A transparent frame leaves the padding/corner area see-through; show a
  // checkerboard behind the (transparent) canvas so it's unmistakably "this will
  // export with alpha" — not a flat backdrop and not the same as frame-off. The
  // checker is CSS on the wrapper (never in the Konva canvas), so export stays alpha.
  const showChecker = frame.enabled && frame.background.type === "transparent";

  // Pointer position in image (unscaled) coordinates. Inverts the layer offset:
  // screen → composition (÷scale) → image (subtract content offset, add crop origin).
  const imgPoint = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return {
      x: p.x / scale - layout.contentX + layout.cropX,
      y: p.y / scale - layout.contentY + layout.cropY,
    };
  };

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    // Crop tool: the DOM CropOverlay drives the interaction (and covers the
    // stage), so the stage itself does nothing.
    if (tool === "crop") return;
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
        // Start empty and open the inline editor immediately so the user just
        // types. A blank text is dropped on commit (see commitEdit).
        a = { id, type: "text", z: 0, style: { ...style }, x, y, text: "" };
        draftId.current = null; // text is placed immediately, not dragged
        setEditingId(id);
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

  // Double-click an existing text annotation (Select tool) to re-edit it.
  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = e.target.id();
    const a = annotations.find((n) => n.id === id);
    if (a && a.type === "text") {
      select(id);
      pushHistory();
      setEditingId(id);
    }
  };

  return (
    <div className="editor-canvas" ref={wrapRef}>
      {/* A relative box exactly the size of the stage, so the absolutely-
          positioned crop overlay shares the stage's origin and bounds. */}
      <div
        className={`editor-stage-wrap${showChecker ? " editor-stage-wrap--checker" : ""}`}
        style={{ width: stageW, height: stageH }}
      >
      <Stage
        ref={ref}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onDblClick={onDblClick}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      >
        {/* Background fill (gradient/solid). Transparent → no rect → alpha in export. */}
        {frame.enabled && frame.background.type !== "transparent" && (
          <Layer listening={false}>
            <Rect
              x={0}
              y={0}
              width={compW}
              height={compH}
              {...(frame.background.type === "solid"
                ? { fill: frame.background.color }
                : konvaGradient(getGradient(frame.background.gradientId), compW, compH))}
            />
          </Layer>
        )}

        {/* Screenshot card: a shadow-casting rounded rect behind, then the image
            clipped to the same rounded rect. Frame off → no shadow, r=0, plain image.
            The shadow renders for every background type INCLUDING transparent — a
            framed screenshot dropped onto a slide keeps its drop shadow against the
            alpha (matches CleanShot); only the background fill is omitted when transparent. */}
        <Layer listening={false}>
          {frame.enabled && (
            <Rect
              x={layout.contentX}
              y={layout.contentY}
              width={layout.contentW}
              height={layout.contentH}
              cornerRadius={r}
              fill="#000"
              {...shadowProps}
            />
          )}
          <Group
            clipFunc={
              r > 0
                ? (ctx) => roundedRectPath(ctx, layout.contentX, layout.contentY, layout.contentW, layout.contentH, r)
                : undefined
            }
          >
            <KonvaImage
              image={base.image}
              x={layout.contentX}
              y={layout.contentY}
              width={layout.contentW}
              height={layout.contentH}
              crop={{ x: layout.cropX, y: layout.cropY, width: layout.contentW, height: layout.contentH }}
            />
          </Group>
        </Layer>
        {/* Annotations are offset onto the screenshot. Only the strokes are
            clipped (a Group) so they can't spill onto the frame backdrop; the
            Transformer is a sibling in the same layer so its resize handles —
            which extend a few px outside an edge annotation — are never clipped. */}
        <Layer ref={layerRef} x={offX} y={offY}>
          <Group
            {...(clipContent
              ? {
                  clipX: layout.cropX,
                  clipY: layout.cropY,
                  clipWidth: layout.contentW,
                  clipHeight: layout.contentH,
                }
              : {})}
          >
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
                hidden={a.id === editingId}
                onSelect={() => tool === "select" && select(a.id)}
                onDragStart={() => pushHistory()}
                onChange={(patch) => update(a.id, patch)}
              />
            ))}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            ignoreStroke
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
            onTransformStart={() => pushHistory()}
          />
        </Layer>
      </Stage>

        {tool === "crop" && (
          <CropOverlay
            layout={layout}
            scale={scale}
            imageW={base.width}
            imageH={base.height}
            onConfirm={(c) => {
              pushHistory();
              setCrop(c);
              setTool("select");
            }}
            onCancel={() => setTool("select")}
          />
        )}
      </div>

      {editing && editBox && (
        <textarea
          ref={taRef}
          className="editor-text-input"
          value={editing.text}
          wrap="off"
          spellCheck={false}
          style={{ left: editBox.left, top: editBox.top, fontSize: editBox.fontSize, color: editing.style.color }}
          onChange={(e) => update(editing.id, { text: e.target.value } as Partial<Annotation>)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              commitEdit();
            }
          }}
          onBlur={commitEdit}
        />
      )}
    </div>
  );
});
