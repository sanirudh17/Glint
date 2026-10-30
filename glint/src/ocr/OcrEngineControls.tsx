import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {Button,Field,Select} from '../components/ui';
import {useAppStore} from '../store/useAppStore';

type Engine='tesseract'|'ppocrv6-small'|'ppocrv6-medium';
const OPTIONS=[{value:'tesseract',label:'Tesseract (English)'},{value:'ppocrv6-small',label:'PP-OCRv6 Small (recommended)'},{value:'ppocrv6-medium',label:'PP-OCRv6 Medium'}];
const SIZES:Record<Engine,string>={tesseract:'55.3','ppocrv6-small':'108.7','ppocrv6-medium':'211.3'};
/** Explicit, reversible engine downloads. Selecting a missing model never downloads it. */
export function OcrEngineControls(){
 const engine=useAppStore(s=>s.settings?.ocr_engine??'tesseract'),setEngine=useAppStore(s=>s.setOcrEngine);
 const [choice,setChoice]=useState<Engine>(engine),[ready,setReady]=useState<Record<string,boolean>>({});
 const [busy,setBusy]=useState<'install'|'remove'|null>(null),[stage,setStage]=useState(''),[percent,setPercent]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>setChoice(engine),[engine]);
 useEffect(()=>{
  let active=true;
  const refresh=()=>void Promise.all(OPTIONS.map(async ({value})=>[value,await invoke<boolean>('ocr_engine_status',{engine:value})] as const))
   .then(entries=>{if(active)setReady(Object.fromEntries(entries));}).catch(e=>{if(active)setError(String(e));});
  refresh();
  const progress=listen<{stage:string;percent:number}>('ocr-engine-progress',e=>{if(active){setStage(e.payload.stage);setPercent(e.payload.percent);}});
  const changed=listen('ocr-engine-changed',refresh);
  return()=>{active=false;void progress.then(f=>f()).catch(()=>{});void changed.then(f=>f()).catch(()=>{});};
 },[]);
 async function install(){
  const target=choice;setBusy('install');setPercent(0);setStage('Downloading OCR engine');setError('');setNotice('');
  try{
   await invoke('ocr_engine_install',{engine:target});setReady(previous=>({...previous,[target]:true}));await setEngine(target);
   setNotice('Installed. This engine is ready to use.');
   void invoke('library_index_start').catch(()=>{});
  }catch(e){setError(String(e));}finally{setBusy(null);setStage('');}
 }
 async function remove(){
  const target=choice;setBusy('remove');setError('');setNotice('');
  try{
   const result=await invoke<{pendingRestart:boolean}>('ocr_engine_remove',{engine:target});
   setReady(previous=>({...previous,[target]:false}));
   setNotice(result.pendingRestart?'Model removed. Restart Glint to finish deleting the loaded runtime.':'Removed from disk. You can install it again whenever you need it.');
  }catch(e){setError(String(e));}finally{setBusy(null);}
 }
 const installed=ready[choice],known=installed!==undefined;
 return <Field label="Text recognition engine" hint="No OCR engine is bundled. Install only the engines you want; recognition runs on this device. Small performed best in Glint’s screenshot tests. Review important identifiers.">
  <div className="ocr-engine-row">
   <Select ariaLabel="Text recognition engine" value={choice} disabled={!!busy} options={OPTIONS} onChange={value=>{
    const next=value as Engine;setChoice(next);setError('');setNotice('');
    if(ready[next])void setEngine(next);
   }}/>
   <Button disabled={!!busy||!known} aria-label={installed?'Remove selected OCR engine from disk':'Install selected OCR engine'} onClick={()=>void (installed?remove():install())}>
    {busy==='remove'?'Removing...':busy==='install'?'Installing...':!known?'Checking...':installed?'Remove from disk':'Install'}
   </Button>
  </div>
  {known&&<span className="g-field-hint">{installed?'Installed on this device.':`${SIZES[choice]} MiB download, including the CPU runtime. Nothing downloads until you press Install.`}</span>}
  {choice!==engine&&known&&!installed&&<span className="g-field-hint">Install to use this engine. Your current selection stays active until then.</span>}
  {known&&!installed&&choice===engine&&<span className="g-field-hint">Install this engine to use Capture Text, sensitive-text review and screenshot text indexing.</span>}
  {busy==='install'&&<div className="ocr-engine-progress" role="status"><progress max={100} value={percent} aria-label={stage||'Downloading OCR engine'}/><span>{stage} ({Math.round(percent)}%)</span><Button size="sm" onClick={()=>void invoke('ocr_engine_cancel').catch(e=>setError(String(e)))}>Cancel</Button></div>}
  {notice&&<p role="status" className="g-field-hint">{notice}</p>}
  {error&&<p role="alert" className="look-error">{error}</p>}
 </Field>;
}
