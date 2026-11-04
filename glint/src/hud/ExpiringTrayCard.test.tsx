// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {ExpiringTrayCard} from "./ExpiringTrayCard";
import {trayDismiss,type TrayItem} from "../lib/hudIpc";
const shared=vi.hoisted(()=>({current:{settings:{quick_access_auto_close:false}},handlers:new Map<string,Set<(event:{payload:boolean})=>void>>()}));
vi.mock("../store/useAppStore",()=>({useAppStore:Object.assign(
  <T,>(selector:(state:typeof shared.current)=>T)=>selector(shared.current),
  {setState:(update:(state:typeof shared.current)=>Partial<typeof shared.current>)=>{shared.current={...shared.current,...update(shared.current)};}}
)}));
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn(async(name:string,handler:(event:{payload:boolean})=>void)=>{
  const set=shared.handlers.get(name)??new Set();set.add(handler);shared.handlers.set(name,set);return()=>{set.delete(handler);};
})}));
vi.mock("../lib/hudIpc",()=>({trayDismiss:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./TrayCard",()=>({TrayCard:({item}:{item:TrayItem})=><div>{item.id}</div>}));
it("enabling expiry in an open tray also applies to cards added afterward",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:false}));vi.useFakeTimers();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host),changed=vi.fn();
  const item:TrayItem={id:1,path:"owned.png",width:10,height:10,saved:true,thumb:""};
  try{
    await act(async()=>root.render(<><ExpiringTrayCard key="first" item={item} onChanged={changed}/></>));
    act(()=>vi.advanceTimersByTime(9000));expect(trayDismiss).not.toHaveBeenCalled();
    shared.current.settings.quick_access_auto_close=true;
    await act(async()=>root.render(<><ExpiringTrayCard key="first" item={item} onChanged={changed}/><ExpiringTrayCard key="second" item={{...item,id:2}} onChanged={changed}/></>));
    act(()=>vi.advanceTimersByTime(8100));act(()=>vi.advanceTimersByTime(350));
    await act(async()=>vi.advanceTimersByTime(350));
    expect(trayDismiss).toHaveBeenCalledWith(1);expect(trayDismiss).toHaveBeenCalledWith(2);
  }finally{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});
