export type AnnotationTool = 'pen' | 'highlight' | 'arrow' | 'rectangle' | 'ellipse' | 'text';
export interface VideoAnnotation {
  id: string; kind: AnnotationTool; start: number; end: number;
  points: {x:number;y:number}[]; color: string; width: number; text: string; size: number;
  raster?: string;
}
export const ANNOTATION_TOOLS: AnnotationTool[] = ['pen','highlight','arrow','rectangle','ellipse','text'];
export function validateAnnotations(items: VideoAnnotation[], duration: number): boolean {
  return Array.isArray(items) && items.length <= 64 && new Set(items.map(a=>a.id)).size === items.length && items.every(a =>
    typeof a.id === 'string' && a.id.length <= 128 && ANNOTATION_TOOLS.includes(a.kind)
    && [a.start,a.end,a.width,a.size].every(Number.isFinite) && a.start >= 0 && a.end > a.start && a.end <= duration + .05
    && a.width >= .001 && a.width <= .04 && a.size >= .01 && a.size <= .2 && /^#[\da-f]{6}$/i.test(a.color)
    && typeof a.text === 'string' && a.text.length <= 500 && a.points.length >= 1 && a.points.length <= 4096
    && a.points.every(p=>[p.x,p.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1)));
}
export function annotationAt(a:VideoAnnotation,time:number) { return a.start <= time && time < a.end; }
export function moveAnnotation(a:VideoAnnotation,dx:number,dy:number):VideoAnnotation {
  dx=Math.max(-Math.min(...a.points.map(p=>p.x)),Math.min(dx,1-Math.max(...a.points.map(p=>p.x))));
  dy=Math.max(-Math.min(...a.points.map(p=>p.y)),Math.min(dy,1-Math.max(...a.points.map(p=>p.y))));
  return {...a,raster:undefined,points:a.points.map(p=>({x:p.x+dx,y:p.y+dy}))};
}
/** Composition-relative marks: the same painter supplies preview and export rasters. */
export function paintAnnotation(ctx:CanvasRenderingContext2D,a:VideoAnnotation,w:number,h:number) {
  const p=a.points.map(p=>({x:p.x*w,y:p.y*h})),first=p[0],last=p[p.length-1];if(!first)return;
  ctx.save();ctx.strokeStyle=a.color;ctx.fillStyle=a.color;ctx.lineWidth=a.width*Math.min(w,h);ctx.lineCap='round';ctx.lineJoin='round';
  if(a.kind==='text'){ctx.font=`500 ${a.size*h}px Manrope, "Segoe UI", sans-serif`;ctx.textBaseline='top';a.text.split('\n').forEach((line,i)=>ctx.fillText(line,first.x,first.y+i*a.size*h*1.3));}
  else {
    ctx.globalAlpha=a.kind==='highlight'?.35:1;ctx.beginPath();
    if(a.kind==='rectangle')ctx.rect(Math.min(first.x,last.x),Math.min(first.y,last.y),Math.abs(last.x-first.x),Math.abs(last.y-first.y));
    else if(a.kind==='ellipse')ctx.ellipse((first.x+last.x)/2,(first.y+last.y)/2,Math.abs(last.x-first.x)/2,Math.abs(last.y-first.y)/2,0,0,Math.PI*2);
    else {ctx.moveTo(first.x,first.y);for(const point of p.slice(1))ctx.lineTo(point.x,point.y);if(p.length===1)ctx.lineTo(first.x+.1,first.y);}
    ctx.stroke();
    if(a.kind==='arrow'){const angle=Math.atan2(last.y-first.y,last.x-first.x),length=Math.max(ctx.lineWidth*4,h*.025);ctx.beginPath();ctx.moveTo(last.x-Math.cos(angle-.5)*length,last.y-Math.sin(angle-.5)*length);ctx.lineTo(last.x,last.y);ctx.lineTo(last.x-Math.cos(angle+.5)*length,last.y-Math.sin(angle+.5)*length);ctx.stroke();}
  }ctx.restore();
}
export async function prepareAnnotations(items:VideoAnnotation[] = [], aspect = 16/9):Promise<VideoAnnotation[]> {
  await document.fonts.ready;
  return items.map(a=>{const c=document.createElement('canvas');c.width=Math.round(aspect>=1?1280:1280*aspect);c.height=Math.round(aspect>=1?1280/aspect:1280);paintAnnotation(c.getContext('2d')!,a,c.width,c.height);return {...a,raster:c.toDataURL('image/png')};});
}
