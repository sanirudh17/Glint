import {describe,it,expect} from 'vitest';
import {arrowPoints,textPreset} from './annotationStyles';
import {DEFAULT_STYLE,duplicateAnnotation,nudgeAnnotation,type TwoPointAnno} from './model';
describe('annotation additions',()=>{
  const arrow:TwoPointAnno={id:'a',type:'arrow',z:0,style:DEFAULT_STYLE,x1:10,y1:10,x2:110,y2:10};
  it('keeps old arrows straight and bends either way without moving endpoints',()=>{expect(arrowPoints(arrow)).toEqual([10,10,110,10]);expect(arrowPoints({...arrow,style:{...DEFAULT_STYLE,curve:.5}})).toEqual([10,10,60,35,110,10]);expect(arrowPoints({...arrow,style:{...DEFAULT_STYLE,curve:-.5}})).toEqual([10,10,60,-15,110,10]);});
  it('preserves bend in copies and moves',()=>{const a={...arrow,style:{...DEFAULT_STYLE,curve:.4}};expect(duplicateAnnotation(a).style.curve).toBe(.4);expect(arrowPoints(nudgeAnnotation(a,5,5) as TwoPointAnno)).toEqual([15,15,65,35,115,15]);});
  it('text presets have useful defaults and optional serializable fields',()=>{expect(textPreset('heading')).toEqual({textPreset:'heading',fontSize:36});expect(JSON.parse(JSON.stringify(textPreset('code')))).toEqual({textPreset:'code',fontSize:20});});
});
