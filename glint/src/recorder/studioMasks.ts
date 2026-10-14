import { clamp,effectId } from "./studioEffects";
export interface SourceRect {x:number;y:number;w:number;h:number}
export interface MaskKeyframe extends SourceRect {t:number}
export interface MaskSegment {
  id:string;start:number;end:number;type:'blur'|'pixelate'|'solid'|'highlight';
  keyframes:MaskKeyframe[];strength:number;color:string;
  opacity?:number;blurOutside?:boolean;
}
export function sourceRect(rect:SourceRect,width:number,height:number):SourceRect {
  const x=clamp(rect.x,0,Math.max(0,width-2)),y=clamp(rect.y,0,Math.max(0,height-2));
  return {x,y,w:clamp(rect.w,2,width-x),h:clamp(rect.h,2,height-y)};
}
export function maskAt(mask:MaskSegment,time:number):SourceRect {
  const points=[...mask.keyframes].sort((a,b)=>a.t-b.t);
  const right=points.findIndex(p=>p.t>time),a=points[right<0?points.length-1:Math.max(0,right-1)],b=points[right<0?points.length-1:right];
  const f=b.t>a.t?clamp((time-a.t)/(b.t-a.t),0,1):0;
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,w:a.w+(b.w-a.w)*f,h:a.h+(b.h-a.h)*f};
}
export function newMask(rect:SourceRect,time:number,duration:number):MaskSegment {
  return {id:effectId(),start:0,end:duration,type:'blur',keyframes:[{...rect,t:clamp(time,0,duration)}],strength:28,color:'#161a20'};
}
export function setMaskKeyframe(mask:MaskSegment,rect:SourceRect,time:number):MaskSegment {
  const t=Math.round(time*1000)/1000;
  return {...mask,keyframes:[...mask.keyframes.filter(p=>Math.abs(p.t-t)>.001),{...rect,t}].sort((a,b)=>a.t-b.t)};
}
export function splitMask(mask:MaskSegment,time:number):MaskSegment[] {
  if(time<=mask.start+.01||time>=mask.end-.01)return [mask];
  return [{...mask,end:time},{...mask,id:effectId(),start:time,keyframes:mask.keyframes.map(p=>({...p}))}];
}
export function copyMaskAt(mask:MaskSegment,time:number,duration:number):MaskSegment {
  const start=clamp(time,0,Math.max(0,duration-.01)),shift=start-mask.start;
  const points=new Map<number,MaskKeyframe>();
  mask.keyframes.forEach(p=>{const t=clamp(p.t+shift,0,duration);points.set(t,{...p,t});});
  return {...mask,id:effectId(),start,end:Math.min(duration,start+mask.end-mask.start),keyframes:Array.from(points.values()).sort((a,b)=>a.t-b.t)};
}
export function validateMasks(masks:MaskSegment[],duration:number,width=Infinity,height=Infinity):boolean {
  return masks.length<=512&&new Set(masks.map(m=>m.id)).size===masks.length&&masks.every(m=>
    typeof m.id==='string'&&[m.start,m.end,m.strength].every(Number.isFinite)&&m.start>=0&&m.end>m.start&&m.end<=duration+.05
    &&['blur','pixelate','solid','highlight'].includes(m.type)&&m.strength>=8&&m.strength<=80&&/^#[0-9a-f]{6}$/i.test(m.color)
    &&(m.opacity===undefined||Number.isFinite(m.opacity)&&m.opacity>=0&&m.opacity<=1)
    &&(m.blurOutside===undefined||typeof m.blurOutside==='boolean')
    &&Array.isArray(m.keyframes)&&m.keyframes.length>0&&m.keyframes.length<=512&&new Set(m.keyframes.map(p=>p.t)).size===m.keyframes.length
    &&m.keyframes.every(p=>[p.t,p.x,p.y,p.w,p.h].every(Number.isFinite)&&p.t>=0&&p.t<=duration+.05&&p.x>=0&&p.y>=0&&p.w>=2&&p.h>=2&&p.x+p.w<=width+.01&&p.y+p.h<=height+.01));
}
/** Masks mutate an offscreen source canvas before the source is cropped or zoomed. */
export function applyPreviewMasks(ctx:CanvasRenderingContext2D,masks:MaskSegment[],time:number,width:number,height:number,scratch:HTMLCanvasElement) {
  const active=masks.filter(m=>m.start<=time&&time<m.end);
  for(const mask of active.filter(m=>m.type!=='highlight')) {
    const r=sourceRect(maskAt(mask,time),width,height),x=Math.floor(r.x),y=Math.floor(r.y),w=Math.min(width-x,Math.ceil(r.w)),h=Math.min(height-y,Math.ceil(r.h));
    const temp=scratch.getContext('2d')!;
    if(mask.type==='solid') {ctx.fillStyle=mask.color;ctx.fillRect(x,y,w,h);continue;}
    const pad=mask.type==='blur'?Math.ceil(mask.strength*2):0;
    scratch.width=mask.type==='pixelate'?Math.max(1,Math.ceil(w/mask.strength)):w+2*pad;
    scratch.height=mask.type==='pixelate'?Math.max(1,Math.ceil(h/mask.strength)):h+2*pad;
    temp.drawImage(ctx.canvas,x,y,w,h,pad,pad,scratch.width-2*pad,scratch.height-2*pad);
    if(pad) {
      temp.drawImage(ctx.canvas,x,y,1,h,0,pad,pad,h);temp.drawImage(ctx.canvas,x+w-1,y,1,h,pad+w,pad,pad,h);
      temp.drawImage(ctx.canvas,x,y,w,1,pad,0,w,pad);temp.drawImage(ctx.canvas,x,y+h-1,w,1,pad,pad+h,w,pad);
      for(const [cx,cy] of [[0,0],[1,0],[0,1],[1,1]])temp.drawImage(ctx.canvas,x+(cx?w-1:0),y+(cy?h-1:0),1,1,cx?pad+w:0,cy?pad+h:0,pad,pad);
    }
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    if(mask.type!=='blur')ctx.imageSmoothingEnabled=false;
    if(mask.type==='blur') {ctx.fillStyle=mask.color;ctx.fillRect(x,y,w,h);ctx.filter=`blur(${mask.strength/2}px)`;ctx.drawImage(scratch,x-pad,y-pad);}
    else ctx.drawImage(scratch,0,0,scratch.width,scratch.height,x,y,w,h);
    ctx.restore();
  }
  for(const mask of active.filter(m=>m.type==='highlight')) {
    const r=sourceRect(maskAt(mask,time),width,height);
    if(mask.blurOutside) {scratch.width=width;scratch.height=height;scratch.getContext('2d')!.drawImage(ctx.canvas,0,0);}
    ctx.save();ctx.beginPath();ctx.rect(0,0,width,height);ctx.rect(r.x,r.y,r.w,r.h);ctx.clip('evenodd');
    if(mask.blurOutside) {ctx.filter=`blur(${mask.strength/2}px)`;ctx.drawImage(scratch,0,0);ctx.filter='none';}
    ctx.fillStyle=`rgba(0,0,0,${mask.opacity??.55})`;ctx.fillRect(0,0,width,height);ctx.restore();
  }
}
