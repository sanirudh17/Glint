import {useEffect,useMemo,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {studioLayout} from './studioLayout';
import {followSourcePoint,smoothPath} from './studioCursor';
import {clamp,zoomAt} from './studioEffects';
import {maskAt,sourceRect,type SourceRect} from './studioMasks';
import type {StudioData} from './studioModel';
export function StudioMaskOverlay({studio,width,height,time,selected,drawing,video,onDraw,onRect,onPause}: {
  studio:StudioData;width:number;height:number;time:number;selected:string|null;drawing:boolean;video:RefObject<HTMLVideoElement|null>;
  onDraw:(rect:SourceRect)=>void;onRect:(rect:SourceRect)=>void;onPause:()=>void;
}) {
  const ref=useRef<HTMLDivElement>(null),[size,setSize]=useState({w:0,h:0}),[draft,setDraft]=useState<SourceRect|null>(null);
  const drag=useRef<{start:{x:number;y:number};rect:SourceRect|null;mode:string}|null>(null);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>setSize({w:el.clientWidth,h:el.clientHeight}));observer.observe(el);return()=>observer.disconnect();},[]);
  const {layout:l,scale:pixelScale,width:canvasW,height:canvasH}=studioLayout(width,height,studio.project.crop,studio.project.look,960);
  const fit=Math.min((size.w-40)/canvasW,(size.h-40)/canvasH),displayScale=fit*pixelScale;
  const baseX=20+(size.w-40-canvasW*fit)/2,baseY=20+(size.h-40-canvasH*fit)/2;
  const path=useMemo(()=>smoothPath(studio.events.events,studio.project.cursor.smoothing),[studio.events,studio.project.cursor.smoothing]);
  const view=zoomAt(studio.project.zoomSegments,time,{x:l.cropX,y:l.cropY,w:l.contentW,h:l.contentH},width,height,followSourcePoint(path,time,studio.events,width,height));
  const active=studio.project.masks.find(m=>m.id===selected&&m.start<=time&&time<=m.end);
  const rect=draft??(active?maskAt(active,time):null);
  const sourceAt=(clientX:number,clientY:number)=>{
    const bounds=ref.current!.getBoundingClientRect();
    return {x:view.x+((clientX-bounds.x-baseX)/displayScale-l.contentX)/l.contentW*view.w,y:view.y+((clientY-bounds.y-baseY)/displayScale-l.contentY)/l.contentH*view.h};
  };
  const position=rect?{left:baseX+(l.contentX+(rect.x-view.x)/view.w*l.contentW)*displayScale,top:baseY+(l.contentY+(rect.y-view.y)/view.h*l.contentH)*displayScale,width:rect.w/view.w*l.contentW*displayScale,height:rect.h/view.h*l.contentH*displayScale}:undefined;
  return <div ref={ref} className={`studio-mask-overlay${drawing?' is-drawing':''}`} data-editor-control
    onPointerDown={e=>{
      if(video.current?.seeking)return;
      if(!drawing&&!active)return;onPause();e.preventDefault();e.stopPropagation();
      const point=sourceAt(e.clientX,e.clientY);if(point.x<0||point.y<0||point.x>width||point.y>height)return;
      drag.current={start:point,rect:drawing?null:rect,mode:drawing?'draw':(e.target as HTMLElement).dataset.corner??'move'};
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e=>{
      const d=drag.current;if(!d)return;const p=sourceAt(e.clientX,e.clientY),dx=p.x-d.start.x,dy=p.y-d.start.y;
      let r:SourceRect;
      if(d.mode==='draw')r={x:Math.min(d.start.x,p.x),y:Math.min(d.start.y,p.y),w:Math.abs(dx),h:Math.abs(dy)};
      else {const original=d.rect!;r={...original};
        if(d.mode==='move'){r.x=clamp(r.x+dx,0,width-r.w);r.y=clamp(r.y+dy,0,height-r.h);}else {
          if(d.mode.includes('w')){r.x+=dx;r.w-=dx;}if(d.mode.includes('e'))r.w+=dx;
          if(d.mode.includes('n')){r.y+=dy;r.h-=dy;}if(d.mode.includes('s'))r.h+=dy;
        }
      }
      r=sourceRect(r,width,height);setDraft(r);if(d.mode!=='draw')onRect(r);
    }} onPointerUp={e=>{const d=drag.current;if(d?.mode==='draw'&&draft&&draft.w>=2&&draft.h>=2)onDraw(draft);drag.current=null;setDraft(null);e.currentTarget.releasePointerCapture(e.pointerId);}}
    onPointerCancel={()=>{const d=drag.current;if(d?.rect)onRect(d.rect);drag.current=null;setDraft(null);}}>
    {position&&<div className="studio-mask-selection" style={position}>{(['nw','ne','sw','se'] as const).map(corner=><button type="button" key={corner} className={`studio-mask-corner is-${corner}`} data-corner={corner} aria-label={`Resize mask ${corner}`} />)}</div>}
    {drawing&&<span className="studio-preview-instruction">Drag over the sensitive content</span>}
  </div>;
}
