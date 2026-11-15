import type {Crop} from '../editor/composition';
export type CropPoint={x:number;y:number};
export type CropHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export type CropGesture='draw'|'move'|CropHandle;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
/** Source-pixel geometry shared by pointer and keyboard crop adjustments. */
export function adjustVideoCrop(mode:CropGesture,original:Crop,start:CropPoint,end:CropPoint,width:number,height:number):Crop{
 const min=Math.min(2,width,height),dx=end.x-start.x,dy=end.y-start.y;
 if(mode==='draw'){
  const x=clamp(start.x,0,width),y=clamp(start.y,0,height),right=clamp(end.x,0,width),bottom=clamp(end.y,0,height);
  return {x:Math.min(x,right),y:Math.min(y,bottom),w:Math.abs(x-right),h:Math.abs(y-bottom)};
 }
 if(mode==='move')return {...original,x:clamp(original.x+dx,0,width-original.w),y:clamp(original.y+dy,0,height-original.h)};
 let left=original.x,top=original.y,right=left+original.w,bottom=top+original.h;
 if(mode.includes('w'))left=clamp(left+dx,0,right-min);
 if(mode.includes('e'))right=clamp(right+dx,left+min,width);
 if(mode.includes('n'))top=clamp(top+dy,0,bottom-min);
 if(mode.includes('s'))bottom=clamp(bottom+dy,top+min,height);
 return {x:left,y:top,w:right-left,h:bottom-top};
}
