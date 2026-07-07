import { useEffect, useRef } from "react";
import { Arrow, Line, Rect, Ellipse, Text, Group, Image as KonvaImage, Circle } from "react-konva";
import Konva from "konva";
import type { Annotation, BoxAnno, FreehandAnno, StepAnno, TextAnno, TwoPointAnno } from "../../editor/model";

/** "#RRGGBB" + alpha → "rgba(r,g,b,a)". Returns the input untouched if it isn't a
 * 6-digit hex (e.g. already rgba), so custom colours still work. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DASH = [12, 8];

interface Props {
  anno: Annotation;
  draggable: boolean;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  /** Hide the Konva node — used to make room for the DOM textarea while a text
      annotation is being edited. */
  hidden?: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDragStart: () => void;
}

export function AnnotationNode({ anno, draggable, baseImage, baseWidth, baseHeight, hidden, onSelect, onChange, onDragStart }: Props) {
  const common = {
    id: anno.id,
    draggable,
    visible: !hidden,
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
          dash={a.style.dashed ? DASH : undefined}
          pointerAtBeginning={a.style.arrowStart ?? false}
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
          dash={a.style.dashed ? DASH : undefined}
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
          dash={a.style.dashed ? DASH : undefined}
          fill={a.style.fill ? hexToRgba(a.style.fill, a.style.fillOpacity ?? 1) : undefined}
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
          dash={a.style.dashed ? DASH : undefined}
          fill={a.style.fill ? hexToRgba(a.style.fill, a.style.fillOpacity ?? 1) : undefined}
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
    case "pen": {
      const a = anno as FreehandAnno;
      return (
        <Line
          {...common}
          points={a.points}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.2}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "highlight": {
      const a = anno as FreehandAnno;
      return (
        <Line
          {...common}
          points={a.points}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth * 4}
          lineCap="round"
          lineJoin="round"
          opacity={0.4}
          hitStrokeWidth={Math.max(16, a.style.strokeWidth * 4)}
        />
      );
    }
    case "step": {
      const a = anno as StepAnno;
      const r = 14 + a.style.strokeWidth * 2;
      return (
        <Group {...common} x={a.x} y={a.y}>
          <Circle radius={r} fill={a.style.color} />
          <Text
            text={String(a.number)}
            fontSize={r}
            fontStyle="bold"
            fill="#fff"
            width={r * 2}
            height={r * 2}
            offsetX={r}
            offsetY={r}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );
    }
    case "blur": {
      const a = anno as BoxAnno;
      return (
        <BlurRegion
          a={a}
          baseImage={baseImage}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
    case "redact": {
      const a = anno as BoxAnno;
      return (
        <RedactRegion
          a={a}
          baseImage={baseImage}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
    case "spotlight": {
      const a = anno as BoxAnno;
      return (
        <SpotlightRegion
          a={a}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
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

/** A non-destructive blur: a cached, blurred copy of the base image clipped to a rect. */
function BlurRegion({
  a, baseImage, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  // Normalize negative drag rects.
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);

  useEffect(() => {
    const node = ref.current;
    if (!node || w < 1 || h < 1) return;
    // Cache only the visible region — the group is pinned to the origin and the
    // clip lives at (x,y), so the blur filter runs over just that slice rather
    // than the whole base image (which can be a multi-megapixel screenshot).
    node.cache({ x, y, width: w, height: h });
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, baseImage]);

  if (w < 1 || h < 1) return null;

  return (
    <Group
      id={a.id}
      ref={ref}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) =>
        // The group is pinned to the origin (x={0} y={0} below) with the clip at
        // the stored rect, so a drag accumulates only its delta into the node
        // position. Fold that delta into the rect; the re-render snaps the node
        // back to 0,0 and re-clips to the new position.
        onChange({ x: x + e.target.x(), y: y + e.target.y(), w, h } as Partial<Annotation>)
      }
      x={0}
      y={0}
      clipX={x}
      clipY={y}
      clipWidth={w}
      clipHeight={h}
      filters={[Konva.Filters.Blur]}
      blurRadius={14}
    >
      <KonvaImage image={baseImage} width={baseWidth} height={baseHeight} listening={false} />
    </Group>
  );
}

/** Redaction: "solid" paints an opaque block (pixels gone from the export);
 * "pixelate" is a cached, mosaic'd copy of the base image clipped to a rect. */
function RedactRegion({
  a, baseImage, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  const pixelate = a.style.redactStyle === "pixelate";

  useEffect(() => {
    const node = ref.current;
    if (!node || !pixelate || w < 1 || h < 1) return;
    node.cache({ x, y, width: w, height: h });
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, baseImage, pixelate]);

  if (w < 1 || h < 1) return null;

  if (!pixelate) {
    // Solid opaque block. The underlying pixels are not present in the export.
    return (
      <Rect
        id={a.id}
        x={x} y={y} width={w} height={h}
        fill={a.style.color}
        draggable={draggable}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragStart={onDragStart}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
      />
    );
  }

  return (
    <Group
      id={a.id}
      ref={ref}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) =>
        onChange({ x: x + e.target.x(), y: y + e.target.y(), w, h } as Partial<Annotation>)
      }
      x={0}
      y={0}
      clipX={x}
      clipY={y}
      clipWidth={w}
      clipHeight={h}
      filters={[Konva.Filters.Pixelate]}
      pixelSize={14}
    >
      <KonvaImage image={baseImage} width={baseWidth} height={baseHeight} listening={false} />
    </Group>
  );
}

/** Spotlight: dim the whole canvas except one bright region (rect or ellipse). The
 * dim + hole live in a CACHED group so the destination-out composite is isolated to
 * the group's own buffer (it must not erase the base image beneath). A separate
 * invisible rect over the region provides selection + drag. */
function SpotlightRegion({
  a, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  const dim = a.style.fillOpacity ?? 0.6;
  const region = a.style.region ?? "rect";

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.cache({ x: 0, y: 0, width: baseWidth, height: baseHeight });
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, dim, region, baseWidth, baseHeight]);

  return (
    <>
      <Group ref={ref} listening={false} x={0} y={0}>
        <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={dim} />
        {region === "ellipse" ? (
          <Ellipse
            x={x + w / 2} y={y + h / 2}
            radiusX={Math.abs(w / 2)} radiusY={Math.abs(h / 2)}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        ) : (
          <Rect
            x={x} y={y} width={w} height={h}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        )}
      </Group>
      {/* Invisible (opacity 0) but fully hittable — Konva's hit canvas ignores opacity. */}
      <Rect
        id={a.id}
        x={x} y={y} width={w} height={h}
        fill="#ffffff" opacity={0}
        draggable={draggable}
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragStart={onDragStart}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
      />
    </>
  );
}
