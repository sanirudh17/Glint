import {expect,it} from 'vitest';
import {newZoom,zoomAt,validateZooms} from './studioEffects';
import {previewFocus,setZoomFocus,zoomFocus} from './studioFocus';
import {computeLayout} from '../editor/composition';
import {DEFAULT_LOOK} from '../look/model';
it('maps a preview point through zoom and letterboxing into source coordinates',()=>{
  const layout=computeLayout(640,360,null,{...DEFAULT_LOOK,enabled:false});
  const point=previewFocus({x:280,y:160},{x:100,y:50,width:680,height:400},{width:640,height:360},layout,1,{x:200,y:100,w:320,h:180},{width:640,height:360});
  expect(point?.x).toBeCloseTo(280/640);expect(point?.y).toBeCloseTo(145/360);
  expect(previewFocus({x:101,y:51},{x:100,y:50,width:680,height:400},{width:640,height:360},layout,1,{x:0,y:0,w:640,h:360},{width:640,height:360})).toBeNull();
});
it('keeps a clicked fixed point locked when the recorded cursor moves',()=>{
  const segment=setZoomFocus(newZoom(0,12),{x:.7,y:.3},{x:160,y:90},640,360);
  expect(zoomFocus(segment,{x:500,y:300},640,360)).toEqual({x:.7,y:.3});
  expect(segment.followOffset).toBeUndefined();
});
it('frames the follower relative to a clicked point and keeps tracking',()=>{
  const segment=setZoomFocus({...newZoom(0,12),mode:'follow-cursor'},{x:.6,y:.5},{x:320,y:180},640,360);
  expect(segment.followOffset?.x).toBeCloseTo(.1);expect(segment.followOffset?.y).toBe(0);
  expect(zoomFocus(segment,{x:384,y:216},640,360)).toEqual({x:.7,y:.6});
  const view=zoomAt([segment],1,{x:0,y:0,w:640,h:360},640,360,{x:320,y:180,latestX:320,latestY:180});
  expect(view.x).toBeCloseTo(224);expect(view.y).toBe(90);
});
it('keeps old follow projects centered and rejects invalid framing offsets',()=>{
  const segment={...newZoom(0,12),mode:'follow-cursor' as const};
  expect(zoomFocus(segment,{x:320,y:180},640,360)).toEqual({x:.5,y:.5});
  expect(validateZooms([{...segment,followOffset:{x:NaN,y:0}}],12)).toBe(false);
});
