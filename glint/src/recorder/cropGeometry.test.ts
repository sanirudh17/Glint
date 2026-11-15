import {expect,it} from 'vitest';
import {adjustVideoCrop,type CropHandle} from './cropGeometry';
const box={x:20,y:10,w:60,h:40};
it('draws the entire source from either absolute corner, including outside release',()=>{
 expect(adjustVideoCrop('draw',box,{x:0,y:0},{x:120,y:80},100,60)).toEqual({x:0,y:0,w:100,h:60});
 expect(adjustVideoCrop('draw',box,{x:100,y:60},{x:-20,y:-30},100,60)).toEqual({x:0,y:0,w:100,h:60});
});
it('moves a selection to each edge without changing its dimensions',()=>{
 expect(adjustVideoCrop('move',box,{x:30,y:20},{x:-100,y:-100},100,60)).toEqual({...box,x:0,y:0});
 expect(adjustVideoCrop('move',box,{x:30,y:20},{x:400,y:400},100,60)).toEqual({...box,x:40,y:20});
});
it('resizes from opposite corners without moving their anchored corner',()=>{
 expect(adjustVideoCrop('nw',box,{x:20,y:10},{x:0,y:0},100,60)).toEqual({x:0,y:0,w:80,h:50});
 expect(adjustVideoCrop('se',box,{x:80,y:50},{x:100,y:60},100,60)).toEqual({x:20,y:10,w:80,h:50});
});
it('keeps all eight resize handles inside the source with nonzero dimensions',()=>{
 for(const handle of ['nw','n','ne','e','se','s','sw','w'] as CropHandle[]){
  for(const distance of [-1000,1000]){
   const rect=adjustVideoCrop(handle,box,{x:0,y:0},{x:distance,y:distance},100,60);
   expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);
   expect(rect.w).toBeGreaterThanOrEqual(2);expect(rect.h).toBeGreaterThanOrEqual(2);
   expect(rect.x+rect.w).toBeLessThanOrEqual(100);expect(rect.y+rect.h).toBeLessThanOrEqual(60);
  }
 }
});
