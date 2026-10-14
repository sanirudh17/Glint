import {describe,it,expect} from 'vitest';
import {GRADIENTS} from '../editor/gradients';
import {gradientPixels,threeStops,paletteFromPixels} from './gradientRender';
const bg={type:'gradient' as const,gradientId:'dusk',angleDeg:0,stops:[{offset:0,color:'#000000'},{offset:.5,color:'#ff0000'},{offset:1,color:'#ffffff'}]};
const pixel=(data:Uint8ClampedArray,x:number,y:number)=>Array.from(data.slice((y*100+x)*4,(y*100+x)*4+3));
describe('procedural backgrounds',()=>{
  it('keeps legacy presets and provides 48 categorized choices',()=>{expect(GRADIENTS).toHaveLength(48);expect(GRADIENTS[0].stops).toEqual([{offset:0,color:'#5B7CFA'},{offset:1,color:'#9D6CFF'}]);expect(new Set(GRADIENTS.map(g=>g.category)).size).toBe(5);});
  it('renders distinct geometries at known coordinates',()=>{
    expect(pixel(gradientPixels(bg,100,100),50,50)).toEqual([255,0,0]);
    expect(pixel(gradientPixels({...bg,kind:'radial'},100,100),50,50)).toEqual([0,0,0]);
    expect(pixel(gradientPixels({...bg,kind:'conic'},100,100),50,50)).toEqual([0,0,0]);
    expect(pixel(gradientPixels({...bg,kind:'mesh'},100,100),50,50)).toEqual([189,125,125]);
    expect(pixel(gradientPixels({...bg,angleDeg:90},100,100),0,50)).toEqual([255,0,0]);
  });
  it('grain is repeatable and optional',()=>{const noisy={...bg,grain:.4};expect(gradientPixels(noisy,100,100)).toEqual(gradientPixels(noisy,100,100));expect(gradientPixels(noisy,100,100)).not.toEqual(gradientPixels(bg,100,100));});
  it('inserts a middle color and samples chromatic colors',()=>{expect(threeStops([bg.stops[0],bg.stops[2]],3)[1]).toEqual({offset:.5,color:'#808080'});expect(paletteFromPixels(new Uint8ClampedArray([255,255,255,255,255,0,0,255]))[0].color).toBe('#ff0000');});
});
