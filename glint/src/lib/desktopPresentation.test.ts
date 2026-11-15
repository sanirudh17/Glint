import {beforeEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
import {finishDesktopPresentation} from './desktopPresentation';
let frames:FrameRequestCallback[];
const root={dataset:{} as Record<string,string>,offsetWidth:1200};
beforeEach(()=>{
 frames=[];root.dataset={};invoke.mockReset();
 vi.stubGlobal('document',{documentElement:root});
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.push(cb);return frames.length;});
});
it('prepares the composition surface before painting and acknowledges that exact opening',async()=>{
 invoke.mockResolvedValueOnce([42,true]).mockResolvedValueOnce(true);
 const pending=finishDesktopPresentation();
 await vi.waitFor(()=>expect(frames).toHaveLength(1));
 expect(root.dataset.glass).toBe('true');
 expect(invoke).toHaveBeenCalledTimes(1);
 frames.shift()!(0);expect(invoke).toHaveBeenCalledTimes(1);
 frames.shift()!(16);await pending;
 expect(invoke).toHaveBeenLastCalledWith('window_material_presented',{token:42});
});
it('does not uncloak a cancelled editor after its second paint frame',async()=>{
 let cancelled=false;invoke.mockResolvedValueOnce([8,false]);
 const pending=finishDesktopPresentation(()=>cancelled);
 await vi.waitFor(()=>expect(frames).toHaveLength(1));
 frames.shift()!(0);cancelled=true;frames.shift()!(16);await pending;
 expect(invoke).toHaveBeenCalledTimes(1);
});
it('leaves an already-visible surface alone',async()=>{
 invoke.mockResolvedValueOnce(null);await finishDesktopPresentation();
 expect(frames).toHaveLength(0);expect(invoke).toHaveBeenCalledTimes(1);
});
