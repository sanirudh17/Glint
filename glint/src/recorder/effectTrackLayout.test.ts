import {expect,it} from 'vitest';
import {effectTrackLanes} from './effectTrackLayout';
it('separates simultaneous marks instead of painting their numbers on top of each other',()=>{
  const marks=Array.from({length:6},(_,i)=>({id:String(i),start:0,end:3}));
  const result=effectTrackLanes(marks);
  expect(result.count).toBe(6);expect(new Set(result.lanes.values()).size).toBe(6);
  expect(marks.map(m=>m.id)).toEqual(['0','1','2','3','4','5']);
});
it('reuses lanes for adjacent spans and handles out-of-order input',()=>{
  const result=effectTrackLanes([{id:'late',start:3,end:4},{id:'early',start:0,end:1},{id:'overlap',start:.5,end:2},{id:'next',start:1,end:3}]);
  expect(result.count).toBe(2);expect(result.lanes.get('early')).toBe(result.lanes.get('next'));
  expect(result.lanes.get('early')).not.toBe(result.lanes.get('overlap'));
  expect(effectTrackLanes([]).count).toBe(1);
});
