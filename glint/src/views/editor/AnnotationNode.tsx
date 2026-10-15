import { useMemo } from "react";
import { Arrow, Line, Rect, Ellipse, Text, Group, Image as KonvaImage, Circle,Label,Tag } from "react-konva";
import {arrowPoints} from '../../editor/annotationStyles';
import Konva from "konva";
import {privacyPixels,opaqueRedactionColor} from "../../editor/privacy";
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
  baseImage: HTMLImageElement|HTMLCanvasElement;
  layerImage?:HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  /** Hide the Konva node — used to make room for the DOM textarea while a text
      annotation is being edited. */
  hidden?: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDragStart: () => void;
}

export function AnnotationNode({ anno, draggable, baseImage, layerImage, baseWidth, baseHeight, hidden, onSelect, onChange, onDragStart }: Props) {
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
    case 'image': return <KonvaImage {...common} image={layerImage} x={anno.x} y={anno.y} width={anno.w} height={anno.h} onDragEnd={e=>onChange({x:Math.round(e.target.x()),y:Math.round(e.target.y())})} onTransformEnd={e=>{const n=e.target;const w=Math.max(1,Math.round(n.width()*n.scaleX())),h=Math.max(1,Math.round(n.height()*n.scaleY()));n.scaleX(1);n.scaleY(1);onChange({x:Math.round(n.x()),y:Math.round(n.y()),w,h});}}/>;
    case "arrow": {
      const a = anno as TwoPointAnno;
      return (
        <Arrow
          {...common}
          x={0} y={0}
          points={arrowPoints(a)}
          tension={(a.style.curve??0)!==0?0.5:0}
          stroke={a.style.color}
          fill={a.style.color}
          strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          pointerAtBeginning={a.style.arrowStart ?? false}
          pointerLength={10 + a.style.strokeWidth}
          pointerWidth={10 + a.style.strokeWidth}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
          onTransformEnd={e=>{const n=e.target,t=n.getTransform(),first=t.point({x:a.x1,y:a.y1}),last=t.point({x:a.x2,y:a.y2});n.scaleX(1);n.scaleY(1);n.position({x:0,y:0});onChange({x1:first.x,y1:first.y,x2:last.x,y2:last.y});}}
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
      // Normalize negative drags (dragging left/up creates negative w/h).
      // Without this the rect draws with negative width, hit area breaks,
      // and resize stutters near the image border. Mirrors Blur/Redact/Spotlight.
      const x = Math.min(a.x, a.x + a.w);
      const y = Math.min(a.y, a.y + a.h);
      const w = Math.abs(a.w);
      const h = Math.abs(a.h);
      return (
        <Rect
          {...common}
          x={x} y={y} width={w} height={h}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
          dash={a.style.dashed ? DASH : undefined}
          fill={a.style.fill ? hexToRgba(a.style.fill, a.style.fillOpacity ?? 1) : undefined}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
          hitStrokeWidth={Math.max(8, a.style.strokeWidth * 1.5)}
          // Normalize drag offset for normalized rects
          onDragEnd={(e) => {
            const node = e.target;
            onChange({ x: node.x(), y: node.y(), w, h } as Partial<Annotation>);
          }}
          onTransformEnd={(e) => {
            const node = e.target;
            const nw = Math.max(1, node.width() * node.scaleX());
            const nh = Math.max(1, node.height() * node.scaleY());
            node.scaleX(1);
            node.scaleY(1);
            onChange({ x: node.x(), y: node.y(), w: nw, h: nh } as Partial<Annotation>);
          }}
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
      if(a.style.textPreset==='label')return <Label {...common} x={a.x} y={a.y}><Tag fill="#20242c" cornerRadius={5}/><Text id={a.id} text={a.text||' '} fontSize={a.style.fontSize} fill={a.style.color} padding={8} fontStyle="bold"/></Label>;
      return (
        <Text
          {...common}
          x={a.x} y={a.y} text={a.text || " "}
          fontSize={a.style.fontSize} fill={a.style.color}
          fontFamily={a.style.textPreset==='code'?'Courier New':undefined} fontStyle={a.style.textPreset==='heading'?'bold':'normal'}
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

/** Privacy effects rasterize only their bounded region, with an opaque backing. */
function PrivacyRegion({a,baseImage,draggable,onSelect,onDragStart,onChange,blur}: {
  a:BoxAnno;baseImage:HTMLImageElement|HTMLCanvasElement;draggable:boolean;onSelect:()=>void;
  onDragStart:()=>void;onChange:(patch:Partial<Annotation>)=>void;blur:boolean;
}) {
  const x=Math.floor(Math.min(a.x,a.x+a.w)),y=Math.floor(Math.min(a.y,a.y+a.h));
  const w=Math.ceil(Math.max(a.x,a.x+a.w))-x,h=Math.ceil(Math.max(a.y,a.y+a.h))-y;
  const filtered=useMemo(()=>{
    if(w<1||h<1||!blur&&a.style.redactStyle!=='pixelate')return null;
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#777777';ctx.fillRect(0,0,w,h);ctx.drawImage(baseImage,x,y,w,h,0,0,w,h);
    ctx.putImageData(new ImageData(privacyPixels(ctx.getImageData(0,0,w,h).data,w,h),w,h),0,0);
    if(!blur)return canvas;
    const softened=document.createElement('canvas');softened.width=w;softened.height=h;
    const target=softened.getContext('2d')!;target.fillStyle='#777777';target.fillRect(0,0,w,h);
    target.filter=`blur(${Math.max(16,Math.min(48,Math.min(w,h)/2))}px)`;target.drawImage(canvas,0,0);return softened;
  },[x,y,w,h,baseImage,blur,a.style.redactStyle]);
  if(w<1||h<1)return null;
  const common={id:a.id,x,y,width:w,height:h,draggable,onMouseDown:onSelect,onTap:onSelect,onDragStart,
    onDragEnd:(e:Konva.KonvaEventObject<DragEvent>)=>onChange({x:Math.round(e.target.x()),y:Math.round(e.target.y()),w,h}),
    onTransformEnd:(e:Konva.KonvaEventObject<Event>)=>{const n=e.target,nw=Math.max(1,Math.round(n.width()*n.scaleX())),nh=Math.max(1,Math.round(n.height()*n.scaleY()));n.scaleX(1);n.scaleY(1);onChange({x:Math.round(n.x()),y:Math.round(n.y()),w:nw,h:nh});}};
  return filtered?<KonvaImage {...common} image={filtered}/>:<Rect {...common} fill={opaqueRedactionColor(a.style.color)}/>;
}
function BlurRegion(props:{a:BoxAnno;baseImage:HTMLImageElement|HTMLCanvasElement;baseWidth:number;baseHeight:number;draggable:boolean;onSelect:()=>void;onDragStart:()=>void;onChange:(patch:Partial<Annotation>)=>void}){return <PrivacyRegion {...props} blur/>;}
function RedactRegion(props:{a:BoxAnno;baseImage:HTMLImageElement|HTMLCanvasElement;baseWidth:number;baseHeight:number;draggable:boolean;onSelect:()=>void;onDragStart:()=>void;onChange:(patch:Partial<Annotation>)=>void}){return <PrivacyRegion {...props} blur={false}/>;}
/** A spotlight annotation is now ONLY an invisible, hittable rect for selection +
 *  drag/resize/delete. The actual dim + bright cut-out is drawn once for all
 *  spotlights by <SpotlightDimLayer> (see EditorStage). */
function SpotlightRegion({
  a, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);
  return (
    // Invisible (opacity 0) but fully hittable — Konva's hit canvas ignores opacity.
    <Rect
      id={a.id}
      x={x} y={y} width={w} height={h}
      fill="#ffffff" opacity={0}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
      // The Transformer resizes by scaling this hit-rect; the dim cut-out lives in a
      // separate layer that reads w/h from the store, so commit the scale back as new
      // w/h (and reset the node scale) or the resize would be visual-only and the dim
      // would never move.
      onTransformEnd={(e) => {
        const node = e.target;
        const nw = Math.max(1, node.width() * node.scaleX());
        const nh = Math.max(1, node.height() * node.scaleY());
        node.scaleX(1);
        node.scaleY(1);
        onChange({ x: node.x(), y: node.y(), w: nw, h: nh } as Partial<Annotation>);
      }}
    />
  );
}
