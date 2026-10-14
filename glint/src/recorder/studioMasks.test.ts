import {expect,it} from 'vitest';
import {copyMaskAt,maskAt,newMask,setMaskKeyframe,sourceRect,splitMask,validateMasks} from './studioMasks';
it('keeps geometry in source coordinates and interpolates keyframed rectangles',()=>{
  const first=newMask({x:100,y:50,w:200,h:80},0,10);
  const mask=setMaskKeyframe(first,{x:300,y:150,w:400,h:160},4);
  expect(maskAt(mask,2)).toEqual({x:200,y:100,w:300,h:120});
  expect(maskAt(mask,9)).toEqual({x:300,y:150,w:400,h:160});
  expect(validateMasks([mask],10,1920,1080)).toBe(true);
});
it('split preserves geometry through both halves, and copied times remain valid',()=>{
  const mask=setMaskKeyframe(newMask({x:100,y:50,w:200,h:80},0,10),{x:300,y:150,w:400,h:160},4);
  const split=splitMask(mask,2);
  expect(maskAt(split[0],1)).toEqual(maskAt(mask,1));expect(maskAt(split[1],3)).toEqual(maskAt(mask,3));
  const copy=copyMaskAt(mask,8,10);expect(copy.start).toBe(8);expect(copy.end).toBe(10);
  expect(validateMasks([copy],10,1920,1080)).toBe(true);
});
it('rejects masks outside the source and clamps UI edits to the actual source size',()=>{
  const mask=newMask({x:1900,y:0,w:200,h:80},0,10);
  expect(validateMasks([mask],10,1920,1080)).toBe(false);
  expect(sourceRect({x:0,y:0,w:2000,h:1080},1920,1080)).toEqual({x:0,y:0,w:1920,h:1080});
});
