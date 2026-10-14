import { Copy, Plus, Scissors, Trash2 } from 'lucide-react';
import {Button,ColorControl,ControlDisclosure,NumberInput,Select,Switch} from '../components/ui';
import {LookSlider} from '../look/LookControls';
import {effectId} from './studioEffects';
import {copyMaskAt,maskAt,setMaskKeyframe,sourceRect,splitMask,type MaskSegment} from './studioMasks';
export function StudioMaskControls({masks,selected,time,duration,width,height,drawing,onDraw,onChange,onSelect,onSeek}: {
  masks:MaskSegment[];selected:string|null;time:number;duration:number;width:number;height:number;drawing:boolean;
  onDraw:()=>void;onChange:(masks:MaskSegment[])=>void;onSelect:(id:string|null)=>void;onSeek:(time:number)=>void;
}) {
  const active=masks.find(m=>m.id===selected),rect=active?maskAt(active,time):null;
  const span=Math.min(.1,duration/2);
  const change=(patch:Partial<MaskSegment>)=>onChange(masks.map(m=>m.id===selected?{...m,...patch}:m));
  return <ControlDisclosure title="Masks & focus" className="studio-effects-controls">
    <p className="look-hint">Cover sensitive content with a margin. Masks follow source pixels through zoom and crop.</p>
    <div className="studio-effect-actions">
      <Button size="sm" variant="subtle" icon={Plus} disabled={masks.length>=512} onClick={onDraw}>{drawing?'Cancel drawing':'Draw mask'}</Button>
      {active&&<Button size="sm" variant="ghost" icon={Trash2} onClick={()=>{onChange(masks.filter(m=>m.id!==active.id));onSelect(null);}}>Delete</Button>}
    </div>
    {masks.length>0&&<Select portal ariaLabel="Selected mask" value={selected??''} options={[{value:'',label:'Select a mask'},...masks.map((m,i)=>({value:m.id,label:`Mask ${i+1} · ${m.type}`}))]} onChange={id=>onSelect(id||null)}/>}
    {active&&rect&&<>
      <div className="look-row"><span className="look-label">Type</span><div className="look-control"><Select portal ariaLabel="Mask type" value={active.type} options={[{value:'blur',label:'Blur'},{value:'pixelate',label:'Pixelate'},{value:'solid',label:'Solid'},{value:'highlight',label:'Highlight'}]} onChange={type=>change({type:type as MaskSegment['type']})}/></div></div>
      {active.type==='highlight'?<>
        <p className="look-hint">Highlight guides attention. Use Blur, Pixelate or Solid to redact content.</p>
        <LookSlider label="Dim outside" ariaLabel="Highlight dim" value={(active.opacity??.55)*100} max={90} unit="%" onChange={value=>change({opacity:value/100})}/>
        <div className="look-row"><span className="look-label">Blur outside</span><Switch ariaLabel="Blur outside focus" checked={active.blurOutside??false} onChange={blurOutside=>change({blurOutside})}/></div>
        {active.blurOutside&&<LookSlider label="Blur strength" ariaLabel="Focus blur strength" value={active.strength} min={8} max={80} step={2} unit="px" onChange={strength=>change({strength})}/>}
      </>:active.type==='solid'?<ColorControl ariaLabel="Mask color" value={active.color} onChange={color=>change({color})}/>:<LookSlider label={active.type==='blur'?'Blur strength':'Block size'} ariaLabel="Mask strength" value={active.strength} min={8} max={80} step={2} unit="px" onChange={strength=>change({strength})}/>}
      <div className="studio-crop-grid">
        <div className="studio-crop-field"><span className="look-label">Start</span><NumberInput ariaLabel="Mask start" value={active.start} max={active.end-span} step={.01} unit="s" onChange={start=>change({start})}/></div>
        <div className="studio-crop-field"><span className="look-label">End</span><NumberInput ariaLabel="Mask end" value={active.end} min={active.start+span} max={duration} step={.01} unit="s" onChange={end=>change({end})}/></div>
      </div>
      <ControlDisclosure title="Position & keyframes">
        <Select portal ariaLabel="Mask keyframe" value={String(active.keyframes.find(p=>Math.abs(p.t-time)<.001)?.t??'current')} options={[{value:'current',label:`Current position · ${time.toFixed(2)} s`},...active.keyframes.map(p=>({value:String(p.t),label:`Keyframe · ${p.t.toFixed(2)} s`}))]} onChange={value=>{if(value!=='current')onSeek(Number(value));}}/>
        <div className="studio-crop-grid">{(['x','y','w','h'] as const).map(key=><div className="studio-crop-field" key={key}>
          <span className="look-label">{{x:'Left',y:'Top',w:'Width',h:'Height'}[key]}</span>
          <NumberInput ariaLabel={`Mask ${key}`} value={rect[key]} min={key==='w'||key==='h'?2:0} max={key==='x'?width-2:key==='y'?height-2:key==='w'?width-rect.x:height-rect.y} unit="px"
            onChange={value=>onChange(masks.map(m=>m.id===selected?setMaskKeyframe(m,sourceRect({...rect,[key]:value},width,height),time):m))}/>
        </div>)}</div>
        <Button size="sm" variant="ghost" onClick={()=>onChange(masks.map(m=>m.id===selected?setMaskKeyframe(m,rect,time):m))}>Add keyframe here</Button>
      </ControlDisclosure>
      <div className="studio-effect-actions">
        <Button size="sm" variant="ghost" icon={Copy} disabled={masks.length>=512} onClick={()=>{const copy={...active,id:effectId(),keyframes:active.keyframes.map(p=>({...p}))};onChange([...masks,copy]);onSelect(copy.id);}}>Duplicate</Button>
        <Button size="sm" variant="ghost" disabled={masks.length>=512} onClick={()=>{const copy=copyMaskAt(active,time,duration);onChange([...masks,copy]);onSelect(copy.id);}}>Copy to playhead</Button>
        <Button size="sm" variant="ghost" icon={Scissors} disabled={time<=active.start+.01||time>=active.end-.01||masks.length>=512} onClick={()=>onChange(masks.flatMap(m=>m.id===active.id?splitMask(m,time):[m]))}>Split here</Button>
      </div>
    </>}
    <p className="studio-privacy-note">Projects keep the unmasked recording. Share only an exported MP4.</p>
  </ControlDisclosure>;
}
