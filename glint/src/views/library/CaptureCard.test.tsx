// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaptureCard } from "./CaptureCard";
import type { CaptureItem } from "../../lib/captures";
import { copyCapture, dragOut } from "../../lib/captures";
import { openEditorCapture } from "../../lib/editor";

vi.mock("../../lib/captures", () => ({
  openCapture:vi.fn(),revealCapture:vi.fn(),copyCapture:vi.fn().mockResolvedValue(undefined),
  copyCapturePath:vi.fn(),deleteCapture:vi.fn(),renameCapture:vi.fn(),dragOut:vi.fn(),
}));
vi.mock("../../lib/editor", () => ({openEditorCapture:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../../lib/trim", () => ({openTrim:vi.fn()}));
vi.mock("../../lib/pin", () => ({pinCreateFromCapture:vi.fn()}));
vi.mock("../../lib/ocr", () => ({extractCapture:vi.fn()}));
vi.mock("@tauri-apps/api/event", () => ({emit:vi.fn().mockResolvedValue(undefined)}));
const item:CaptureItem={id:37,kind:"screenshot",path:"owned-fixture.png",width:640,height:360,bytes:100,created_at:0,title:"Notes",thumb_url:null};
let host:HTMLDivElement,root:Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("matchMedia",()=>({matches:true}));
  vi.useFakeTimers();vi.clearAllMocks();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(() => {act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
function render(capture=item) {act(()=>root.render(<CaptureCard item={capture} variant="home" onChanged={()=>{}}/>));}
function open() {const card=host.querySelector(".cap-card");if(!card)throw Error("Card missing");act(()=>card.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:100,clientY:100})));}
function menuItem(text:string) {const button=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b=>b.textContent===text);if(!button)throw Error(`Missing ${text}`);return button;}
it("opens screenshot actions without hover icons or a right-button drag", async () => {
  render();const card=host.querySelector(".cap-card");if(!card)throw Error("Card missing");
  act(()=>card.dispatchEvent(new MouseEvent("pointerdown",{bubbles:true,button:2})));
  open();expect(dragOut).not.toHaveBeenCalled();expect(host.querySelector(".cap-actions")).toBeNull();
  expect(menuItem("Pin to screen")).toBeTruthy();expect(menuItem("Annotate")).toBeTruthy();
  await act(async()=>menuItem("Copy image").click());expect(copyCapture).toHaveBeenCalledExactlyOnceWith(37);
});
it("opens the selected screenshot in the editor",async()=>{
  render();open();await act(async()=>menuItem("Open in editor").click());
  expect(openEditorCapture).toHaveBeenCalledExactlyOnceWith(37);
  act(()=>vi.runAllTimers());open();await act(async()=>menuItem("Annotate").click());
  expect(openEditorCapture).toHaveBeenCalledTimes(2);expect(openEditorCapture).toHaveBeenLastCalledWith(37);
});
it("offers keyboard access and restores focus after Escape",()=>{
  render();const card=host.querySelector<HTMLElement>(".cap-card");if(!card)throw Error("Card missing");card.focus();
  act(()=>card.dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true})));
  expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
  act(()=>document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  act(()=>vi.runAllTimers());expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(card);
});
it("keeps recording actions separate from screenshot-only pinning",()=>{
  render({...item,kind:"recording",path:"owned-fixture.mp4"});open();
  expect(menuItem("Trim")).toBeTruthy();
  expect(Array.from(document.querySelectorAll('[role="menuitem"]')).some(b=>b.textContent==="Pin to screen")).toBe(false);
});
