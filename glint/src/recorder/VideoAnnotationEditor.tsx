import {StudioEffectTrack} from "./StudioEffectTrack";
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {Pencil,Highlighter,MoveUpRight,Square, Circle,Type,MousePointer2,Trash2,Copy,Undo2,Redo2} from 'lucide-react';
import {Button,ColorControl,NumberInput,ControlDisclosure} from '../components/ui';
import {ANNOTATION_TOOLS,annotationAt,moveAnnotation,paintAnnotation,type AnnotationTool,type VideoAnnotation} from './videoAnnotations';
const icons={pen:Pencil,highlight:Highlighter,arrow:MoveUpRight,rectangle:Square,ellipse:Circle,text:Type};
export function VideoAnnotationEditor({items,onChange,time,duration,onPause,disabled=false,hostId,onSeek}: {
  onSeek?:(time:number)=>void;hostId?:string;items:VideoAnnotation[];onChange:(items:VideoAnnotation[])=>void;time:number;duration:number;onPause:()=>void;disabled?:boolean;
}) {
  const [tool,setTool]=useState<AnnotationTool|null>(null),[selected,setSelected]=useState<string|null>(null);
  const [color,setColor]=useState('#ef5555'),[width,setWidth]=useState(.006),[draft,setDraft]=useState<VideoAnnotation|null>(null);
  const [past,setPast]=useState<VideoAnnotation[][]>([]),[future,setFuture]=useState<VideoAnnotation[][]>([]);
  const canvas=useRef<HTMLCanvasElement>(null),drag=useRef<{point:{x:number;y:number};item:VideoAnnotation;move:boolean}|null>(null);
  const active=items.find(a=>a.id===selected);
  useEffect(()=>{
    if(disabled||(!selected&&!tool))return;
    const key=(event:KeyboardEvent)=>{
      if((event.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]'))return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setTool(null);setSelected(null);setDraft(null);drag.current=null;}
      else if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())) {
        event.preventDefault();event.stopImmediatePropagation();
        const redo=event.shiftKey||event.key.toLowerCase()==='y';
        if(redo&&future.length){setPast(p=>[...p,items]);onChange(future[0]);setFuture(f=>f.slice(1));}
        else if(!redo&&past.length){setFuture(f=>[items,...f]);onChange(past[past.length-1]);setPast(p=>p.slice(0,-1));}
      } else if(event.key==='Delete'&&selected){event.preventDefault();event.stopImmediatePropagation();setPast(p=>[...p,items]);setFuture([]);onChange(items.filter(a=>a.id!==selected));setSelected(null);}
    };
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[disabled,selected,tool,items,past,future,onChange]);
  const commit=(next:VideoAnnotation[])=>{setPast(p=>[...p.slice(-29),items]);setFuture([]);onChange(next);};
  const patch=(p:Partial<VideoAnnotation>)=>commit(items.map(a=>a.id===selected?{...a,...p,raster:undefined}:a));
  useEffect(()=>{if(disabled){setTool(null);setDraft(null);drag.current=null;}},[disabled]);
  useEffect(()=>{const c=canvas.current;if(!c)return;const ctx=c.getContext('2d')!;ctx.clearRect(0,0,c.width,c.height);if(draft)paintAnnotation(ctx,draft,c.width,c.height);},[items,time,draft]);
  const point=(e:PointerEvent)=>{const r=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  return <ControlDisclosure title="Annotations" className="studio-annotations" openByDefault={items.length>0}>
    <div className="video-annotation-tools" role="group" aria-label="Video annotation tools">
      <Button size="sm" aria-pressed={tool===null} icon={MousePointer2} onClick={()=>{setTool(null);setSelected(null);}}>Select</Button>
      {ANNOTATION_TOOLS.map(kind=>{const Icon=icons[kind];return <button type="button" key={kind} disabled={disabled||items.length>=64} aria-label={`Draw ${kind}`} title={kind} aria-pressed={tool===kind} onClick={()=>{onPause();setTool(tool===kind?null:kind);}}><Icon size={16} strokeWidth={1.5}/></button>;})}
    </div>
    {items.length>0&&<StudioEffectTrack label="Marks" segments={items} duration={duration} zoom={1} viewStart={0} selected={selected} disabled={disabled}
      onSelect={id=>{const a=items.find(a=>a.id===id);setSelected(id);setTool(null);onPause();if(a)onSeek?.(a.start);}}
      onRange={(id,start,end)=>commit(items.map(a=>a.id===id?{...a,start,end}:a))} onDelete={id=>commit(items.filter(a=>a.id!==id))}/>}
    <p className="look-hint">Draw on the preview. Marks stay editable and appear only during their time range.</p>
    <div className="studio-crop-grid"><div className="studio-crop-field"><span className="look-label">Color</span><ColorControl ariaLabel="Annotation color" value={active?.color??color} onChange={value=>{setColor(value);if(active)patch({color:value});}}/></div>
      <div className="studio-crop-field"><span className="look-label">Stroke</span><NumberInput ariaLabel="Annotation stroke width" value={(active?.width??width)*100} min={.1} max={4} step={.1} unit="%" onChange={value=>{setWidth(value/100);if(active)patch({width:value/100});}}/></div></div>
    <div className="studio-effect-actions"><Button size="sm" icon={Undo2} disabled={!past.length} onClick={()=>{setFuture(f=>[items,...f]);onChange(past[past.length-1]);setPast(p=>p.slice(0,-1));}}>Undo mark</Button><Button size="sm" icon={Redo2} disabled={!future.length} onClick={()=>{setPast(p=>[...p,items]);onChange(future[0]);setFuture(f=>f.slice(1));}}>Redo</Button></div>
    {items.length>0&&<div className="video-annotation-list" aria-label="Annotations">{items.map((a,i)=><button type="button" key={a.id} aria-pressed={selected===a.id} onClick={()=>{onPause();setSelected(a.id);setTool(null);onSeek?.(a.start);}}>{i+1}. {a.kind==='text'?a.text:a.kind} <small>{a.start.toFixed(1)}–{a.end.toFixed(1)} s</small></button>)}</div>}
    {active&&<><div className="studio-crop-grid"><div className="studio-crop-field"><span className="look-label">Start</span><NumberInput ariaLabel="Annotation start" unit="s" value={active.start} min={0} max={active.end-.05} step={.1} onChange={start=>patch({start})}/></div><div className="studio-crop-field"><span className="look-label">End</span><NumberInput ariaLabel="Annotation end" unit="s" value={active.end} min={active.start+.05} max={duration} step={.1} onChange={end=>patch({end})}/></div></div>
      {active.kind==='text'&&<label className="video-annotation-text">Text<textarea maxLength={500} value={active.text} onChange={e=>patch({text:e.target.value})}/><span>Text size</span><NumberInput ariaLabel="Annotation text size" value={active.size*100} min={1} max={20} step={.5} unit="%" onChange={value=>patch({size:value/100})}/></label>}
      <div className="studio-effect-actions"><Button size="sm" icon={Copy} disabled={items.length>=64} onClick={()=>{const copy={...moveAnnotation(active,.03,.03),id:crypto.randomUUID()};commit([...items,copy]);setSelected(copy.id);}}>Duplicate</Button><Button size="sm" icon={Trash2} onClick={()=>{commit(items.filter(a=>a.id!==selected));setSelected(null);}}>Delete</Button></div></>}
    {/* Portal target is the preview's composition box, never the inspector. */}
    <AnnotationPortal hostId={hostId} selected={active&&annotationAt(active,time)?draft??active:undefined} canvasRef={canvas} enabled={!disabled&&(tool!==null||selected!==null)} onPointerDown={e=>{
      if(disabled)return;onPause();const p=point(e);
      if(tool&&items.length<64){const start=Math.min(time,Math.max(0,duration-.1));const item:VideoAnnotation={id:crypto.randomUUID(),kind:tool,start,end:Math.min(duration,start+3),points:[p],color,width,size:.05,text:tool==='text'?'Your text':''};drag.current={point:p,item,move:false};setDraft(item);setSelected(item.id);}
      else if(active&&annotationAt(active,time)){drag.current={point:p,item:active,move:true};setDraft(active);}else return;
      e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
    }} onPointerMove={e=>{const d=drag.current;if(!d)return;const p=point(e);if(d.move)setDraft(moveAnnotation(d.item,p.x-d.point.x,p.y-d.point.y));else setDraft(current=>current&&({...current,points:current.kind==='pen'||current.kind==='highlight'?[...current.points.slice(0,4095),p]:[d.point,p]}));}}
      onPointerUp={e=>{const d=drag.current;if(d&&draft){commit(d.move?items.map(a=>a.id===draft.id?draft:a):[...items,draft]);setTool(null);}drag.current=null;setDraft(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>{drag.current=null;setDraft(null);}}/>
  </ControlDisclosure>;
}
import {createPortal} from 'react-dom';
import type {RefObject,PointerEventHandler} from 'react';
function AnnotationPortal({canvasRef,enabled,hostId,selected,...events}: {selected?:VideoAnnotation;hostId?:string;canvasRef:RefObject<HTMLCanvasElement|null>;enabled:boolean;onPointerDown:PointerEventHandler;onPointerMove:PointerEventHandler;onPointerUp:PointerEventHandler;onPointerCancel:PointerEventHandler}) {
  const [host,setHost]=useState<Element|null>(null);
  const [aspect,setAspect]=useState(16/9);
  useEffect(()=>{
    let current:Element|null=null;let resize:ResizeObserver|null=null;
    const attach=()=>{
      const next=hostId?document.getElementById(hostId):document.querySelector('[data-video-annotation-host]');
      if(next===current)return;resize?.disconnect();current=next;setHost(next);
      if(next){const measure=()=>{const r=next.getBoundingClientRect();if(r.height>0)setAspect(r.width/r.height);};resize=new ResizeObserver(measure);resize.observe(next);measure();}
    };
    attach();const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();resize?.disconnect();};
  },[hostId]);
  const xs=selected?.points.map(p=>p.x)??[],ys=selected?.points.map(p=>p.y)??[];
  return host?createPortal(<>{enabled&&selected&&<div className="video-annotation-selection" style={{left:`${Math.min(...xs)*100}%`,top:`${Math.min(...ys)*100}%`,width:`${Math.max(.01,Math.max(...xs)-Math.min(...xs))*100}%`,height:`${Math.max(.01,Math.max(...ys)-Math.min(...ys))*100}%`}}/>}<canvas ref={canvasRef} width={Math.round(aspect>=1?1280:1280*aspect)} height={Math.round(aspect>=1?1280/aspect:1280)} className={`video-annotation-overlay${enabled?' is-editing':''}`} data-editor-control {...events}/></>,host):null;
}
