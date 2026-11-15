import {useAppStore} from '../store/useAppStore';
import {invoke} from '@tauri-apps/api/core';
import {presentEditorFrame} from '../editor/firstFrame';
import {useState,useEffect} from 'react';
import {WindowControls} from '../components/Titlebar';
import './studioPolish.css';
export function SpeakerNotes(){const theme=useAppStore(s=>s.settings?.theme);useEffect(()=>{if(!theme)return;let cancelled=false;void presentEditorFrame(()=>invoke('speaker_notes_present'),()=>cancelled).catch(()=>{});return()=>{cancelled=true;};},[theme]);const [notes,setNotes]=useState(()=>localStorage.getItem('glint-speaker-notes')??''),[error,setError]=useState('');return <section className="speaker-notes"><header data-tauri-drag-region><h1>Speaker notes</h1><WindowControls/></header><p>This window is excluded from Windows screen capture. Notes stay on this device.</p><textarea aria-label="Speaker notes" maxLength={20000} placeholder="Write the points you want to cover…" value={notes} onChange={e=>{setNotes(e.target.value);try{localStorage.setItem('glint-speaker-notes',e.target.value);setError('');}catch{setError('Notes could not be saved on this device.');}}}/>{error&&<p role="alert">{error}</p>}</section>;}
