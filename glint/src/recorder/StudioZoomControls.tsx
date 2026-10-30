import { Crosshair, Plus, Scissors, Trash2, WandSparkles } from "lucide-react";
import { Button, ControlDisclosure, NumberInput, Select } from "../components/ui";
import { LookSlider } from "../look/LookControls";
import { clamp, newZoom, splitZoom, ZOOM_EASES, type ZoomSegment } from "./studioEffects";
import { regenerateZooms } from "./studioAutoZoom";
import {useMemo} from 'react';
import {smoothPath,followSourcePoint} from './studioCursor';
import {zoomFocus,setZoomFocus,type FocusPoint} from './studioFocus';
import type { StudioEvents } from "./studioModel";
export function StudioZoomControls({segments,selected,time,duration,onChange,onSelect,onPick,events,width,height,smoothing,aim,picking}: {
  segments:ZoomSegment[];selected:string|null;time:number;duration:number;
  onChange:(segments:ZoomSegment[])=>void;onSelect:(id:string|null)=>void;onPick:()=>void;
  events:StudioEvents;
  width:number;height:number;smoothing:number;aim:FocusPoint|null;picking:boolean;
}) {
  const active=segments.find(s=>s.id===selected);
  const path=useMemo(()=>smoothPath(events.events,smoothing),[events,smoothing]);
  const cursor=followSourcePoint(path,time,events,width,height);
  const focus=aim??(active?zoomFocus(active,cursor,width,height):{x:.5,y:.5});
  const hasClicks=events.events.some(e=>e.kind==='click'),hasCursor=events.events.some(e=>e.kind==='cursor'&&Number.isFinite(e.x)&&Number.isFinite(e.y));
  const change=(patch:Partial<ZoomSegment>)=>onChange(segments.map(s=>s.id===selected?{...s,...patch,edited:true}:s));
  const changeFocus=(point:FocusPoint)=>onChange(segments.map(s=>s.id===selected?setZoomFocus(s,point,cursor,width,height):s));
  return <ControlDisclosure title="Zoom" openByDefault={segments.length>0} className="studio-effects-controls">
    <div className="studio-effect-actions">
      <Button size="sm" variant="subtle" icon={Plus} disabled={duration<.1||segments.length>=512} onClick={()=>{const segment=newZoom(time,duration,hasCursor);onChange([...segments,segment]);onSelect(segment.id);}}>Add zoom</Button>
      <Button size="sm" variant="ghost" icon={WandSparkles} disabled={!hasClicks} title={hasClicks?undefined:'Requires clicks captured during a Studio recording'} onClick={()=>onChange(regenerateZooms(segments,events,duration))}>{segments.some(s=>s.origin==='auto')?'Regenerate':'Auto zoom'}</Button>
      {active&&<Button size="sm" variant="ghost" icon={Trash2} onClick={()=>{onChange(segments.filter(s=>s.id!==active.id));onSelect(null);}}>Delete</Button>}
    </div>
    <p className="look-hint">{hasClicks?'Auto zoom groups nearby clicks. Manual and hand-edited zooms are kept.':'No recorded clicks are available. Use Add zoom to choose when and where to zoom.'}</p>
    {segments.length>0&&<Select portal ariaLabel="Selected zoom" value={selected??""} options={[{value:"",label:"Select a zoom"},...segments.map((s,i)=>({value:s.id,label:`Zoom ${i+1} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`}))]} onChange={id=>onSelect(id||null)} />}
    {active?<>
      <div className="studio-crop-grid">
        <div className="studio-crop-field"><span className="look-label">Start</span><NumberInput ariaLabel="Zoom start" value={active.start} min={0} max={active.end-.1} step={.1} unit="s" onChange={start=>change({start,transitionStart:undefined,transitionEnd:undefined})}/></div>
        <div className="studio-crop-field"><span className="look-label">End</span><NumberInput ariaLabel="Zoom end" value={active.end} min={active.start+.1} max={duration} step={.1} unit="s" onChange={end=>change({end,transitionStart:undefined,transitionEnd:undefined})}/></div>
      </div>
      <LookSlider label="Scale" ariaLabel="Zoom scale" value={active.scale} min={1.2} max={3} step={.1} unit="×" onChange={scale=>change({scale})}/>
      <div className="look-row"><span className="look-label">Focus</span><div className="look-control"><Select portal ariaLabel="Zoom focus mode" value={active.mode} options={[{value:"fixed",label:"Fixed point"},...(hasCursor?[{value:"follow-cursor",label:"Follow cursor"}]:[])]} onChange={mode=>change({mode:mode as ZoomSegment['mode'],...(mode==='fixed'?{focus}: {})})}/></div></div>
      {active.mode==='fixed'&&<><LookSlider label="Horizontal" ariaLabel="Zoom horizontal focus" value={focus.x*100} unit="%" onChange={x=>changeFocus({...focus,x:clamp(x/100,0,1)})}/>
      <LookSlider label="Vertical" ariaLabel="Zoom vertical focus" value={focus.y*100} unit="%" onChange={y=>changeFocus({...focus,y:clamp(y/100,0,1)})}/></>}
      <Button size="sm" variant="ghost" icon={Crosshair} aria-pressed={picking} onClick={onPick}>{picking?'Cancel picking':'Pick focus in preview'}</Button>
      {active.mode==='follow-cursor'&&<p className="look-hint">Stays zoomed from Start to End and pans with the recorded cursor. Pick a point to offset the framing; the cursor stays in view.</p>}
      <div className="look-row"><span className="look-label">Easing</span><div className="look-control"><Select portal ariaLabel="Zoom easing" value={active.ease} options={ZOOM_EASES} onChange={ease=>{const seconds=ease==='snappy'?.3:ease==='slow'?.5:.4;change({ease:ease as ZoomSegment['ease'],easeIn:seconds,easeOut:seconds});}}/></div></div>
      <Button size="sm" variant="ghost" icon={Scissors} disabled={time<=active.start+.05||time>=active.end-.05} onClick={()=>onChange(segments.flatMap(s=>s.id===active.id?splitZoom(s,time):[s]))}>Split at playhead</Button>
    </>:<p className="look-hint">Add a zoom at the playhead, then drag its timeline segment to move or trim it.</p>}
  </ControlDisclosure>;
}
