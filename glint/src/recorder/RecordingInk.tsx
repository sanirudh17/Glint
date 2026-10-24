import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {annotationAt,paintAnnotation,type VideoAnnotation,type AnnotationTool} from './videoAnnotations';
import './recordingInk.css';
export interface InkConfig {tool:AnnotationTool|null;color:string;width:number;text:string}
export const DEFAULT_INK:InkConfig={tool:null,color:'#ef5555',width:.006,text:'Text'};
interface InkState {config:InkConfig;items:VideoAnnotation[];time:number;paused:boolean}
export function RecordingInk(){
  const [config,setConfig]=useState(DEFAULT_INK),[error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null),items=useRef<VideoAnnotation[]>([]),draft=useRef<VideoAnnotation|null>(null);
  const beginning=useRef<Promise<number>|null>(null),clock=useRef({time:0,paused:true,at:performance.now()});
  const pulse=useRef<{x:number;y:number;at:number}|null>(null);
  useEffect(()=>{
    const sync=(state:{time:number;paused:boolean})=>{clock.current={...state,at:performance.now()};};
    const load=()=>void invoke<InkState>('recorder_ink_state').then(s=>{setConfig(s.config);items.current=s.items;sync(s);}).catch(()=>{});
    load();const timer=setInterval(()=>void invoke<{time:number;paused:boolean}>('recorder_ink_clock').then(sync).catch(()=>{}),500);
    const listeners=[listen<InkConfig>('recorder-ink-mode',e=>{setConfig(e.payload);draft.current=null;setError('');}),listen<VideoAnnotation[]>('recorder-ink-items',e=>{items.current=e.payload;}),listen<{x:number;y:number;left:number;top:number;width:number;height:number}>('recorder-ink-mark',e=>{pulse.current={x:(e.payload.x-e.payload.left)/e.payload.width,y:(e.payload.y-e.payload.top)/e.payload.height,at:performance.now()};}),listen('recorder-paused',load),listen('recorder-resumed',load)];
    let raf=0;const paint=()=>{const node=canvas.current;if(node){const scale=devicePixelRatio||1;const w=Math.round(innerWidth*scale),h=Math.round(innerHeight*scale);if(node.width!==w||node.height!==h){node.width=w;node.height=h;}const ctx=node.getContext('2d')!;ctx.clearRect(0,0,w,h);const c=clock.current,time=c.time+(c.paused?0:(performance.now()-c.at)/1000);for(const a of items.current)if(annotationAt(a,time))paintAnnotation(ctx,a,w,h);if(draft.current)paintAnnotation(ctx,draft.current,w,h);const p=pulse.current,age=p?(performance.now()-p.at)/1000:2;if(p&&age<.9){ctx.save();ctx.globalAlpha=1-age/.9;ctx.strokeStyle='#29aeb0';ctx.lineWidth=2*scale;ctx.beginPath();ctx.arc(p.x*w,p.y*h,(16+age*12)*scale,0,Math.PI*2);ctx.stroke();ctx.restore();}}raf=requestAnimationFrame(paint);};paint();
    return()=>{clearInterval(timer);cancelAnimationFrame(raf);listeners.forEach(p=>void p.then(un=>un()));};
  },[]);
  const exit=()=>void invoke('recorder_ink_mode',{config:{...config,tool:null}}).catch(e=>setError(String(e)));
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();draft.current=null;exit();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[config]);
  const point=(e:PointerEvent<HTMLCanvasElement>)=>{const r=e.currentTarget.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  return <div className={`recording-ink${config.tool?' is-drawing':''}`} role="application" aria-label="Live recording annotations">
    {config.tool&&<div className="recording-ink-hint">Draw {config.tool} · Esc to return to recording</div>}
    {error&&<div className="recording-ink-error" role="alert">{error}</div>}
    <canvas ref={canvas} aria-label="Draw on the recording" onPointerDown={e=>{
      if(!config.tool)return;setError('');const p=point(e);beginning.current=invoke<number>('recorder_ink_begin');void beginning.current.catch(error=>{setError(String(error));draft.current=null;});
      const c=clock.current,start=c.time+(c.paused?0:(performance.now()-c.at)/1000);
      draft.current={id:crypto.randomUUID(),kind:config.tool,start,end:start+3,points:[p],color:config.color,width:config.width,size:.05,text:config.tool==='text'?config.text:''};
      e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e=>{const a=draft.current;if(!a)return;const p=point(e);a.points=a.kind==='pen'||a.kind==='highlight'?[...a.points.slice(0,4095),p]:[a.points[0],p];}}
    onPointerUp={e=>{const a=draft.current,started=beginning.current;draft.current=null;beginning.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(a&&started)void started.then(start=>invoke('recorder_ink_commit',{annotation:{...a,start}})).catch(error=>setError(String(error)));}}
    onPointerCancel={()=>{draft.current=null;beginning.current=null;}}/>
  </div>;
}
