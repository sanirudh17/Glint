import { Arrow, Line, Rect, Ellipse, Text } from "react-konva";
import type Konva from "konva";
import type { Annotation, BoxAnno, TextAnno, TwoPointAnno } from "../../editor/model";

interface Props {
  anno: Annotation;
  draggable: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDragStart: () => void;
}

export function AnnotationNode({ anno, draggable, onSelect, onChange, onDragStart }: Props) {
  const common = {
    id: anno.id,
    draggable,
    onMouseDown: onSelect,
    onTap: onSelect,
    onDragStart,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      // dx/dy in image space (stage is scaled): use the node's position delta.
      const node = e.target;
      patchPosition(anno, node.x(), node.y(), onChange);
    },
  };

  switch (anno.type) {
    case "arrow": {
      const a = anno as TwoPointAnno;
      return (
        <Arrow
          {...common}
          x={0} y={0}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          fill={a.style.color}
          strokeWidth={a.style.strokeWidth}
          pointerLength={10 + a.style.strokeWidth}
          pointerWidth={10 + a.style.strokeWidth}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "line": {
      const a = anno as TwoPointAnno;
      return (
        <Line
          {...common}
          x={0} y={0}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth}
          lineCap="round"
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "rect": {
      const a = anno as BoxAnno;
      return (
        <Rect
          {...common}
          x={a.x} y={a.y} width={a.w} height={a.h}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
        />
      );
    }
    case "ellipse": {
      const a = anno as BoxAnno;
      return (
        <Ellipse
          {...common}
          x={a.x + a.w / 2} y={a.y + a.h / 2}
          radiusX={Math.abs(a.w / 2)} radiusY={Math.abs(a.h / 2)}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
          onDragEnd={(e) => {
            const node = e.target;
            onChange({ x: node.x() - a.w / 2, y: node.y() - a.h / 2 } as Partial<Annotation>);
          }}
        />
      );
    }
    case "text": {
      const a = anno as TextAnno;
      return (
        <Text
          {...common}
          x={a.x} y={a.y} text={a.text || " "}
          fontSize={a.style.fontSize} fill={a.style.color}
        />
      );
    }
    default:
      return null; // step + blur added in Task 11
  }
}

function patchPosition(
  anno: Annotation,
  x: number,
  y: number,
  onChange: (patch: Partial<Annotation>) => void,
) {
  if (anno.type === "arrow" || anno.type === "line") {
    const a = anno as TwoPointAnno;
    // The dragged node accumulates its offset in x/y (the points stay at their
    // original coords). Fold that delta into the points; the node itself is
    // pinned back to the origin via the x={0} y={0} props on Arrow/Line, so the
    // translated points are authoritative and the offset isn't double-counted.
    const dx = x; const dy = y;
    onChange({ x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as Partial<Annotation>);
  } else {
    onChange({ x, y } as Partial<Annotation>);
  }
}
