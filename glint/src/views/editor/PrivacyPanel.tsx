import {useEffect,useRef,useState,type RefObject} from 'react';
import type Konva from 'konva';
import {invoke} from '@tauri-apps/api/core';
import {useEditorStore} from '../../editor/useEditorStore';
import {DEFAULT_STYLE,newId} from '../../editor/model';
import {privacyScanImage,type PrivacySuggestion} from '../../editor/privacy';

export function PrivacyPanel({stageRef,suggestions,onSuggestions}:{stageRef:RefObject<Konva.Stage|null>;suggestions:PrivacySuggestion[];onSuggestions:(s:PrivacySuggestion[])=>void}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),request=useRef('');
  const base=useEditorStore(s=>s.base);
  const annotations=useEditorStore(s=>s.annotations),crop=useEditorStore(s=>s.crop),canvasSize=useEditorStore(s=>s.canvasSize);
  const contentKey=JSON.stringify([annotations.filter(a=>a.type!=='redact'),crop,canvasSize]);
  const cancel=()=>{const requestId=request.current;request.current='';setBusy(false);setMessage('Scan cancelled.');if(requestId)void invoke('privacy_cancel',{requestId});};
  useEffect(()=>{onSuggestions([]);setMessage('');setBusy(false);return()=>{const requestId=request.current;request.current='';if(requestId)void invoke('privacy_cancel',{requestId});};},[base,contentKey]);
  const scan=async()=>{
    if(!stageRef.current)return;const requestId=crypto.randomUUID();request.current=requestId;setBusy(true);setMessage('Reading screenshot text on this device…');onSuggestions([]);
    try{
      const image=privacyScanImage(stageRef.current);
      const found=await invoke<PrivacySuggestion[]>('privacy_scan',{pngBase64:image.pngBase64,requestId});
      if(request.current!==requestId)return;
      onSuggestions(found.map(s=>({...s,x:image.x+s.x/image.scaleX,y:image.y+s.y/image.scaleY,w:s.w/image.scaleX,h:s.h/image.scaleY})));
      setMessage(found.length?`${found.length} possible ${found.length===1?'item':'items'} to review.`:'No sensitive text found. Check the image before sharing.');
    }catch(error){if(request.current===requestId)setMessage(String(error));}
    finally{if(request.current===requestId){request.current='';setBusy(false);}}
  };
  const accept=(items:PrivacySuggestion[])=>{
    const s=useEditorStore.getState();s.pushHistory();
    for(const item of items)s.add({id:newId(),type:'redact',z:0,x:item.x,y:item.y,w:item.w,h:item.h,style:{...DEFAULT_STYLE,color:'#111111',redactStyle:'solid'}});
    s.setTool('select');onSuggestions(suggestions.filter(v=>!items.includes(v)));
    setMessage(`${items.length} ${items.length===1?'redaction':'redactions'} added. Undo restores the prior image.`);
  };
  return <aside className="frame-panel privacy-panel" aria-label="Privacy review" data-editor-control>
    <h3 className="studio-section-title">Privacy review</h3>
    <p className="look-hint">Find possible emails, cards, phone numbers, IP addresses and keys. Nothing is covered until you accept it.</p>
    <button className="g-btn g-btn-subtle" disabled={busy||!base} onClick={()=>void scan()}>Scan sensitive text</button>
    {busy&&<button className="g-btn g-btn-subtle g-btn-sm" onClick={cancel}>Cancel scan</button>}
    <p className="look-hint" role="status" aria-live="polite">{message}</p>
    {suggestions.length>0&&<><button className="g-btn g-btn-primary" onClick={()=>accept(suggestions)}>Redact all {suggestions.length}</button>
      <ul className="privacy-suggestions-list">{suggestions.map((s,i)=><li key={`${s.kind}-${s.x}-${s.y}-${i}`}><span>{s.kind}</span><button className="g-btn g-btn-subtle g-btn-sm" aria-label={`Redact ${s.kind} ${i+1}`} onClick={()=>accept([s])}>Redact</button></li>)}</ul>
      <button className="g-btn g-btn-subtle g-btn-sm" onClick={()=>{onSuggestions([]);setMessage('Suggestions dismissed.');}}>Dismiss suggestions</button></>}
    <p className="look-hint">Review every suggestion. OCR can miss text or flag ordinary numbers.</p>
    <p className="privacy-sharing-note">Share the exported image. Editable .glint projects keep the original pixels. Solid redaction is the safest choice for secrets; blur and pixelation can leave clues.</p>
  </aside>;
}
