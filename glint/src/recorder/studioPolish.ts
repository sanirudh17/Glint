import type {Clip} from './trimModel';
import {reserveClipIds} from './trimModel';
import type {InputEvent} from './studioModel';
export type Entrance='none'|'fade'|'left'|'right'|'up'|'down'|'zoom-in'|'zoom-out';
export const ENTRANCES:{value:Entrance;label:string}[]=[{value:'none',label:'None'},{value:'fade',label:'Fade in'},{value:'left',label:'From left'},{value:'right',label:'From right'},{value:'up',label:'From below'},{value:'down',label:'From above'},{value:'zoom-in',label:'Zoom in'},{value:'zoom-out',label:'Zoom out'}];
export function entrancePose(style:Entrance|undefined,time:number,duration=.6){
 const x=Math.min(1,Math.max(0,time/duration)),p=x*x*(3-2*x),r=1-p;
 if(p===1)return {opacity:1,x:0,y:0,scale:1};
 return {opacity:!style||style==='none'?1:p,x:style==='left'?-r:style==='right'?r:0,y:style==='up'?r:style==='down'?-r:0,scale:style==='zoom-in'?.8+.2*p:style==='zoom-out'?1.2-.2*p:1};
}
export type AudioCleanup={denoise:boolean;level:boolean;clickSounds:boolean};
export interface Caption {id:string;start:number;end:number;text:string;raster?:string}
/** Source-anchored operations retain source timestamps, removed spans, speeds and
 * reordered clips. Audio is retimed by the same existing export segments. */
export function editSpans(clips:Clip[],spans:{start:number;end:number}[],operation:'remove'|'speed'):Clip[]{
 if(!spans.length)return clips;
 reserveClipIds(clips);let id=Math.max(0,...clips.map(c=>c.id))+1;const ranks=new Map([...clips].sort((a,b)=>a.order-b.order).map((c,i)=>[c.id,i]));
 return clips.flatMap(c=>{
  if(!c.kept)return [{...c,order:ranks.get(c.id)!}];
  const cuts=[c.start,c.end,...spans.flatMap(s=>[Math.max(c.start,s.start),Math.min(c.end,s.end)])].filter(t=>t>=c.start&&t<=c.end);
  const edges=[...new Set(cuts)].sort((a,b)=>a-b);
  return edges.slice(0,-1).flatMap((start,i)=>{const end=edges[i+1];if(end-start<1e-7)return [];const inside=spans.some(s=>(start+end)/2>=s.start&&(start+end)/2<s.end);return [{...c,id:id++,start,end,order:ranks.get(c.id)!+i/(edges.length+1),kept:!(inside&&operation==='remove'),speed:inside&&operation==='speed'?2:c.speed}];});
 });
}
export function activitySpans(events:InputEvent[],duration:number,kind:'idle'|'typing'){
 let point:{x:number;y:number}|null=null;
 const activity=events.filter(e=>Number.isFinite(e.t)&&e.t>=0&&e.t<=duration&&(e.kind==='key'||e.kind==='click'||e.kind==='cursor')).sort((a,b)=>a.t-b.t).filter(e=>{if(e.kind!=='cursor')return true;if(e.x===undefined||e.y===undefined)return false;const moved=!point||Math.hypot(e.x-point.x,e.y-point.y)>=2;if(moved)point={x:e.x,y:e.y};return moved;});
 if(kind==='idle'){
  if(!activity.length)return [];
  const times=[0,...activity.map(e=>e.t),duration],out:{start:number;end:number}[]=[];
  for(let i=1;i<times.length;i++)if(times[i]-times[i-1]>3)out.push({start:times[i-1]+.75,end:times[i]-.75});
  return out;
 }
 const keys=activity.filter(e=>e.kind==='key'&&e.down!==false&&!e.isModifier),out:{start:number;end:number}[]=[];
 let start=0;for(let i=0;i<keys.length;i++)if(i===keys.length-1||keys[i+1].t-keys[i].t>1.2){if(i-start>=4&&keys[i].t-keys[start].t>=1)out.push({start:Math.max(0,keys[start].t-.15),end:Math.min(duration,keys[i].t+.35)});start=i+1;}
 return out;
}
export function estimateExportBytes(seconds:number,width:number,height:number){const bitsPerSecond=width*height*30*.09+192000;return {low:Math.ceil(seconds*bitsPerSecond/8*.6),high:Math.ceil(seconds*bitsPerSecond/8*1.6)};}
export function captionRaster(text:string){
 const c=document.createElement('canvas');c.width=1280;c.height=170;const ctx=c.getContext('2d')!;
 const words=text.trim().split(/\s+/);let lines:string[]=[];
 for(let size=40;size>=14;size-=2){ctx.font=`600 ${size}px Manrope, sans-serif`;lines=[];let line='';for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>1140&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);if(lines.length<=2)break;}
 ctx.fillStyle='rgba(0,0,0,.8)';ctx.beginPath();ctx.roundRect(32,12,1216,140,16);ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';lines.forEach((l,i)=>ctx.fillText(l,640,lines.length===1?82:56+i*52,1140));return c.toDataURL('image/png');
}
export async function prepareCaptions<T extends {captions?:Caption[]}>(project:T):Promise<T>{if(project.captions?.some(c=>!c.text.trim()))throw Error('Review empty caption lines before exporting.');await document.fonts.ready;return {...project,captions:project.captions?.map(c=>({...c,raster:captionRaster(c.text)}))};}
