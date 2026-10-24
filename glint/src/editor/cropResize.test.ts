import {expect,it} from 'vitest';
import {constrainCrop} from './cropResize';
it('keeps the ratio and opposite anchor at all corner and edge limits',()=>{
  const previous={x:100,y:100,w:400,h:225};
  for(const handle of ['nw','n','ne','e','se','s','sw','w']){
    const r=constrainCrop({x:0,y:0,w:2000,h:2000},previous,handle,16/9,800,600,16);
    expect(r.w/r.h).toBeCloseTo(16/9);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x+r.w).toBeLessThanOrEqual(800);expect(r.y+r.h).toBeLessThanOrEqual(600);
    if(handle.includes('w'))expect(r.x+r.w).toBeCloseTo(500);
    if(handle.includes('n'))expect(r.y+r.h).toBeCloseTo(325);
  }
});
it('allows a constrained corner to resize from vertical motion alone',()=>{
  const previous={x:100,y:100,w:400,h:225};
  const r=constrainCrop({...previous,h:300},previous,'se',16/9,800,600,16);
  expect(r.h).toBeCloseTo(300);expect(r.w).toBeCloseTo(300*16/9);
});
