import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Check,MoveVertical,Play,Pause} from "../icons";
import {Button} from '../components/ui';
import './scrolling.css';
type Status={active:boolean;ready:boolean;width:number;height:number;strips:number;message:string;atLimit:boolean;autoScrolling:boolean};
export function ScrollController(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const hasStatus=!!status?.active;
  useEffect(()=>{
    if(!hasStatus)return;
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{void invoke('capture_scroll_ready').catch(()=>setError('Could not show capture controls.'));});});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[hasStatus]);
  useEffect(()=>{
    let alive=true;
    const poll=()=>void invoke<Status>('capture_scroll_status').then(s=>{if(alive)setStatus(s);}).catch(()=>{if(alive)setError('Capture status is unavailable. Try Cancel.');});
    poll();const timer=setInterval(poll,350);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const act=async(action:'finish'|'cancel'|'start'|'pause')=>{setBusy(true);try{await invoke('capture_scroll_control',{action});if(action==='start'||action==='pause')setBusy(false);}catch(e){setError(String(e));setBusy(false);}};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void act('cancel');if(e.key==='Enter'&&!(e.target instanceof HTMLElement&&e.target.closest('button,input,select,textarea,[contenteditable]')))void act('finish');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const autoLabel=status?.autoScrolling?'Pause':'Auto-scroll';
  const note=error||status?.message||(status&&status.strips<=1?'Scroll down to begin':'');
  return <section className="scroll-controller" aria-label="Scrolling capture">
    <div className="scroll-controller-head" data-tauri-drag-region>
      <MoveVertical size={16} strokeWidth={1.5} aria-hidden/>
      <strong data-tauri-drag-region>Scrolling capture</strong>
      <span className="scroll-controller-size" data-tauri-drag-region>{status?`${status.width} × ${status.height}`:'Preparing…'}</span>
    </div>
    <p className={`scroll-controller-message${error?' is-error':''}`} role="status" aria-live="polite">{note}</p>
    <div className="scroll-controller-actions">
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act('cancel')}>Cancel</Button>
      <Button size="sm" variant="subtle" icon={status?.autoScrolling?Pause:Play} disabled={busy||!status?.ready||status?.atLimit} onClick={()=>void act(status?.autoScrolling?'pause':'start')}>{autoLabel}</Button>
      <Button size="sm" variant="primary" icon={Check} disabled={busy||!status?.ready} onClick={()=>void act('finish')}>{busy?'Finishing…':'Finish'}</Button>
    </div>
  </section>;
}
