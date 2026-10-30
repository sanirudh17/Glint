import {cursorForFrame} from './studioCursor';
import {recordedCursor} from "./studioCursor";
import {DEFAULT_CURSOR} from "./studioModel";
import { expect, it } from "vitest";
import { cursorAt, smoothPath, sourcePoint } from "./studioCursor";
import type { StudioEvents } from "./studioModel";
it("smooths rate-independently and tracks actual movement for idle hiding", () => {
  const path = smoothPath([{ t: 0, kind: "cursor", x: 0, y: 0 }, { t: .1, kind: "cursor", x: 100, y: 100 }, { t: 2, kind: "cursor", x: 100, y: 100 }], .5);
  expect(path[1].x).toBeGreaterThan(0); expect(path[1].x).toBeLessThan(100);
  expect(cursorAt(path, 2)?.movedAt).toBe(.1);
  expect(smoothPath([{ t: 0, kind: "cursor", x: 0, y: 0 }, { t: .1, kind: "cursor", x: 100, y: 100 }], 0)[1].x).toBe(100);
});
it("maps global physical coordinates on a scaled, negative-origin monitor", () => {
  const events = { geometry: { x: -1500, y: 200, width: 1200, height: 800 } } as StudioEvents;
  expect(sourcePoint(-900, 600, events, 600, 400)).toEqual({ x: 300, y: 200 });
});
it("strong smoothing suppresses rapid cursor jitter while zero preserves every sample", () => {
  const events = Array.from({ length: 241 }, (_, i) => ({ t: i / 120, kind: "cursor" as const, x: 500 + (i % 2 ? 30 : -30), y: 300 }));
  const raw = smoothPath(events, 0), filtered = smoothPath(events, 1);
  const travel = (points: typeof raw) => points.slice(121).reduce((sum, p, i) => sum + Math.abs(p.x - points[i + 120].x), 0);
  expect(raw[1].x).toBe(530);
  expect(travel(filtered)).toBeLessThan(travel(raw) * .05);
});

it('recording effect toggles follow source time, with an explicit editing override',()=>{
 const config={...DEFAULT_CURSOR,clicks:true,keystrokes:true,spotlight:true};
 const events={version:1,geometry:{x:0,y:0,width:100,height:100,monitorX:0,monitorY:0,monitorWidth:100,monitorHeight:100,dpiScale:1},events:[{t:0,kind:'effects' as const,clicks:false,keystrokes:false,spotlight:false},{t:2,kind:'effects' as const,clicks:true,keystrokes:true,spotlight:true}]};
 expect(recordedCursor(config,events,1).clicks).toBe(false);expect(recordedCursor(config,events,2).keystrokes).toBe(true);
 expect(recordedCursor({...config,spotlight:false},events,3).spotlight).toBe(false);
 expect(recordedCursor({...config,recordedEffects:false},events,0).clicks).toBe(true);
});

it('keeps the pointer visible at a zoom mark without adding a click effect',()=>{
  const events={version:1,geometry:{x:100,y:100,width:400,height:300},events:[{kind:'marker',t:5,x:200,y:250}]} as StudioEvents;
  const path=[{t:0,x:900,y:900,movedAt:0}];
  expect(cursorForFrame(path,5.1,events)).toMatchObject({x:200,y:250,movedAt:5});
  expect(cursorForFrame(path,6.2,events)?.movedAt).toBe(0);
});
