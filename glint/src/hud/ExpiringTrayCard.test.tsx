// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {beforeEach,expect,it,vi} from "vitest";
import {ExpiringTrayCard} from "./ExpiringTrayCard";
import {trayDismiss,type TrayItem} from "../lib/hudIpc";
const shared=vi.hoisted(()=>({current:{settings:{quick_access_auto_close:false}},handlers:new Map<string,Set<(event:{payload:{path:string;dragging:boolean}})=>void>>()}));
vi.mock("../store/useAppStore",()=>({useAppStore:Object.assign(
  <T,>(selector:(state:typeof shared.current)=>T)=>selector(shared.current),
  {setState:(update:(state:typeof shared.current)=>Partial<typeof shared.current>)=>{shared.current={...shared.current,...update(shared.current)};}}
)}));
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn(async(name:string,handler:(event:{payload:{path:string;dragging:boolean}})=>void)=>{
  const set=shared.handlers.get(name)??new Set();set.add(handler);shared.handlers.set(name,set);return()=>{set.delete(handler);};
})}));
vi.mock("../lib/hudIpc",()=>({trayDismiss:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./TrayCard",()=>({TrayCard:({item}:{item:TrayItem})=><div>{item.id}</div>}));
beforeEach(()=>{shared.current={settings:{quick_access_auto_close:false}};shared.handlers.clear();vi.clearAllMocks();});
it("keeps the card mounted through second-based production CSS durations",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:false}));vi.useFakeTimers();
  shared.current.settings.quick_access_auto_close=true;
  document.documentElement.style.setProperty("--capture-exit-duration",".7s");
  document.documentElement.style.setProperty("--duration-medium",".35s");
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<ExpiringTrayCard item={{id:5,path:"owned.png",width:10,height:10,saved:true,thumb:""}} onChanged={()=>{}}/>));
    act(()=>vi.advanceTimersByTime(8000));
    act(()=>vi.advanceTimersByTime(699));
    expect(host.querySelector(".leaving")).not.toBeNull();
    expect(trayDismiss).not.toHaveBeenCalled();
    act(()=>vi.advanceTimersByTime(1));
    expect(host.querySelector(".collapsing")).not.toBeNull();
    await act(async()=>vi.advanceTimersByTime(349));
    expect(trayDismiss).not.toHaveBeenCalled();
    await act(async()=>vi.advanceTimersByTime(1));
    expect(trayDismiss).toHaveBeenCalledExactlyOnceWith(5);
  }finally{
    act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--capture-exit-duration");
    document.documentElement.style.removeProperty("--duration-medium");
  }
});
it("enabling expiry in an open tray also applies to cards added afterward",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:false}));vi.useFakeTimers();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host),changed=vi.fn();
  const item:TrayItem={id:1,path:"owned.png",width:10,height:10,saved:true,thumb:""};
  try{
    await act(async()=>root.render(<><ExpiringTrayCard key="first" item={item} onChanged={changed}/></>));
    act(()=>vi.advanceTimersByTime(9000));expect(trayDismiss).not.toHaveBeenCalled();
    shared.current.settings.quick_access_auto_close=true;
    await act(async()=>root.render(<><ExpiringTrayCard key="first" item={item} onChanged={changed}/><ExpiringTrayCard key="second" item={{...item,id:2}} onChanged={changed}/></>));
    act(()=>vi.advanceTimersByTime(8100));act(()=>vi.advanceTimersByTime(700));
    await act(async()=>vi.advanceTimersByTime(350));
    expect(trayDismiss).toHaveBeenCalledWith(1);expect(trayDismiss).toHaveBeenCalledWith(2);
  }finally{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});

it("resumes after a native drop even when Windows never sends pointerleave",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:false}));vi.useFakeTimers();
  shared.current.settings.quick_access_auto_close=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<ExpiringTrayCard item={{id:3,path:"owned.png",width:10,height:10,saved:true,thumb:""}} onChanged={()=>{}}/>));
    act(()=>vi.advanceTimersByTime(500));
    const card=host.querySelector(".tray-expiry")!;
    act(()=>card.dispatchEvent(new MouseEvent("pointerover",{bubbles:true})));
    act(()=>card.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:0})));
    act(()=>shared.handlers.get("capture-dragging")?.forEach(fn=>fn({payload:{path:"owned.png",dragging:true}})));
    act(()=>card.dispatchEvent(new MouseEvent("pointercancel",{bubbles:true})));
    act(()=>vi.advanceTimersByTime(5000));expect(trayDismiss).not.toHaveBeenCalled();
    // OLE drops outside this WebView can omit pointerup and pointerleave.
    act(()=>shared.handlers.get("capture-dragging")?.forEach(fn=>fn({payload:{path:"owned.png",dragging:false}})));
    act(()=>vi.advanceTimersByTime(7500));
    expect(card.classList.contains("leaving")).toBe(true);
    act(()=>vi.advanceTimersByTime(700));
    await act(async()=>vi.advanceTimersByTime(350));
    expect(trayDismiss).toHaveBeenCalledExactlyOnceWith(3);
  }finally{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});

it("dragging another screenshot does not clear this card's hover pause",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",()=>({matches:false}));vi.useFakeTimers();
  shared.current.settings.quick_access_auto_close=true;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  try{
    await act(async()=>root.render(<ExpiringTrayCard item={{id:4,path:"hovered.png",width:10,height:10,saved:true,thumb:""}} onChanged={()=>{}}/>));
    const card=host.querySelector(".tray-expiry")!;
    act(()=>card.dispatchEvent(new MouseEvent("pointerover",{bubbles:true})));
    act(()=>shared.handlers.get("capture-dragging")?.forEach(fn=>fn({payload:{path:"another.png",dragging:false}})));
    act(()=>vi.advanceTimersByTime(12000));
    expect(card.classList.contains("active")).toBe(true);expect(trayDismiss).not.toHaveBeenCalled();
  }finally{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();}
});
