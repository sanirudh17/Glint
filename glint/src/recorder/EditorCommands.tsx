import {useEffect,useRef,useState} from 'react';
import './studioPolish.css';
export interface EditorAction {id:string;label:string;run:()=>void;disabled?:boolean}
export function EditorCommands({actions}:{actions:EditorAction[]}){
 const ref=useRef<HTMLDialogElement>(null),[query,setQuery]=useState('');
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(ref.current?.open)ref.current.close();else {setQuery('');ref.current?.showModal();}}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const matching=actions.filter(a=>a.label.toLowerCase().includes(query.toLowerCase()));
 return <dialog ref={ref} className="studio-command-dialog" aria-label="Editor commands" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();ref.current?.close();}}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.currentTarget.close();}}}><h2>Editor commands</h2><input autoFocus aria-label="Search editor actions" placeholder="Search actions…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();}if(e.key==='Enter'){const action=matching.find(a=>!a.disabled);if(action){ref.current?.close();action.run();}}}}/><div className="studio-command-results">{matching.map(a=><button type="button" disabled={a.disabled} key={a.id} onClick={()=>{ref.current?.close();a.run();}}>{a.label}</button>)}{!matching.length&&<p className="look-hint">No matching actions.</p>}</div></dialog>;
}
