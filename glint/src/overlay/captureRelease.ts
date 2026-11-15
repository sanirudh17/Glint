import {normalizeRect,type Rect} from './modes';
type Gesture={kind:'draw'|'move'|'resize';startX:number;startY:number}|null;
/** Commit only a finished left-button draw, using the release coordinates. */
export function selectionOnRelease(gesture:Gesture,point:{x:number;y:number},enabled:boolean,button:number):Rect|null{
 if(!enabled||button!==0||gesture?.kind!=='draw')return null;
 const rect=normalizeRect(gesture.startX,gesture.startY,point.x,point.y);
 return rect.w>1&&rect.h>1?rect:null;
}
