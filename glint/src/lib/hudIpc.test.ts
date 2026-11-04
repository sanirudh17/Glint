import {expect,it,vi} from "vitest";
import {emit} from "@tauri-apps/api/event";
import {startDrag,type CallbackPayload} from "@crabnebula/tauri-plugin-drag";
import {dragOut} from "./hudIpc";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn().mockResolvedValue("owned-preserved.png")}));
vi.mock("@tauri-apps/api/event",()=>({emit:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@crabnebula/tauri-plugin-drag",()=>({startDrag:vi.fn()}));
it("signals native drop completion once, with the originating screenshot path",async()=>{
  let callback:((payload:CallbackPayload)=>void)|undefined;
  let finish:()=>void=()=>{};
  vi.mocked(startDrag).mockImplementation(async(_options,onEvent)=>{
    callback=onEvent;await new Promise<void>(resolve=>{finish=resolve;});
  });
  const pending=dragOut("owned.png");
  await vi.waitFor(()=>expect(startDrag).toHaveBeenCalled());
  expect(emit).toHaveBeenCalledWith("capture-dragging",{path:"owned.png",dragging:true});
  callback?.({result:"Dropped",cursorPos:{x:400,y:300}});
  finish();await pending;
  const completed=vi.mocked(emit).mock.calls.filter(([name,payload])=>name==="capture-dragging" && !(payload as {dragging:boolean}).dragging);
  expect(completed).toEqual([["capture-dragging",{path:"owned.png",dragging:false}]]);
});
