import {expect,it} from 'vitest';
import {DEFAULT_MOTION,motionTimes} from './studioMotion';
it('defaults off and skips stationary or zero-strength transforms',()=>{
  expect(motionTimes(DEFAULT_MOTION,1,100)).toEqual([1]);
  expect(motionTimes({enabled:true,intensity:.5},1,0)).toEqual([1]);
  expect(motionTimes({enabled:true,intensity:0},1,100)).toEqual([1]);
});
it('bounds shutter samples to the available source time',()=>{
  expect(motionTimes({enabled:true,intensity:1},.001,100)).toEqual([.001,0,0]);
  expect(motionTimes({enabled:true,intensity:1},1,100)[2]).toBeCloseTo(1-1/60);
});
