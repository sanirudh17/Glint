import { useRef } from "react";
import { clamp } from "./studioEffects";
export interface TimedEffect {id:string;start:number;end:number}
export function StudioEffectTrack({ label, segments, duration, zoom, viewStart, selected, disabled, onSelect, onRange, onDelete }: {
  label:string;segments:TimedEffect[];duration:number;zoom:number;viewStart:number;selected:string|null;disabled:boolean;
  onSelect:(id:string)=>void;onRange:(id:string,start:number,end:number)=>void;onDelete:(id:string)=>void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{segment:TimedEffect;edge:string;pointer:number;x:number;secondsPerPixel:number}|null>(null);
  const minimumSpan=Math.min(.1,duration/2);
  return <div className="studio-effect-track-row" data-editor-control>
    <span className="studio-effect-track-label">{label}</span>
    <div ref={track} className="studio-effect-track" aria-label={`${label} timeline`}>
      <div className="studio-effect-track-content" style={{width:`${zoom*100}%`,transform:`translateX(-${viewStart/Math.max(.001,duration)*100}%)`}}>
        {segments.map((s,i)=><div key={s.id} className={`studio-effect-segment${selected===s.id?' is-selected':''}`} role="group" aria-label={`${label} ${i+1}`}
          style={{left:`${s.start/duration*100}%`,width:`${(s.end-s.start)/duration*100}%`}}
          onPointerDown={e=>{
            if(disabled)return;e.preventDefault();onSelect(s.id);
            drag.current={segment:{...s},edge:(e.target as HTMLElement).dataset.edge??"move",pointer:e.pointerId,x:e.clientX,secondsPerPixel:duration/zoom/(track.current?.clientWidth??1)};
            e.currentTarget.setPointerCapture(e.pointerId);
          }} onPointerMove={e=>{
            const d=drag.current;if(!d||d.pointer!==e.pointerId)return;
            const delta=(e.clientX-d.x)*d.secondsPerPixel,span=d.segment.end-d.segment.start;
            const start=d.edge==="end"?d.segment.start:clamp(d.segment.start+delta,0,d.edge==="start"?d.segment.end-minimumSpan:duration-span);
            const end=d.edge==="start"?d.segment.end:d.edge==="end"?clamp(d.segment.end+delta,start+minimumSpan,duration):start+span;
            onRange(s.id,start,end);
          }} onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}
          onPointerCancel={()=>{const d=drag.current;if(d)onRange(s.id,d.segment.start,d.segment.end);drag.current=null;}}>
          <button type="button" className="studio-effect-handle" data-edge="start" disabled={disabled} aria-label={`Resize ${label.toLowerCase()} start`} />
          <button type="button" className="studio-effect-name" disabled={disabled} onClick={()=>onSelect(s.id)}
            title={`${s.start.toFixed(2)} – ${s.end.toFixed(2)} s`} onKeyDown={e=>{
              if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();onDelete(s.id);}
              if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();const span=s.end-s.start;const start=clamp(s.start+(e.key==="ArrowRight"?1:-1)*(e.shiftKey?1:.1),0,duration-span);onRange(s.id,start,start+span);}
            }}>{i+1}</button>
          <button type="button" className="studio-effect-handle" data-edge="end" disabled={disabled} aria-label={`Resize ${label.toLowerCase()} end`} />
        </div>)}
      </div>
    </div>
  </div>;
}
