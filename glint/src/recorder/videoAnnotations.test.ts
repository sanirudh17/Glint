import {expect,it} from 'vitest';
import {annotationAt,annotationBounds,moveAnnotation,pickAnnotation,resizeAnnotationText,validateAnnotations,type VideoAnnotation} from './videoAnnotations';
const mark:VideoAnnotation={id:'one',kind:'arrow',start:1,end:3,points:[{x:.1,y:.2},{x:.8,y:.6}],color:'#ff6655',width:.006,size:.04,text:''};
it('shows marks only during their source-time span, including after reordered playback',()=>{expect(annotationAt(mark,.9)).toBe(false);expect(annotationAt(mark,1)).toBe(true);expect(annotationAt(mark,2.99)).toBe(true);expect(annotationAt(mark,3)).toBe(false);});
it('picks visible marks directly, preferring the topmost overlapping mark',()=>{
  const upper={...mark,id:'upper'};
  expect(pickAnnotation([mark,upper],2,{x:.4,y:.4},1000,600)?.id).toBe('upper');
  expect(pickAnnotation([mark],3,{x:.4,y:.4},1000,600)).toBeUndefined();
  expect(pickAnnotation([mark],2,{x:.95,y:.9},1000,600)).toBeUndefined();
  expect(pickAnnotation([mark],2,{x:.095,y:.2},1000,600)?.id).toBe(mark.id);
  const moved=moveAnnotation(pickAnnotation([mark],2,{x:.4,y:.4},1000,600)!, .05,.1);
  expect(moved.points[0].x).toBeCloseTo(.15);expect(moved.points[0].y).toBeCloseTo(.3);
});
it('picks text across its measured multiline extent',()=>{
  const text={...mark,kind:'text' as const,points:[{x:.1,y:.2}],text:'Hello\nworld'};
  expect(pickAnnotation([text],2,{x:.28,y:.27},1000,600,()=>200)?.id).toBe(text.id);
  expect(pickAnnotation([text],2,{x:.4,y:.27},1000,600,()=>200)).toBeUndefined();
});
it('resizes text from its corner without moving its anchor, with safe size limits',()=>{
  const text={...mark,kind:'text' as const,points:[{x:.1,y:.2}],size:.05,text:'Hello'};
  const large=resizeAnnotationText(text,{x:.3,y:.3},{x:.5,y:.4},16/9);
  expect(large.size).toBeCloseTo(.1);expect(large.points).toEqual(text.points);
  expect(resizeAnnotationText(text,{x:.3,y:.3},{x:1,y:1},16/9).size).toBeLessThanOrEqual(.2);
  expect(resizeAnnotationText(text,{x:.3,y:.3},{x:0,y:0},16/9).size).toBe(.01);
  expect(annotationBounds(text,1000,600,()=>200)).toEqual({left:100,right:300,top:120,bottom:150});
});
it('moves the whole mark without distorting or losing it outside the frame',()=>{const moved=moveAnnotation(mark,2,-2);expect(moved.points[0].x).toBeCloseTo(.3);expect(moved.points[1].x).toBe(1);expect(moved.points[1].y).toBeCloseTo(.4);expect(mark.points[0]).toEqual({x:.1,y:.2});});
it('rejects malformed, excessive, out-of-range and future annotations',()=>{expect(validateAnnotations([mark],4)).toBe(true);for(const patch of [{end:8},{width:NaN},{points:[{x:2,y:0}]},{color:'red'},{kind:'unknown'},{text:'x'.repeat(501)}])expect(validateAnnotations([{...mark,...patch} as VideoAnnotation],4)).toBe(false);expect(validateAnnotations([mark,mark],4)).toBe(false);});
