import {describe,it,expect} from 'vitest';
import {autoBalance,OUTPUT_SIZES,watermarkPlacement,originalExportSizing,exportDimensions} from './sizing';
import {computeLayout} from '../editor/composition';
import {DEFAULT_LOOK} from './model';
describe('screenshot sizing',()=>{
  it('shows actual framed dimensions and restores unconstrained resolution',()=>{
    const look={...DEFAULT_LOOK,enabled:true};expect(exportDimensions(800,400,look)).toEqual({width:960,height:560});
    expect(exportDimensions(800,400,{...look,outputSize:{width:1234,height:789}})).toEqual({width:1234,height:789});
    expect(exportDimensions(800,400,{...look,aspect:'1:1',outputSize:{width:1200,height:630},...originalExportSizing()})).toEqual({width:960,height:560});
  });
  it('scales watermarks without changing the default or overflowing small outputs',()=>{
    const wm={text:'Size',color:'#ffffff',dataUrl:'',width:100,height:20,opacity:1,position:'bottom-right' as const};
    const normal=watermarkPlacement(1200,630,wm),large=watermarkPlacement(1200,630,{...wm,size:200}),small=watermarkPlacement(1200,630,{...wm,size:50});
    expect(large.h).toBeCloseTo(normal.h*2);expect(small.h).toBeCloseTo(normal.h/2);
    const tiny=watermarkPlacement(16,16,{...wm,size:200});expect(tiny.x).toBeGreaterThanOrEqual(0);expect(tiny.y).toBeGreaterThanOrEqual(0);
  });
  it('balances all four card margins and removes fixed aspect constraints',()=>{const l=computeLayout(800,400,null,{...DEFAULT_LOOK,...autoBalance(800,400)});expect(l.contentX).toBe(40);expect(l.contentY).toBe(40);expect(l.compositionW-l.contentX-l.contentW).toBe(40);expect(l.compositionH-l.contentY-l.contentH).toBe(40);});
  it('uses exact target aspect without clipping the screenshot',()=>{for(const size of OUTPUT_SIZES){const l=computeLayout(800,600,null,{...DEFAULT_LOOK,enabled:true,outputSize:size});expect(l.compositionW/l.compositionH).toBeCloseTo(size.width/size.height,8);expect(l.contentW).toBe(800);expect(l.contentH).toBe(600);}});
  it('places a watermark inside both output corners',()=>{const wm={text:'Demo',color:'#ffffff',dataUrl:'',width:100,height:20,opacity:.5,position:'bottom-right' as const};const right=watermarkPlacement(1200,630,wm),left=watermarkPlacement(1200,630,{...wm,position:'bottom-left'});expect(right.x+right.w).toBeLessThan(1200);expect(right.y+right.h).toBeLessThan(630);expect(left.x).toBeCloseTo(15.75);expect(left.w).toBe(right.w);});
});
