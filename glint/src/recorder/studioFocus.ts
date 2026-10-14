import type {Layout} from '../editor/composition';
import {clamp,type ZoomSegment} from './studioEffects';
export interface FocusPoint {x:number;y:number}
export function zoomFocus(segment:ZoomSegment,cursor:FocusPoint|null,width:number,height:number):FocusPoint {
  return segment.mode==='follow-cursor'&&cursor
    ? {x:clamp(cursor.x/width+(segment.followOffset?.x??0),0,1),y:clamp(cursor.y/height+(segment.followOffset?.y??0),0,1)}
    : segment.focus;
}
export function setZoomFocus(segment:ZoomSegment,point:FocusPoint,cursor:FocusPoint|null,width:number,height:number):ZoomSegment {
  const focus={x:clamp(point.x,0,1),y:clamp(point.y,0,1)};
  return {...segment,focus,edited:true,...(segment.mode==='follow-cursor'&&cursor?{followOffset:{x:clamp(focus.x-cursor.x/width,-1,1),y:clamp(focus.y-cursor.y/height,-1,1)}}:{})};
}
/** Convert the visible video point through letterboxing, frame padding, crop and zoom. */
export function previewFocus(client:FocusPoint,rect:{x:number;y:number;width:number;height:number},canvas:{width:number;height:number},layout:Layout,scale:number,view:{x:number;y:number;w:number;h:number},source:{width:number;height:number}):FocusPoint|null {
  const fit=Math.min((rect.width-40)/canvas.width,(rect.height-40)/canvas.height);
  if(fit<=0)return null;
  const originX=rect.x+20+(rect.width-40-canvas.width*fit)/2,originY=rect.y+20+(rect.height-40-canvas.height*fit)/2;
  const px=(client.x-originX)/fit/scale-layout.contentX,py=(client.y-originY)/fit/scale-layout.contentY;
  if(px<0||py<0||px>layout.contentW||py>layout.contentH)return null;
  return {x:clamp((view.x+px/layout.contentW*view.w)/source.width,0,1),y:clamp((view.y+py/layout.contentH*view.h)/source.height,0,1)};
}
