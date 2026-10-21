import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {confirm} from '@tauri-apps/plugin-dialog';
import {Button,ControlDisclosure,NumberInput,Switch} from '../components/ui';
import type {StudioProject,StudioEvents} from './studioModel';
import {activitySpans,editSpans,type Caption} from './studioPolish';
import './studioPolish.css';
export function StudioPolishControls({project,events,path,duration,onChange}:{project:StudioProject;events:StudioEvents;path:string;duration:number;onChange:(patch:Partial<StudioProject>,action?:string)=>void}){
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
 const [quiet,setQuiet]=useState<{start:number;end:number}[]|null>(null);
 useEffect(()=>{void invoke<boolean>('studio_captions_status').then(setReady).catch(()=>{});const p=listen<{stage:string;percent:number}>('studio-polish-progress',e=>setStatus(e.payload.stage));return()=>{void p.then(un=>un());};},[]);
 const run=async(task:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await task();}catch(e){setError(String(e));}finally{setBusy(false);setStatus('');}};
 const apply=(spans:{start:number;end:number}[],operation:'remove'|'speed',label:string)=>{if(!spans.length){setError('No matching activity was found in this recording.');return;}const clips=editSpans(project.clips,spans,operation);if(!clips.some(c=>c.kept)){setError('Keep at least one part of the recording.');return;}onChange({clips},label);};
 const cleanup=project.audioCleanup??{denoise:false,level:false,clickSounds:false};
 const captions=project.captions??[];
 return <section className="studio-polish" aria-label="Recording polish">
  <ControlDisclosure title="Timing & audio">
   <p className="look-hint">Timing edits keep the original recording. Undo restores the previous cuts.</p>
   <div className="studio-polish-actions"><Button size="sm" disabled={busy||!events.events.length} onClick={()=>apply(activitySpans(events.events,duration,'idle'),'speed','Speed up idle time')}>Speed up idle time</Button><Button size="sm" disabled={busy||!events.events.some(e=>e.kind==='key')} onClick={()=>apply(activitySpans(events.events,duration,'typing'),'speed','Speed up typing')}>Speed up typing</Button></div>
   <Button size="sm" disabled={busy||duration>1800} title={duration>1800?'Audio analysis supports recordings up to 30 minutes.':undefined} onClick={()=>void run(async()=>{setStatus('Reading local audio');setQuiet(await invoke('studio_analyze_silence',{path}));})}>Find silent stretches</Button>
   {quiet&&<div className="studio-polish-review"><p className="look-hint">{quiet.length} quiet {quiet.length===1?'span':'spans'} found. Review these before removing any video.</p><div className="studio-quiet-spans">{quiet.map((span,i)=><span key={i}>{span.start.toFixed(1)}–{span.end.toFixed(1)} s</span>)}</div><Button size="sm" disabled={busy||!quiet.length} onClick={()=>{apply(quiet,'remove','Remove silent stretches');setQuiet(null);}}>Remove quiet spans</Button></div>}
   {(['denoise','level','clickSounds'] as const).map(key=><div className="look-row" key={key}><span className="look-label">{{denoise:'Reduce background noise',level:'Level audio volume',clickSounds:'Click sounds'}[key]}</span><Switch ariaLabel={{denoise:'Reduce background noise',level:'Level audio volume',clickSounds:'Click sounds'}[key]} checked={cleanup[key]} onChange={value=>onChange({audioCleanup:{...cleanup,[key]:value}})}/></div>)}
   <p className="look-hint">Audio cleanup and click sounds apply to MP4 export. GIFs have no audio.</p>
  </ControlDisclosure>
  <ControlDisclosure title="Local captions">
   <p className="look-hint">English captions use Whisper tiny.en on this device. Review names and technical words before exporting.</p>
   {!ready?<><p className="look-hint">Optional download: 77.8 MiB total (74.1 MiB model + 3.7 MiB CPU runtime). Audio is never uploaded. Nothing downloads until you choose below.</p><Button size="sm" disabled={busy} onClick={()=>void run(async()=>{await invoke('studio_captions_install');setReady(true);})}>Download caption engine</Button></>:<Button size="sm" disabled={busy||duration>1800} onClick={()=>void run(async()=>{if(captions.length&&!await confirm('Replace the current caption text with a new local transcription?',{title:'Generate captions',kind:'warning'}))return;const generated=await invoke<Caption[]>('studio_captions_generate',{path,duration});onChange({captions:generated,captionsEnabled:true});})}>{captions.length?'Regenerate captions':'Generate captions'}</Button>}
   {captions.length>0&&<><div className="look-row"><span className="look-label">Show captions</span><Switch ariaLabel="Show captions" checked={project.captionsEnabled??false} onChange={captionsEnabled=>onChange({captionsEnabled})}/></div><div className="studio-caption-list">{captions.filter(c=>project.clips.some(clip=>clip.kept&&c.start<clip.end&&c.end>clip.start)).map(c=><div className="studio-caption-line" key={c.id}><label className="studio-caption-text">Caption text<textarea aria-label={`Caption ${c.id} text`} maxLength={300} rows={2} value={c.text} onChange={e=>onChange({captions:captions.map(line=>line.id===c.id?{...line,text:e.target.value,raster:undefined}:line)})}/></label><div className="studio-caption-times"><NumberInput ariaLabel={`Caption ${c.id} start`} value={c.start} min={0} max={c.end-.05} step={.05} unit="s" onChange={start=>onChange({captions:captions.map(line=>line.id===c.id?{...line,start}:line)})}/><NumberInput ariaLabel={`Caption ${c.id} end`} value={c.end} min={c.start+.05} max={duration} step={.05} unit="s" onChange={end=>onChange({captions:captions.map(line=>line.id===c.id?{...line,end}:line)})}/></div><Button size="sm" onClick={()=>void confirm(`Remove ${c.start.toFixed(1)}–${c.end.toFixed(1)} seconds from the video and delete this caption? The original recording is kept.`,{title:'Remove caption and video span',kind:'warning'}).then(ok=>{if(!ok)return;const clips=editSpans(project.clips,[c],'remove');if(!clips.some(c=>c.kept)){setError('Keep at least one part of the recording.');return;}onChange({clips},'Remove caption span');})}>Remove line & video span</Button></div>)}</div></>}
  </ControlDisclosure>
  <ControlDisclosure title="Speaker notes"><p className="look-hint">Open a separate notes window that Windows excludes from screen capture.</p><Button size="sm" onClick={()=>void run(async()=>{await invoke('studio_speaker_notes');})}>Open speaker notes</Button></ControlDisclosure>
  {busy&&<div className="studio-polish-progress" role="status"><progress aria-label={status||'Working locally'}/><span>{status||'Working locally…'}</span><Button size="sm" onClick={()=>void invoke('studio_polish_cancel')}>Cancel</Button></div>}
  {error&&<p className="look-error" role="alert">{error}</p>}
 </section>;
}
