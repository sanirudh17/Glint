import {useState} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {Button} from '../components/ui';
import './studioPolish.css';
export function SpeakerNotes(){const [notes,setNotes]=useState(()=>localStorage.getItem('glint-speaker-notes')??''),[error,setError]=useState('');return <section className="speaker-notes"><header data-tauri-drag-region><h1>Speaker notes</h1><Button size="sm" onClick={()=>void getCurrentWindow().close()}>Close</Button></header><p>This window is excluded from Windows screen capture. Notes stay on this device.</p><textarea aria-label="Speaker notes" maxLength={20000} placeholder="Write the points you want to cover…" value={notes} onChange={e=>{setNotes(e.target.value);try{localStorage.setItem('glint-speaker-notes',e.target.value);setError('');}catch{setError('Notes could not be saved on this device.');}}}/>{error&&<p role="alert">{error}</p>}</section>;}
