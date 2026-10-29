import {beforeEach,expect,it,vi} from 'vitest';
const material=vi.hoisted(()=>vi.fn());
vi.mock('../lib/material',()=>({waitForMaterial:material}));
import {presentEditorFrame} from './firstFrame';
let frames:FrameRequestCallback[];
beforeEach(()=>{
  frames=[];material.mockReset();material.mockResolvedValue(undefined);
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()}});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
});
it('keeps the editor hidden through delayed material and both paint frames',async()=>{
  let finish!:()=>void;
  material.mockReturnValueOnce(new Promise<void>(resolve=>{finish=resolve;}));
  const present=vi.fn().mockResolvedValue(undefined);
  const pending=presentEditorFrame(present,()=>false);
  expect(frames).toHaveLength(0);expect(present).not.toHaveBeenCalled();
  finish();await vi.waitFor(()=>expect(frames).toHaveLength(1));
  frames.shift()!(0);expect(present).not.toHaveBeenCalled();
  frames.shift()!(16);await pending;expect(present).toHaveBeenCalledTimes(1);
});
it('does not reveal an old image when closed or superseded between frames',async()=>{
  let cancelled=false;const present=vi.fn();
  const pending=presentEditorFrame(present,()=>cancelled);
  await vi.waitFor(()=>expect(frames).toHaveLength(1));
  frames.shift()!(0);cancelled=true;frames.shift()!(16);await pending;
  expect(present).not.toHaveBeenCalled();
});
it('waits for fonts before scheduling a visible frame',async()=>{
  let finish!:()=>void;
  vi.stubGlobal('document',{fonts:{ready:new Promise<void>(resolve=>{finish=resolve;})}});
  const present=vi.fn().mockResolvedValue(undefined);
  const pending=presentEditorFrame(present,()=>false);
  await Promise.resolve();expect(frames).toHaveLength(0);
  finish();await vi.waitFor(()=>expect(frames).toHaveLength(1));
  frames.shift()!(0);frames.shift()!(16);await pending;
  expect(present).toHaveBeenCalledTimes(1);
});
