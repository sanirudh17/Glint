import {describe,it,expect} from 'vitest';
import {autoBalance,OUTPUT_SIZES,watermarkPlacement} from './sizing';
import {computeLayout} from '../editor/composition';
import {DEFAULT_LOOK} from './model';
describe('screenshot sizing',()=>{
  it('balances all four card margins and removes fixed aspect constraints',()=>{const l=computeLayout(800,400,null,{...DEFAULT_LOOK,...autoBalance(800,400)});expect(l.contentX).toBe(40);expect(l.contentY).toBe(40);expect(l.compositionW-l.contentX-l.contentW).toBe(40);expect(l.compositionH-l.contentY-l.contentH).toBe(40);});
  it('uses exact target aspect without clipping the screenshot',()=>{for(const size of OUTPUT_SIZES){const l=computeLayout(800,600,null,{...DEFAULT_LOOK,enabled:true,outputSize:size});expect(l.compositionW/l.compositionH).toBeCloseTo(size.width/size.height,8);expect(l.contentW).toBe(800);expect(l.contentH).toBe(600);}});
  it('places a watermark inside both output corners',()=>{const wm={text:'Demo',color:'#ffffff',dataUrl:'',width:100,height:20,opacity:.5,position:'bottom-right' as const};const right=watermarkPlacement(1200,630,wm),left=watermarkPlacement(1200,630,{...wm,position:'bottom-left'});expect(right.x+right.w).toBeLessThan(1200);expect(right.y+right.h).toBeLessThan(630);expect(left.x).toBeCloseTo(15.75);expect(left.w).toBe(right.w);});
});
