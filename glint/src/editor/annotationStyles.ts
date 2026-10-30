import type {Style,TwoPointAnno} from './model';
/** A small magnetic zone makes the straight position easy to hit with a pointer. */
export function snapArrowBend(value:number):number {return Math.abs(value)<=6?0:Math.max(-100,Math.min(100,value))/100;}
export function arrowPoints(a:TwoPointAnno):number[]{
  const curve=a.style.curve??0;
  return curve===0?[a.x1,a.y1,a.x2,a.y2]:[a.x1,a.y1,(a.x1+a.x2)/2-(a.y2-a.y1)*curve/2,(a.y1+a.y2)/2+(a.x2-a.x1)*curve/2,a.x2,a.y2];
}
export function textPreset(preset:NonNullable<Style['textPreset']>):Partial<Style>{
  return {textPreset:preset,fontSize:({plain:24,heading:36,label:18,code:20})[preset]};
}
