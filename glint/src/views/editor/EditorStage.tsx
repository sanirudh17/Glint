import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";
import { newId, nextStepNumber, type Annotation, type TextAnno } from "../../editor/model";
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
  const remove = useEditorStore((s) => s.remove);
  const pushHistory = useEditorStore((s) => s.pushHistory);

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

  // Fit-to-viewport scale (1 when there's no base yet). Computed before the
  // early return so the hooks below — which run unconditionally — can use it.
  const scale = base ? fitScale(box.w, box.h, base.width, base.height) : 1;

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
    if (!editing) {
      setEditBox(null);
      return;
    }
    const cont = layerRef.current?.getStage()?.container().getBoundingClientRect();
    if (!cont) return;
    setEditBox({
      left: cont.left + editing.x * scale,
      top: cont.top + editing.y * scale,
      fontSize: editing.style.fontSize * scale,
    });
  }, [editingId, scale, editing?.x, editing?.y, editing?.style.fontSize]);

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

  if (!base) return <div className="editor-canvas" ref={wrapRef} />;

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
              hidden={a.id === editingId}
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
