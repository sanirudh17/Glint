import {beforeEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
let applyMaterial:typeof import('./material').applyMaterial;
const root={dataset:{theme:'dark',glass:'false'}};
beforeEach(async()=>{vi.resetModules();({applyMaterial}=await import('./material'));vi.stubGlobal('document',{documentElement:root});vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});root.dataset={theme:'dark',glass:'false'};invoke.mockReset();});
it('uses native acceptance rather than pretending that CSS can blur the desktop',async()=>{
  invoke.mockResolvedValueOnce(true);await applyMaterial(true);
  expect(invoke).toHaveBeenCalledWith('window_material',{glass:true,dark:true});
  expect(root.dataset.glass).toBe('true');
  root.dataset.theme='light';invoke.mockResolvedValueOnce(false);await applyMaterial(false);
  expect(invoke).toHaveBeenLastCalledWith('window_material',{glass:false,dark:false});
  expect(root.dataset.glass).toBe('false');
});
it('keeps solid surfaces when the native backend is unavailable',async()=>{
  invoke.mockRejectedValue(new Error('unavailable'));await applyMaterial(true);
  expect(root.dataset.glass).toBe('false');
});
it('ignores a stale response after the user has turned glass off',async()=>{
  let complete!:(value:boolean)=>void;
  invoke.mockImplementationOnce(()=>new Promise<boolean>(resolve=>{complete=resolve;})).mockResolvedValueOnce(false);
  const first=applyMaterial(true);await applyMaterial(false);complete(true);await first;
  expect(root.dataset.glass).toBe('false');
});
it('covers the WebView before the native backdrop is removed',async()=>{
  root.dataset.glass='true';
  invoke.mockImplementationOnce(()=>{expect(root.dataset.glass).toBe('false');return Promise.resolve(false);});
  await applyMaterial(false);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it('does not recreate acrylic or erase the WebView for repeated identical settings',async()=>{
  invoke.mockResolvedValue(true);
  await applyMaterial(true);await applyMaterial(true);
  expect(invoke).toHaveBeenCalledTimes(1);
  root.dataset.theme='light';await applyMaterial(true);
  expect(invoke).toHaveBeenCalledTimes(2);
});
