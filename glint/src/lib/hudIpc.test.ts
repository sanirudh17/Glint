import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),emit:vi.fn(),start:vi.fn(),toast:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@tauri-apps/api/event',()=>({emit:mocks.emit}));
vi.mock('@crabnebula/tauri-plugin-drag',()=>({startDrag:mocks.start}));
vi.mock('../store/useAppStore',()=>({useAppStore:{getState:()=>({pushToast:mocks.toast})}}));
beforeEach(()=>{vi.resetModules();mocks.invoke.mockReset().mockResolvedValue('owned.png');mocks.emit.mockReset().mockResolvedValue(undefined);mocks.start.mockReset().mockResolvedValue(undefined);mocks.toast.mockReset();});
it('keeps the drag alive until the native drop callback, not command acknowledgement',async()=>{
 const {dragOut}=await import('./hudIpc');const pending=dragOut('source.png');
 await vi.waitFor(()=>expect(mocks.start).toHaveBeenCalledTimes(1));
 expect(mocks.emit).toHaveBeenCalledWith('capture-dragging',true);
 expect(mocks.emit).not.toHaveBeenCalledWith('capture-dragging',false);
 await dragOut('another.png');expect(mocks.start).toHaveBeenCalledTimes(1);
 mocks.start.mock.calls[0][1]({result:'Dropped',cursorPos:{x:0,y:0}});await pending;
 expect(mocks.emit).toHaveBeenCalledWith('capture-dragging',false);
});
it('resumes normal HUD state when native drag start fails',async()=>{
 mocks.start.mockRejectedValueOnce(Error('fixture failure'));
 const {dragOut}=await import('./hudIpc');await dragOut('source.png');
 expect(mocks.toast).toHaveBeenCalled();expect(mocks.emit).toHaveBeenCalledWith('capture-dragging',false);
});
