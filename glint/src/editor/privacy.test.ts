import {describe,it,expect} from 'vitest';
import {privacyPixels,opaqueRedactionColor,privacyCellSize} from './privacy';
describe('privacy raster bounds',()=>{
  it('uses coarse cells and opaque output rather than preserving glyph pixels',()=>{
    const image=new Uint8ClampedArray(24*24*4);for(let i=0;i<image.length;i+=4){image[i]=(i/4)%2?255:0;image[i+3]=255;}
    const out=privacyPixels(image,24,24);for(let i=0;i<out.length;i+=4){expect(Array.from(out.slice(i,i+4))).toEqual([128,0,0,255]);}
    expect(privacyCellSize(600,90)).toBe(30);expect(opaqueRedactionColor('rgba(0,0,0,.1)')).toBe('#111111');
  });
  it('two different arrangements of secret pixels collapse to the same coarse raster',()=>{
    const first=new Uint8ClampedArray(24*24*4),second=new Uint8ClampedArray(first.length);
    for(let y=0;y<24;y++)for(let x=0;x<24;x++){const i=(y*24+x)*4;first[i]=x<12?0:255;second[i]=y<12?0:255;first[i+3]=second[i+3]=255;}
    expect(first).not.toEqual(second);expect(privacyPixels(first,24,24)).toEqual(privacyPixels(second,24,24));
  });
});
