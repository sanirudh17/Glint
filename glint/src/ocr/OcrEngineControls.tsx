import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {Button,Field,Select} from '../components/ui';
import {useAppStore} from '../store/useAppStore';

type Engine='tesseract'|'ppocrv6-small'|'ppocrv6-medium';
const OPTIONS=[{value:'tesseract',label:'Tesseract (built in)'},{value:'ppocrv6-small',label:'PP-OCRv6 Small (recommended)'},{value:'ppocrv6-medium',label:'PP-OCRv6 Medium'}];
/** Functional engine settings using the existing app controls. */
export function OcrEngineControls(){
 const engine=useAppStore(s=>s.settings?.ocr_engine??'tesseract'),setEngine=useAppStore(s=>s.setOcrEngine);
 const [choice,setChoice]=useState<Engine>(engine);
 const [ready,setReady]=useState<Record<string,boolean>>({});
 const [busy,setBusy]=useState(false),[stage,setStage]=useState(''),[percent,setPercent]=useState(0),[error,setError]=useState('');
 useEffect(()=>setChoice(engine),[engine]);
 useEffect(()=>{
  let active=true;
  void Promise.all(['ppocrv6-small','ppocrv6-medium'].map(async id=>[id,await invoke<boolean>('ocr_engine_status',{engine:id})] as const))
   .then(entries=>{if(active)setReady(Object.fromEntries(entries));}).catch(e=>{if(active)setError(String(e));});
  const un=listen<{stage:string;percent:number}>('ocr-engine-progress',e=>{setStage(e.payload.stage);setPercent(e.payload.percent);});
  return()=>{active=false;void un.then(f=>f()).catch(()=>{});};
 },[]);
 const target=choice==='tesseract'?'ppocrv6-small':choice;
 const size=target==='ppocrv6-medium'?'211.3':'108.7';
 async function download(){
  setBusy(true);setPercent(0);setError('');
  try{await invoke('ocr_engine_install',{engine:target});setReady(previous=>({...previous,[target]:true}));await setEngine(target);}
  catch(e){setError(String(e));}finally{setBusy(false);setStage('');}
 }
 return <Field label="Text recognition engine" hint="Small performed best in Glint's screenshot tests. Medium is available for comparison. Review important identifiers; all recognition stays on this device.">
  <Select ariaLabel="Text recognition engine" value={choice} disabled={busy} options={OPTIONS} onChange={value=>{
   const next=value as Engine;setChoice(next);setError('');
   if(next==='tesseract'||ready[next])void setEngine(next);
  }}/>
  {!ready[target]&&<>
   <span className="g-field-hint">Optional download: {size} MiB for the model and CPU runtime. Nothing downloads automatically. No GPU is required.</span>
   {choice!==engine&&<span className="g-field-hint">Download this model to activate it. The current engine remains available.</span>}
   <Button disabled={busy} onClick={()=>void download()}>Download {target==='ppocrv6-small'?'recommended':'Medium'} model</Button>
  </>}
  {busy&&<div role="status"><progress max={100} value={percent} aria-label={stage||'Downloading OCR engine'}/><span>{stage||'Downloading OCR engine'} ({Math.round(percent)}%)</span><Button size="sm" onClick={()=>void invoke('ocr_engine_cancel').catch(e=>setError(String(e)))}>Cancel</Button></div>}
  {error&&<p role="alert" className="look-error">{error}</p>}
 </Field>;
}
