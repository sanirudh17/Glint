import type { StudioEvents } from "./studioModel";
import { clamp,type ZoomSegment } from "./studioEffects";
export function importZoomMarkers(segments:ZoomSegment[],imported:string[],events:StudioEvents,duration:number) {
  const known=new Set(imported),result=[...segments];
  events.events.filter(e=>e.kind==='marker'&&e.t>=0&&e.t<duration).forEach((e,index)=>{
    const id=`marker-${e.t.toFixed(6)}-${index}`;if(known.has(id))return;known.add(id);
    if(result.some(s=>s.id===id)||result.length>=512)return;
    const g=events.geometry,start=Math.max(0,e.t-.3),end=Math.min(duration,e.t+1.7);
    if(end-start<.1)return;
    result.push({id,start,end,scale:2,mode:events.events.some(e=>e.kind==='cursor'&&Number.isFinite(e.x)&&Number.isFinite(e.y))?'follow-cursor':'fixed',focus:{x:clamp(((e.x??g.x+g.width/2)-g.x)/g.width,0,1),y:clamp(((e.y??g.y+g.height/2)-g.y)/g.height,0,1)},ease:'gentle',easeIn:.4,easeOut:.4,origin:'marker',edited:false});
  });
  return {zoomSegments:result,importedMarkers:Array.from(known)};
}
