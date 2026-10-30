import {describe,it,expect} from 'vitest';
import {snapArrowBend,arrowPoints} from './annotationStyles';
import {DEFAULT_STYLE,type TwoPointAnno} from './model';
describe('arrow bend center',()=>{
  it('snaps near-center pointer values to an exactly straight path',()=>{
    for(const value of [-6,-1,0,1,6]){
      const a:TwoPointAnno={id:'a',type:'arrow',z:0,x1:10,y1:20,x2:90,y2:70,style:{...DEFAULT_STYLE,curve:snapArrowBend(value)}};
      expect(arrowPoints(a)).toEqual([10,20,90,70]);
    }
    expect(snapArrowBend(-7)).toBe(-.07);expect(snapArrowBend(50)).toBe(.5);
  });
});
