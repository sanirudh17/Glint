import type {Crop} from './composition';
/** Keep a chosen ratio anchored at the opposite corner and inside the image. */
export function constrainCrop(rect:Crop,previous:Crop,handle:string,ratio:number,imageW:number,imageH:number,min:number):Crop {
  const west=handle.includes('w'),north=handle.includes('n');
  const ax=west?previous.x+previous.w:previous.x,ay=north?previous.y+previous.h:previous.y;
  const availableW=west?ax:imageW-ax,availableH=north?ay:imageH-ay;
  const heightDriven=handle==='n'||handle==='s'||(handle.length===2&&Math.abs(rect.h-previous.h)*ratio>Math.abs(rect.w-previous.w));
  const requested=heightDriven?rect.h*ratio:rect.w;
  const max=Math.min(availableW,availableH*ratio),w=Math.min(max,Math.max(Math.min(max,Math.max(min,min*ratio)),requested)),h=w/ratio;
  return{x:west?ax-w:ax,y:north?ay-h:ay,w,h};
}
