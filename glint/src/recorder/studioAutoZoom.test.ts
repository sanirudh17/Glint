import { expect,it } from "vitest";
import { regenerateZooms } from "./studioAutoZoom";
import { newZoom } from "./studioEffects";
import type { InputEvent,StudioEvents } from "./studioModel";
const data=(events:InputEvent[]):StudioEvents=>({version:1,geometry:{x:-1000,y:100,width:2000,height:1000,monitorX:-1000,monitorY:0,monitorWidth:2000,monitorHeight:1200,dpiScale:1.5},events});
const click=(t:number,x=0,y=600):InputEvent=>({t,kind:'click',x,y});
it('ignores isolated accidental clicks and groups a nearby interaction',()=>{
  const zooms=regenerateZooms([],data([click(1),click(5),click(5.4,20)]),10);
  expect(zooms).toHaveLength(1);expect(zooms[0].start).toBe(4.7);expect(zooms[0].focus.x).toBeCloseTo(.505);
});
it('keeps gaps between zooms and ignores clicks outside the capture region',()=>{
  const zooms=regenerateZooms([],data([click(1),click(1.2),click(3.3),click(3.5),click(7,-2000),click(7.2,-2000)]),10);
  expect(zooms).toHaveLength(2);expect(zooms[1].start-zooms[0].end).toBeGreaterThanOrEqual(.8-.0001);
});
it('zooms out when the pointer travels away',()=>{
  const zooms=regenerateZooms([],data([click(1),click(1.2),{t:1.5,kind:'cursor',x:900,y:1000}]),10);
  expect(zooms[0].end).toBeCloseTo(1.85);
});
it('preserves manual and hand-edited generated segments verbatim across regeneration',()=>{
  const auto=regenerateZooms([],data([click(1),click(1.2)]),10)[0];
  const edited={...auto,edited:true,scale:2.8};const manual={...newZoom(6,10),end:8};
  const regenerated=regenerateZooms([edited,manual],data([click(1),click(1.2),click(6),click(6.2)]),10);
  expect(regenerated).toEqual([edited,manual]);
});
it('is deterministic and prevents a chain of clicks from making an unbounded zoom',()=>{
  const events=data(Array.from({length:20},(_,i)=>click(i*.5)));
  const first=regenerateZooms([],events,12);expect(regenerateZooms(first,events,12)).toEqual(first);
  expect(first.every(s=>s.end-s.start<=6)).toBe(true);
});
