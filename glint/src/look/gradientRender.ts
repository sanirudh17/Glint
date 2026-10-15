import { getGradient, type GradientStop } from "../editor/gradients";
import type { LookBackground } from "./model";

export type GradientBackground = Extract<LookBackground, {type: "gradient"}>;
export const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const hex = (color: number[]): string => "#" + color.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
export function gradientStops(bg: GradientBackground): GradientStop[] { return bg.stops ?? getGradient(bg.gradientId).stops; }
export function threeStops(stops: GradientStop[], count: number): GradientStop[] {
  const first = stops[0], last = stops[stops.length - 1];
  return count === 2 ? [{...first, offset:0}, {...last, offset:1}] : [{...first, offset:0}, stops.length === 3 ? stops[1] : {offset:.5, color:hex(rgb(first.color).map((v,i)=>(v+rgb(last.color)[i])/2))}, {...last, offset:1}];
}
export function grainAt(x: number, y: number): number {
  let n = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) % 256 / 255 - .5;
}
/** One cached plate, shared by screenshot preview/export and Studio preview.
 * Pixel centers and deterministic grain match the native compositor. */
export function gradientPixels(bg: GradientBackground, w: number, h: number): Uint8ClampedArray {
  const preset = getGradient(bg.gradientId), angle = (bg.angleDeg ?? preset.angleDeg) * Math.PI / 180;
  const stops = gradientStops(bg).map(s=>({...s, rgb:rgb(s.color)}));
  const reverseStops=[...stops].reverse();
  const dx = Math.cos(angle), dy = Math.sin(angle), len = Math.abs(dx)*w+Math.abs(dy)*h;
  const data = new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const px=x-w/2, py=y-h/2;
    let t=bg.kind==='radial'?Math.hypot(px,py)/(Math.hypot(w,h)/2):bg.kind==='conic'?((Math.atan2(py,px)-angle)/(Math.PI*2)%1+1)%1:(px*dx+py*dy)/len+.5;
    t=Math.max(0,Math.min(1,t));
    const a=reverseStops.find(s=>s.offset<=t)??stops[0], b=stops.find(s=>s.offset>=t)??stops[stops.length-1];
    const f=b.offset>a.offset?(t-a.offset)/(b.offset-a.offset):0;
    let color=a.rgb.map((v,i)=>v+(b.rgb[i]-v)*f);
    if(bg.kind==='mesh') {
      color=[...stops[0].rgb];
      // Layer broad radial color fields, rotating their centers with the angle.
      for(let i=0;i<stops.length;i++) {
        const theta=angle+i*Math.PI*2/stops.length;
        const cx=.5+.38*Math.cos(theta),cy=.5+.38*Math.sin(theta);
        const weight=Math.max(0,1-Math.hypot(x/w-cx,y/h-cy)/.9)*.85;
        color=color.map((v,k)=>v+(stops[i].rgb[k]-v)*weight);
      }
    }
    const noise=grainAt(Math.floor(x/w*1024),Math.floor(y/h*1024))*(bg.grain??0)*80, offset=(y*w+x)*4;
    for(let k=0;k<3;k++)data[offset+k]=Math.round(Math.max(0,Math.min(255,color[k]+noise)));
    data[offset+3]=255;
  }
  return data;
}
export function gradientCanvas(bg: GradientBackground,w: number,h: number): HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=Math.round(w);canvas.height=Math.round(h);
  const ctx=canvas.getContext('2d')!;
  if(!bg.grain&&bg.kind!=='mesh') {
    // Canvas gradients need a single paint. The half-pixel offset preserves
    // integer-coordinate color sampling used by the native compositor.
    const angle=(bg.angleDeg??getGradient(bg.gradientId).angleDeg)*Math.PI/180;
    const x=canvas.width/2+.5,y=canvas.height/2+.5,dx=Math.cos(angle),dy=Math.sin(angle);
    const length=Math.abs(dx)*canvas.width+Math.abs(dy)*canvas.height;
    const gradient=bg.kind==='radial'?ctx.createRadialGradient(x,y,0,x,y,Math.hypot(canvas.width,canvas.height)/2)
      :bg.kind==='conic'?ctx.createConicGradient(angle,x,y)
      :ctx.createLinearGradient(x-dx*length/2,y-dy*length/2,x+dx*length/2,y+dy*length/2);
    for(const stop of gradientStops(bg))gradient.addColorStop(stop.offset,stop.color);
    ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
  } else ctx.putImageData(new ImageData(gradientPixels(bg,canvas.width,canvas.height),canvas.width,canvas.height),0,0);
  return canvas;
}
/** Quantized palette from a small RGBA sample; favors useful chromatic colors over page white. */
export function paletteFromPixels(data: Uint8ClampedArray): GradientStop[] {
  const buckets=new Map<string,{color:number[];count:number}>();
  for(let i=0;i<data.length;i+=4) {
    if(data[i+3]<128)continue;
    const c=[data[i],data[i+1],data[i+2]], key=c.map(v=>Math.round(v/32)).join(',');
    const bucket=buckets.get(key)??{color:c,count:0};bucket.count++;buckets.set(key,bucket);
  }
  const colors=[...buckets.values()].sort((a,b)=>b.count*(1+(Math.max(...b.color)-Math.min(...b.color))/32)-a.count*(1+(Math.max(...a.color)-Math.min(...a.color))/32)).slice(0,3).map(b=>hex(b.color));
  if(!colors.length) colors.push('#20242c');
  while(colors.length<3)colors.push(colors[colors.length-1]);
  return colors.map((color,i)=>({offset:i/2,color}));
}
