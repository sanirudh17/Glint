import {VideoAnnotationEditor} from "./VideoAnnotationEditor";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useBlocker,useSearchParams} from 'react-router-dom';
import {convertFileSrc,invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {open,save,confirm} from '@tauri-apps/plugin-dialog';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import {ArrowDown,ArrowUp,FolderOpen,ImagePlus,Play,Pause,Plus,Save,Trash2,Type,Undo2,Redo2} from 'lucide-react';
import {Button,ColorControl,ControlDisclosure,NumberInput,Select} from '../components/ui';
import {LookControls} from '../look/LookControls';
import {hydrateLook} from '../look/model';
import {StudioPreview} from './StudioPreview';
import {activeScenes,emptySceneProject,newScene,prepareSceneProject,projectSeconds,reorderScene,sceneSeconds,sceneStudio,sceneTimeline,titleRaster,type Scene,type SceneMedia,type SceneProject} from './sceneModel';
import '../look/look.css';
import './sceneProject.css';
import {ENTRANCES,estimateExportBytes,type Entrance} from './studioPolish';
import {EditorCommands} from './EditorCommands';
import {useAppStore} from '../store/useAppStore';

const DRAFT='glint-scene-project-draft-v1';
const seconds=(n:number)=>`${n.toFixed(1)}s`;
const name=(s:Scene)=>s.kind==='title'?s.title:s.media?.path.split(/[\\/]/).slice(-1)[0]??'Media';
function restore():{project:SceneProject;path:string;dirty:boolean}{try{const d=JSON.parse(localStorage.getItem(DRAFT)??'null');if(d?.project?.version===1&&Array.isArray(d.project.scenes))return d;}catch{/* Fresh project if a draft is unreadable. */}return {project:emptySceneProject(),path:'',dirty:false};}
export function VideoProjectView(){
 const [query]=useSearchParams();const initial=useMemo(restore,[]);
 const [project,setProject]=useState(initial.project),[path,setPath]=useState(initial.path),[dirty,setDirty]=useState(initial.dirty);
 const [selected,setSelected]=useState<string|null>(initial.project.scenes[0]?.id??null);
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false);
 const [error,setError]=useState<string|null>(null),[draftError,setDraftError]=useState(false),[exported,setExported]=useState(''),[progress,setProgress]=useState(0);
 const [undo,setUndo]=useState<{project:SceneProject;action:string}[]>([]),[redo,setRedo]=useState<{project:SceneProject;action:string}[]>([]);
 const [panel,setPanel]=useState<'scenes'|'scene'|'look'>('scenes');
 const current=useRef(project);current.current=project;
 const timeRef=useRef(time);timeRef.current=time;
 const total=projectSeconds(project),scene=project.scenes.find(s=>s.id===selected)??project.scenes[0];
 // Internal navigation keeps the local draft. Only block when leaving would
 // lose an unstored draft or hide an active export.
 const blocker=useBlocker(exporting||(dirty&&draftError));
 const change=useCallback((next:SceneProject,action='Change project look')=>{setUndo(h=>[...h.slice(-29),{project:current.current,action}]);setRedo([]);setProject(next);setTime(t=>Math.min(t,projectSeconds(next)));setDirty(true);setPlaying(false);setExported('');},[]);
 useEffect(()=>{try{localStorage.setItem(DRAFT,JSON.stringify({project:{...project,scenes:project.scenes.map(s=>({...s,raster:null}))},path,dirty}));setDraftError(false);}catch{setDraftError(true);}},[project,path,dirty]);
 useEffect(()=>{const fn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',fn);return()=>window.removeEventListener('beforeunload',fn);},[dirty]);
 useEffect(()=>{const p=listen<number>('video-project-progress',e=>setProgress(e.payload));return()=>{void p.then(un=>un());};},[]);
 const undoEdit=()=>{const entry=undo[undo.length-1];if(!entry)return;setRedo(h=>[...h,{project,action:entry.action}]);setProject(entry.project);setTime(t=>Math.min(t,projectSeconds(entry.project)));setUndo(h=>h.slice(0,-1));setDirty(true);setPlaying(false);setExported('');useAppStore.getState().pushToast(`Undid: ${entry.action}`);};
 const redoEdit=()=>{const entry=redo[redo.length-1];if(!entry)return;setUndo(h=>[...h,{project,action:entry.action}]);setProject(entry.project);setTime(t=>Math.min(t,projectSeconds(entry.project)));setRedo(h=>h.slice(0,-1));setDirty(true);setPlaying(false);setExported('');useAppStore.getState().pushToast(`Redid: ${entry.action}`);};
 const load=useCallback(async(p:string)=>{setBusy(true);setError(null);try{const doc=await invoke<SceneProject>('scene_project_load',{path:p});setProject({...doc,look:hydrateLook(doc.look)});setPath(p);setSelected(doc.scenes[0]?.id??null);setTime(0);setPlaying(false);setDirty(false);setUndo([]);setRedo([]);}catch(e){setError(String(e));}finally{setBusy(false);}},[]);
 const queryPath=query.get('path');
 useEffect(()=>{if(queryPath&&!(initial.dirty&&initial.path===queryPath))void load(queryPath);},[queryPath,load]);
 const addMedia=useCallback(async(paths:string[])=>{if(!paths.length)return;setBusy(true);setError(null);setPlaying(false);try{if(current.current.scenes.length+paths.length>32)throw Error('A project can contain at most 32 scenes.');const media:SceneMedia[]=[];for(const p of paths)media.push(await invoke<SceneMedia>('scene_media_probe',{path:p}));const added=media.map(m=>newScene(m));change({...current.current,scenes:[...current.current.scenes,...added]},'Add media');setSelected(added[0]?.id??null);}catch(e){setError(String(e));}finally{setBusy(false);}},[change]);
 useEffect(()=>{const p=getCurrentWebview().onDragDropEvent(e=>{if(e.payload.type==='drop'&&!busy&&!exporting)void addMedia(e.payload.paths);});return()=>{void p.then(un=>un()).catch(()=>{});};},[addMedia,busy,exporting]);
 useEffect(()=>{if(!playing)return;let raf=0;const start=performance.now()-timeRef.current*1000;const tick=()=>{const t=(performance.now()-start)/1000;setTime(Math.min(total,t));if(t>=total){setPlaying(false);return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);},[playing,total]);
 const select=(s:Scene)=>{setSelected(s.id);setPlaying(false);const row=sceneTimeline(project).find(v=>v.scene.id===s.id);setTime(row?row.start+row.overlap:0);};
 const move=(id:string,direction:-1|1)=>{const next=reorderScene(project,id,direction);change(next,'Reorder scene');setSelected(id);const row=sceneTimeline(next).find(r=>r.scene.id===id);setTime(row?row.start+row.overlap:0);};
 const remove=(id:string)=>{const index=project.scenes.findIndex(s=>s.id===id);const next={...project,scenes:project.scenes.filter(s=>s.id!==id)};change(next,'Remove scene');const replacement=next.scenes[Math.min(index,next.scenes.length-1)];setSelected(replacement?.id??null);const row=sceneTimeline(next).find(r=>r.scene.id===replacement?.id);setTime(row?row.start+row.overlap:0);};
 const patch=(patch:Partial<Scene>)=>{if(scene){const next={...project,scenes:project.scenes.map(s=>s.id===scene.id?{...s,...patch,raster:null}:s)};change(next,'Change '+(Object.keys(patch)[0]??'scene'));const row=sceneTimeline(next).find(r=>r.scene.id===scene.id);if(!('annotations' in patch))setTime(row?row.start+row.overlap:0);}};
 const saveProject=async()=>{setError(null);setPlaying(false);try{const p=path||await save({defaultPath:'Untitled.glint-video',filters:[{name:'Glint video project',extensions:['glint-video']}]});if(!p)return false;const ready=await prepareSceneProject(project);await invoke('scene_project_save',{path:p,project:ready});setPath(p);setDirty(false);return true;}catch(e){setError(String(e));return false;}};
 const exportProject=async()=>{setPlaying(false);setError(null);setExported('');try{const output=await save({defaultPath:'Glint project.mp4',filters:[{name:'MP4 video',extensions:['mp4']}]});if(!output)return;setExporting(true);setProgress(0);const ready=await prepareSceneProject(project);setExported(await invoke<string>('scene_project_export',{project:ready,output}));}catch(e){setError(String(e));}finally{setExporting(false);}};
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!busy&&!exporting&&project.scenes.length)void saveProject();}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);});
 return <div className="video-project" aria-label="Video project editor">
  <EditorCommands actions={[
   {id:'save',label:'Save video project',run:()=>void saveProject(),disabled:busy||exporting||!project.scenes.length},
   {id:'export',label:'Export MP4',run:()=>void exportProject(),disabled:busy||exporting||!project.scenes.length},
   {id:'undo',label:undo.length?`Undo: ${undo[undo.length-1].action}`:'Undo',run:undoEdit,disabled:busy||exporting||!undo.length},
   {id:'redo',label:redo.length?`Redo: ${redo[redo.length-1].action}`:'Redo',run:redoEdit,disabled:busy||exporting||!redo.length},
   {id:'scene',label:'Show scene settings',run:()=>setPanel('scene')},
   {id:'look',label:'Show look and canvas settings',run:()=>setPanel('look')},
   {id:'scenes',label:'Show scene order',run:()=>setPanel('scenes')},
   {id:'play',label:playing?'Pause project':'Play project',run:()=>{if(time>=total)setTime(0);setPlaying(p=>!p);},disabled:busy||exporting||!project.scenes.length},
  ]}/>
  <header className="video-project-header"><div><h1>Video project</h1><p title={path}>{path?path.split(/[\\/]/).slice(-1)[0]:'Untitled project'}{dirty?(draftError?' · Unsaved changes':' · Draft kept on this device'):''}</p></div>
   <div className="video-project-actions"><Button icon={Plus} disabled={busy||exporting} onClick={async()=>{if(dirty&&!await confirm('Start a new project? Unsaved changes will be replaced.',{title:'New video project',kind:'warning'}))return;setProject(emptySceneProject());setPath('');setSelected(null);setDirty(false);setTime(0);setPlaying(false);setUndo([]);setRedo([]);setError(null);setExported('');}}>New</Button><Button disabled={busy||exporting} icon={FolderOpen} onClick={async()=>{if(dirty&&!await confirm('Open another project? Unsaved changes will be replaced.',{title:'Open video project',kind:'warning'}))return;const p=await open({filters:[{name:'Glint video project',extensions:['glint-video']}]});if(typeof p==='string')void load(p);}}>Open</Button>
   <Button icon={Save} disabled={busy||exporting||!project.scenes.length} onClick={()=>void saveProject()}>Save</Button><Button variant="primary" disabled={busy||exporting||!project.scenes.length} onClick={()=>void exportProject()}>Export video</Button></div>
  </header>
  {error&&<p className="video-project-error" role="alert">{error}</p>}
  {draftError&&<p className="video-project-error" role="alert">The draft could not be stored. Save your project before leaving.</p>}
  {blocker.state==='blocked'&&<div className="video-project-notice" role="alert"><span>{exporting?'Cancel export before leaving.':'Your draft could not be stored. Save before leaving.'}</span>{!exporting&&<Button size="sm" onClick={()=>void saveProject().then(ok=>{if(ok)blocker.proceed?.();})}>Save and leave</Button>}<Button size="sm" onClick={()=>blocker.reset?.()}>Stay</Button></div>}
  {exporting&&<div className="video-project-notice" role="status"><progress value={progress} max={100} aria-label="Video export progress"/><span>{Math.floor(progress)}%</span><Button size="sm" onClick={()=>void invoke('studio_export_cancel')}>Cancel export</Button></div>}
  {exported&&<div className="video-project-notice" role="status"><span>Export complete · {exported.split(/[\\/]/).slice(-1)[0]}</span><Button size="sm" onClick={()=>void invoke('reveal_path',{path:exported}).catch(e=>setError(String(e)))}>Show in folder</Button><Button size="sm" onClick={()=>void invoke('studio_copy_video',{path:exported}).catch(e=>setError(String(e)))}>Copy video file</Button></div>}
  <div className="video-project-workspace" data-panel={panel}><section className="video-project-main" aria-label="Scene preview and order">
   <div className="video-project-monitor">
   {project.scenes.length?<><div className="video-project-preview" style={{'--scene-ratio':project.width/project.height,aspectRatio:`${project.width}/${project.height}`,width:`min(100%, ${320*project.width/project.height}px, ${32*project.width/project.height}vh)`} as React.CSSProperties}><ScenePlayback project={project} time={time} playing={playing}/></div>
   <div className="video-project-transport"><Button size="sm" aria-label={playing?'Pause project':'Play project'} disabled={busy||exporting} icon={playing?Pause:Play} onClick={()=>{if(time>=total)setTime(0);setPlaying(p=>!p);}}>{playing?'Pause':'Play'}</Button><input type="range" min={0} max={total} step={1/30} value={Math.min(time,total)} aria-label="Project playhead" onChange={e=>{setPlaying(false);setTime(Number(e.target.value));}}/><span>{seconds(time)} / {seconds(total)}</span></div></>:<div className="video-project-empty"><h2>Build a video from your clips</h2><p>Add recordings or images, then arrange scenes below. Every scene uses the same Studio look.</p><p>Drop files here or choose Add media.</p></div>}
   </div><div className="video-project-sequence">
   <div className="video-project-scene-tools"><Button size="sm" icon={ImagePlus} disabled={busy||exporting} onClick={async()=>{const paths=await open({multiple:true,filters:[{name:'Videos and images',extensions:['mp4','mov','mkv','webm','avi','m4v','wmv','png','jpg','jpeg','webp','bmp']}]});if(paths)void addMedia(Array.isArray(paths)?paths:[paths]);}}>{busy?'Loading…':'Add media'}</Button>
   <Button size="sm" icon={Type} disabled={busy||exporting||project.scenes.length>=32} onClick={()=>{const s=newScene();change({...project,scenes:[...project.scenes,s]},'Add title card');setSelected(s.id);setTime(total);}}>Title card</Button>
   <span className="video-project-history"><Button size="sm" aria-label="Undo scene edit" icon={Undo2} disabled={!undo.length||exporting||busy} title={undo.length?`Undo: ${undo[undo.length-1].action}`:'Undo'} onClick={undoEdit}/><Button size="sm" aria-label="Redo scene edit" icon={Redo2} disabled={!redo.length||exporting||busy} title={redo.length?`Redo: ${redo[redo.length-1].action}`:'Redo'} onClick={redoEdit}/></span></div>
   <ol className="video-project-scenes" aria-label="Scenes in export order">{project.scenes.map((s,i)=><li key={s.id} className={scene?.id===s.id?'is-selected':''}><button className="video-project-scene-select" aria-pressed={scene?.id===s.id} onClick={()=>select(s)}><span className="video-project-scene-number">{i+1}</span><span><strong title={name(s)}>{name(s)}</strong><small>{s.kind==='title'?'Title card':s.kind==='image'?'Image':'Video'} · {seconds(sceneSeconds(s))}{i>0?` · ${s.transition.kind}`:''}</small></span></button><div><Button size="sm" aria-label={`Move scene ${i+1} earlier`} icon={ArrowUp} disabled={i===0||busy||exporting} onClick={()=>move(s.id,-1)}/><Button size="sm" aria-label={`Move scene ${i+1} later`} icon={ArrowDown} disabled={i===project.scenes.length-1||busy||exporting} onClick={()=>move(s.id,1)}/><Button size="sm" aria-label={`Delete scene ${i+1}`} icon={Trash2} disabled={busy||exporting} onClick={()=>remove(s.id)}/></div></li>)}</ol>
   <p className="video-project-footnote">{project.scenes.length?`Approx. MP4: ${(estimateExportBytes(total,project.width,project.height).low/1048576).toFixed(1)}–${(estimateExportBytes(total,project.width,project.height).high/1048576).toFixed(1)} MiB · `:''}Original media stays in place. Ctrl+K for editor commands.</p>
   </div>
  </section>
  <nav className="video-project-compact-tabs" aria-label="Editor panels">{(['scenes','scene','look'] as const).map(p=><button key={p} type="button" aria-pressed={panel===p} onClick={()=>setPanel(p)}>{p==='scenes'?'Scenes':p==='scene'?'Scene settings':'Look & canvas'}</button>)}</nav>
  <aside className="video-project-inspector" aria-label="Scene and shared look settings">
   <nav className="video-project-inspector-tabs" aria-label="Inspector panels"><button type="button" aria-pressed={panel!=='look'} onClick={()=>setPanel('scene')}>Scene settings</button><button type="button" aria-pressed={panel==='look'} onClick={()=>setPanel('look')}>Look & canvas</button></nav>
   <div className="video-project-inspector-body"><fieldset disabled={busy||exporting}>
   <div hidden={panel==='look'}>
   {scene&&<section className="video-project-scene-settings"><h2>Selected scene</h2><p title={name(scene)}>{name(scene)}</p>
    {scene.kind==='video'?<><div className="look-row"><span className="look-label">Trim start</span><NumberInput ariaLabel="Scene trim start" value={scene.start} min={0} max={Math.max(0,scene.end-.25)} step={.05} unit="s" onChange={start=>patch({start})}/></div><div className="look-row"><span className="look-label">Trim end</span><NumberInput ariaLabel="Scene trim end" value={scene.end} min={scene.start+.25} max={Math.min(scene.media!.duration,scene.start+900)} step={.05} unit="s" onChange={end=>patch({end})}/></div></>:<div className="look-row"><span className="look-label">Duration</span><NumberInput ariaLabel="Scene duration" value={scene.duration} min={.25} max={900} step={.25} unit="s" onChange={duration=>patch({duration})}/></div>}
    {scene.kind==='title'&&<><label className="video-project-title-label">Title<textarea aria-label="Title card text" maxLength={300} value={scene.title} onChange={e=>patch({title:e.target.value})}/></label><div className="look-row"><span className="look-label">Text size</span><NumberInput ariaLabel="Title text size" value={scene.titleSize} min={24} max={160} onChange={titleSize=>patch({titleSize})}/></div>{(['titleColor','titleStart','titleEnd'] as const).map((key,i)=><div className="look-row" key={key}><span className="look-label">{['Text color','Gradient start','Gradient end'][i]}</span><ColorControl ariaLabel={['Title text color','Title gradient start','Title gradient end'][i]} value={scene[key]} onChange={v=>patch({[key]:v})}/></div>)}</>}
    {scene.kind==='title'&&<><div className="look-row"><span className="look-label">Entrance</span><Select portal ariaLabel="Title entrance" value={scene.entrance??'none'} options={ENTRANCES} onChange={entrance=>patch({entrance:entrance as Entrance})}/></div><div className="look-row"><span className="look-label">Shape</span><Select portal ariaLabel="Title shape" value={scene.shape??'none'} options={['none','line','circle','rectangle'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={shape=>patch({shape:shape as Scene['shape']})}/></div></>}
    {project.scenes.indexOf(scene)>0&&<><div className="look-row"><span className="look-label">Transition in</span><Select portal ariaLabel="Scene transition" value={scene.transition.kind} options={[{value:'cut',label:'Cut'},{value:'crossfade',label:'Crossfade'},{value:'slide',label:'Slide'}]} onChange={kind=>patch({transition:{...scene.transition,kind:kind as Scene['transition']['kind']}})}/></div>{scene.transition.kind!=='cut'&&<div className="look-row"><span className="look-label">Length</span><NumberInput ariaLabel="Transition duration" value={scene.transition.duration} min={.1} max={2} step={.1} unit="s" onChange={duration=>patch({transition:{...scene.transition,duration}})}/></div>}</>}
   <VideoAnnotationEditor hostId={`scene-annotations-${scene.id}`} key={scene.id} items={scene.annotations??[]} duration={scene.kind==='video'?scene.end:scene.duration}
     time={Math.max(scene.kind==='video'?scene.start:0,Math.min((scene.kind==='video'?scene.start:0)+time-(sceneTimeline(project).find(row=>row.scene.id===scene.id)?.start??0),(scene.kind==='video'?scene.end:scene.duration)-.05))}
     onSeek={sourceTime=>{const row=sceneTimeline(project).find(row=>row.scene.id===scene.id);setTime((row?.start??0)+sourceTime-(scene.kind==='video'?scene.start:0));}} disabled={busy||exporting||panel!=='scene'} onPause={()=>{setPlaying(false);}} onChange={annotations=>patch({annotations})}/>
   </section>}
   {!scene&&<p className="look-hint">Add a scene to adjust its timing and transition.</p>}</div>
   <div hidden={panel!=='look'}>
   <ControlDisclosure title="Project canvas"><div className="look-row"><span className="look-label">Size</span><Select portal ariaLabel="Project output preset" value={`${project.width}x${project.height}`} options={[{value:'1280x720',label:'Wide · 720p'},{value:'1920x1080',label:'Wide · 1080p'},{value:'1080x1920',label:'Portrait · 1080p'},{value:'1080x1080',label:'Square · 1080'},...(!['1280x720','1920x1080','1080x1920','1080x1080'].includes(`${project.width}x${project.height}`)?[{value:`${project.width}x${project.height}`,label:'Custom'}]:[])]} onChange={value=>{const [width,height]=value.split('x').map(Number);change({...project,width,height});}}/></div><div className="look-row"><span className="look-label">Width</span><NumberInput ariaLabel="Project width" min={16} max={1920} step={2} value={project.width} onChange={width=>change({...project,width})}/></div><div className="look-row"><span className="look-label">Height</span><NumberInput ariaLabel="Project height" min={16} max={1920} step={2} value={project.height} onChange={height=>change({...project,height})}/></div></ControlDisclosure>
   <LookControls video fixedOutput look={project.look} dimensions={{width:scene?.media?.width??project.width,height:scene?.media?.height??project.height}} onChange={patch=>change({...project,look:{...project.look,...patch}})}/>
   </div>
  </fieldset></div></aside></div>
 </div>;
}

function ScenePlayback({project,time,playing}:{project:SceneProject;time:number;playing:boolean}){
 const active=activeScenes(project,time),incoming=active.length>1?active[1]:null,slide=incoming?.scene.transition.kind==='slide';
 return <>{active.map((s,i)=><div className="video-project-scene-layer" key={s.scene.id} style={{opacity:i>0&&!slide?s.progress:1,transform:slide?`translateX(${i===0?-incoming!.progress*100:(1-incoming!.progress)*100}%)`:undefined}}><ScenePane project={project} scene={s.scene} time={s.time} playing={playing} volume={incoming?(i===0?1-incoming.progress:incoming.progress):1}/></div>)}</>;
}
function ScenePane({project,scene,time,playing,volume}:{project:SceneProject;scene:Scene;time:number;playing:boolean;volume:number}){
 const video=useRef<HTMLVideoElement>(null),cam=useRef<HTMLVideoElement>(null),[still,setStill]=useState<HTMLImageElement|null>(null),[failed,setFailed]=useState(false),[fontReady,setFontReady]=useState(false);
 useEffect(()=>{let active=true;void document.fonts.ready.then(()=>{if(active)setFontReady(true);});return()=>{active=false;};},[]);
 const source=useMemo(()=>scene.kind==='title'?titleRaster(scene,project.width,project.height):scene.media?convertFileSrc(scene.media.path):'',[scene,project.width,project.height,fontReady]);
 useEffect(()=>{setFailed(false);},[source]);
 const studio=useMemo(()=>sceneStudio(project,scene),[project,scene]);
 useEffect(()=>{const v=video.current;if(!v||scene.kind!=='video')return;const sync=()=>{const target=scene.start+time;if(Math.abs(v.currentTime-target)>.12&&!v.seeking)v.currentTime=target;v.volume=Math.min(1,Math.max(0,volume));if(playing&&v.paused)void v.play().catch(()=>setFailed(true));else if(!playing&&!v.paused)v.pause();};sync();v.addEventListener('loadedmetadata',sync);return()=>v.removeEventListener('loadedmetadata',sync);},[scene,time,playing,volume]);
 return <>{scene.kind==='video'?<video ref={video} src={source} preload="auto" playsInline hidden onError={()=>setFailed(true)}/>:<img src={source} alt="" hidden onLoad={e=>setStill(e.currentTarget)} onError={()=>setFailed(true)}/>}<StudioPreview annotationHostId={`scene-annotations-${scene.id}`} studio={studio} video={video} camVideo={cam} cam={null} width={scene.media?.width??project.width} height={scene.media?.height??project.height} still={still} previewTime={time}/>{failed&&<p className="video-project-preview-error" role="alert">This scene could not load. Check that its original media is still available.</p>}</>;
}
