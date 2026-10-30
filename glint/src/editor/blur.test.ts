import {expect,it} from 'vitest';
import {blurPixels} from './blur';
it('softens edges without changing a flat background or introducing white',()=>{
  const flat=new Uint8ClampedArray(Array.from({length:32*12},()=>[15,20,25,255]).flat());
  expect(blurPixels(flat,32,12,12)).toEqual(flat);
  const edge=new Uint8ClampedArray(Array.from({length:32*12},(_,i)=>i%32<16?[0,0,0,255]:[180,100,60,255]).flat());
  const blurred=blurPixels(edge,32,12,8);
  expect(blurred[(6*32+15)*4]).toBeGreaterThan(0);
  expect(blurred[(6*32+16)*4]).toBeLessThan(180);
  expect(Math.max(...blurred.filter((_,i)=>i%4===0))).toBeLessThanOrEqual(180);
});
