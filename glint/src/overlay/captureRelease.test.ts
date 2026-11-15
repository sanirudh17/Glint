import {expect,it} from 'vitest';
import {selectionOnRelease} from './captureRelease';
const draw={kind:'draw' as const,startX:100,startY:80};
it('captures final mouse-up coordinates including reverse drags',()=>{
 expect(selectionOnRelease(draw,{x:40,y:20},true,0)).toEqual({x:40,y:20,w:60,h:60});
 expect(selectionOnRelease(draw,{x:140,y:100},true,0)).toEqual({x:100,y:80,w:40,h:20});
});
it('preserves Enter-based capture when the option is off',()=>{
 expect(selectionOnRelease(draw,{x:200,y:180},false,0)).toBeNull();
});
it('does not capture right-button, tiny, cancelled, moved or resized gestures',()=>{
 expect(selectionOnRelease(draw,{x:200,y:180},true,2)).toBeNull();
 expect(selectionOnRelease(draw,{x:101,y:80},true,0)).toBeNull();
 expect(selectionOnRelease(null,{x:200,y:180},true,0)).toBeNull();
 for(const kind of ['move','resize'] as const)expect(selectionOnRelease({...draw,kind},{x:200,y:180},true,0)).toBeNull();
});
