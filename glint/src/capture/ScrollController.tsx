import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {Check,X,MoveVertical,Play,Pause} from 'lucide-react';
import {Button} from '../components/ui';
import './scrolling.css';
type Status={active:boolean;width:number;height:number;strips:number;message:string;atLimit:boolean;autoScrolling:boolean};
export function ScrollController(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [hasAutoStarted,setHasAutoStarted]=useState(false);
  useEffect(()=>{
    let alive=true;
    const poll=()=>void invoke<Status>('capture_scroll_status').then(s=>{if(alive){setStatus(s);if(s.autoScrolling)setHasAutoStarted(true);}}).catch(()=>{if(alive)setError('Capture status is unavailable. Try Cancel.');});
    poll();const timer=setInterval(poll,350);return()=>{alive=false;clearInterval(timer);};
  },[]);
  const act=async(action:'finish'|'cancel'|'start'|'pause')=>{setBusy(true);try{await invoke('capture_scroll_control',{action});if(action==='start'){setHasAutoStarted(true);setBusy(false);}if(action==='pause')setBusy(false);}catch(e){setError(String(e));setBusy(false);}};
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void act('cancel');if(e.key==='Enter'&&!(e.target instanceof HTMLElement&&e.target.closest('button,input,select,textarea,[contenteditable]')))void act('finish');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  return <section className="scroll-controller" aria-label="Scrolling capture">
    <div className="scroll-controller-head" data-tauri-drag-region><MoveVertical size={16} aria-hidden/><strong data-tauri-drag-region>Scrolling capture</strong><span className="scroll-controller-size">{status?`${status.width} × ${status.height} · ${status.strips} strips`:'Preparing…'}</span></div>
    <p className="scroll-controller-message" role="status" aria-live="polite">{error||status?.message||'Select the page and scroll down.'}</p>
    <div className="scroll-controller-actions"><Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={()=>void act('cancel')}>Cancel</Button><Button size="sm" variant="subtle" icon={Check} disabled={busy||!status?.active} onClick={()=>void act('finish')}>{busy?'Finishing…':'Finish'}</Button><Button size="sm" variant="primary" icon={status?.autoScrolling?Pause:Play} disabled={busy||!status?.active||status?.atLimit} onClick={()=>void act(status?.autoScrolling?'pause':'start')}>{status?.autoScrolling?'Pause':hasAutoStarted?'Resume auto-scroll':'Start auto-scroll'}</Button></div>
  </section>;
}
