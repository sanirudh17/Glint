import type { StudioEvents } from "./studioModel";
import { clamp, type ZoomSegment } from "./studioEffects";
const distance = (a:{x:number;y:number},b:{x:number;y:number}) => Math.hypot(a.x-b.x,a.y-b.y);
/** Deterministic source-time click clusters; regeneration never edits manual work. */
export function regenerateZooms(existing:ZoomSegment[],events:StudioEvents,duration:number):ZoomSegment[] {
  const geometry=events.geometry;
  const point=(e:{x?:number;y?:number})=>({x:(e.x!-geometry.x)/geometry.width,y:(e.y!-geometry.y)/geometry.height});
  const clicks=events.events.filter(e=>e.kind==='click'&&Number.isFinite(e.x)&&Number.isFinite(e.y)&&e.t>=0&&e.t<duration)
    .map(e=>({...point(e),t:e.t})).filter(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1).sort((a,b)=>a.t-b.t);
  const clusters:typeof clicks[]=[];
  for(const click of clicks) {
    const group=clusters[clusters.length-1],last=group?.[group.length-1];
    if(!group||click.t-last.t>.9||distance(click,group[0])>.12||click.t-group[0].t>5) clusters.push([click]);
    else group.push(click);
  }
  const preserved=existing.filter(s=>s.origin!=='auto'||s.edited);
  const generated:ZoomSegment[]=[];
  for(const cluster of clusters.filter(c=>c.length>=2)) {
    if(generated.length>=Math.max(0,512-preserved.length))break;
    const first=cluster[0],last=cluster[cluster.length-1];
    const focus={x:cluster.reduce((n,c)=>n+c.x,0)/cluster.length,y:cluster.reduce((n,c)=>n+c.y,0)/cluster.length};
    const prior=generated[generated.length-1];
    const start=Math.max(0,first.t-.3,prior?prior.end+.8:0);
    let end=Math.min(duration,last.t+1.2,start+6);
    const escape=events.events.filter(e=>e.kind==='cursor'&&e.t>last.t&&e.t<end&&Number.isFinite(e.x)&&Number.isFinite(e.y))
      .sort((a,b)=>a.t-b.t).find(e=>distance(point(e),focus)>.3);
    if(escape)end=Math.min(end,escape.t+.35);
    if(end-start<.7||preserved.some(s=>start<s.end+.8&&end>s.start-.8))continue;
    generated.push({id:`auto-${first.t.toFixed(6)}`,start,end,scale:2,mode:'fixed',focus:{x:clamp(focus.x,0,1),y:clamp(focus.y,0,1)},ease:'gentle',easeIn:.4,easeOut:.4,origin:'auto',edited:false});
  }
  return [...preserved,...generated].sort((a,b)=>a.start-b.start);
}
