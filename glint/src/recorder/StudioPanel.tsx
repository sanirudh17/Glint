import {VideoAnnotationEditor} from "./VideoAnnotationEditor";
import { WindowControls } from "../components/Titlebar";
import { useState } from "react";
import { Check, Copy, FolderOpen, Save } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button, ControlDisclosure, NumberInput,Switch,Select } from "../components/ui";
import { LookControls, LookSlider } from "../look/LookControls";
import { CursorControls } from "./CursorControls";
import { clampCrop } from "./studioLayout";
import { clampPlacement, type CamPlacement } from "./camOverlay";
import type { StudioEvents,StudioProject } from "./studioModel";
import { StudioZoomControls } from "./StudioZoomControls";
import { StudioMaskControls } from "./StudioMaskControls";
import {DEFAULT_MOTION} from './studioMotion';
import type {FocusPoint} from './studioFocus';
import {StudioPolishControls} from './StudioPolishControls';

export function StudioPanel({ onClose, project, path, width, height, saveStatus, exportMessage, exporting, cam, onCamChange, onChange, onSave, time, duration, selectedZoom, onSelectZoom, onPickZoom, events, selectedMask, onSelectMask, drawingMask, onDrawMask, onSeek,focusAim,pickingFocus }: {
  onClose: () => void;
  project: StudioProject; path: string; width: number; height: number; saveStatus: string;
  exportMessage: string | null; exporting: boolean; cam: CamPlacement | null;
  onCamChange: (cam: CamPlacement) => void; onChange: (patch: Partial<StudioProject>,action?:string) => void; onSave: () => void;
  focusAim:FocusPoint|null;pickingFocus:boolean;
  time:number;duration:number;selectedZoom:string|null;onSelectZoom:(id:string|null)=>void;onPickZoom:()=>void;
  events:StudioEvents;
  selectedMask:string|null;onSelectMask:(id:string|null)=>void;drawingMask:boolean;onDrawMask:()=>void;onSeek:(time:number)=>void;
}) {
  const parts = path.split(/[\\/]/);
  const name = project.importedVideo
    ? (parts[parts.length-1]??'Recording').replace(/\.[^.]+$/,'')
    : (parts[parts.length - 2] ?? "Recording").replace(/\.glint-studio$/, "");
  const hasCursor=events.events.some(e=>e.kind==='cursor');
  const crop = project.crop ?? { x: 0, y: 0, w: width, h: height };
  const saved = saveStatus === "Saved";
  const [tab,setTab]=useState<'look'|'edit'|'polish'>('look');
  return <aside className="studio-panel" aria-label="Studio settings">
    <header className="studio-panel-header">
      <div className="studio-heading-row" data-tauri-drag-region><h1>Studio</h1><WindowControls onClose={onClose}/></div>
      <p className="studio-project-name" title={path}>{name}</p>
      {project.importedVideo&&<p className="look-hint">Edits save separately. Your original video is kept.</p>}
      <div className={`studio-save-status${saved ? " is-saved" : ""}`} role="status">
        {saved && <Check size={11} strokeWidth={1.8} aria-hidden />}
        <span>{saved ? "All changes saved" : saveStatus}</span>
      </div>
    </header>
    {exportMessage && (exportMessage.startsWith("Exported: ")
      ? <ExportResult path={exportMessage.slice(10)} />
      : <p className="studio-export-error" role="alert">{exportMessage}</p>)}
    <nav className="studio-panel-tabs" aria-label="Studio panels">{(['look','edit','polish'] as const).map(value=><button type="button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
    <fieldset className="studio-panel-controls" disabled={exporting}>
      <div hidden={tab!=='look'}>
      <LookControls video look={project.look} dimensions={{width:crop.w,height:crop.h}} onChange={(patch) => onChange({ look: { ...project.look, ...patch } })} />
      </div><div hidden={tab!=='edit'} className="studio-edit-controls">
      <StudioZoomControls segments={project.zoomSegments} selected={selectedZoom} time={time} duration={duration} events={events} width={width} height={height} smoothing={project.cursor.smoothing} aim={focusAim} picking={pickingFocus} onChange={zoomSegments=>onChange({zoomSegments})} onSelect={onSelectZoom} onPick={onPickZoom}/>
      <VideoAnnotationEditor onSeek={onSeek} items={project.annotations??[]} time={time} duration={duration} disabled={exporting||tab!=='edit'} onPause={()=>onSeek(time)} onChange={annotations=>onChange({annotations})}/>
      <StudioMaskControls masks={project.masks} selected={selectedMask} time={time} duration={duration} width={width} height={height} drawing={drawingMask} onDraw={onDrawMask} onChange={masks=>onChange({masks})} onSelect={onSelectMask} onSeek={onSeek}/>
      {project.masks.length>0&&!project.importedVideo&&<div className="look-row"><span className="look-label">Delete source after export</span><Switch ariaLabel="Delete unmasked source after export" checked={project.deleteSourceAfterExport??false} onChange={deleteSourceAfterExport=>onChange({deleteSourceAfterExport})}/></div>}
      {hasCursor?<CursorControls cursor={project.cursor} onChange={(patch) => onChange({ cursor: { ...project.cursor, ...patch } })} />
        :<ControlDisclosure title="Cursor & effects"><p className="look-hint">This video has no recorded cursor data. Record in Studio mode to edit the cursor, smoothing and click effects.</p></ControlDisclosure>}
      <ControlDisclosure title="Motion blur" className="studio-effects-controls">
        <div className="look-row"><span className="look-label">Motion blur</span><Switch ariaLabel="Enable motion blur" checked={project.motionBlur?.enabled??false} onChange={enabled=>onChange({motionBlur:{...(project.motionBlur??DEFAULT_MOTION),enabled}})}/></div>
        {project.motionBlur?.enabled&&<LookSlider label="Amount" ariaLabel="Motion blur amount" value={project.motionBlur.intensity*100} unit="%" onChange={value=>onChange({motionBlur:{...project.motionBlur!,intensity:value/100}})}/>}
        <p className="look-hint">Light blur on fast zoom, pan and cursor movement. More blur adds rendering work.</p>
      </ControlDisclosure>
      <ControlDisclosure title="Crop source video" className="studio-crop">
        <p className="look-hint">Source: {width} × {height} px. Crop stays inside the source. Press Enter or leave a field to apply.</p>
        <div className="studio-crop-grid">
          {(["x", "y", "w", "h"] as const).map((key) => {
            const label = { x: "Left", y: "Top", w: "Width", h: "Height" }[key];
            const max = key === "x" ? width - 2 : key === "y" ? height - 2 : key === "w" ? width - crop.x : height - crop.y;
            return <div className="studio-crop-field" key={key}><span className="look-label">{label}</span>
              <NumberInput ariaLabel={`Crop ${label.toLowerCase()}`} value={crop[key]} min={key === "w" || key === "h" ? 2 : 0} max={max} unit="px"
                onChange={(value) => onChange({ crop: clampCrop({ ...crop, [key]: value }, width, height) })} />
            </div>;
          })}
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange({ crop: null })}>Reset crop</Button>
      </ControlDisclosure>
      {cam && <ControlDisclosure title="Camera position" className="studio-camera">
        <div className="look-row"><span className="look-label">Layout</span><Select portal ariaLabel="Camera layout" value={cam.layout??'overlay'} options={[{value:'overlay',label:'Overlay'},{value:'side-by-side',label:'Side by side'},{value:'camera-only',label:'Camera only'}]} onChange={layout=>onCamChange({...cam,layout:layout as CamPlacement['layout']})}/></div>
        {cam.layout&&cam.layout!=='overlay'&&<p className="look-hint">This layout uses a rectangular camera frame. Position and shape apply to Overlay.</p>}
        {(["x", "y", "diameter"] as const).map((key) => <LookSlider key={key} label={{ x: "Horizontal", y: "Vertical", diameter: "Size" }[key]}
          ariaLabel={`Camera ${key}`} value={cam[key] * 100} unit="%" onChange={(value) => onCamChange(clampPlacement({ ...cam, [key]: value / 100 }))} />)}
      </ControlDisclosure>}
      </div><div hidden={tab!=='polish'}><StudioPolishControls project={project} events={events} path={path} duration={duration} onChange={onChange}/></div>
      <div className="studio-panel-footer"><Button icon={Save} onClick={onSave}>Save project</Button></div>
    </fieldset>
  </aside>;
}

function ExportResult({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parts = path.split(/[\\/]/); const filename = parts.pop() ?? path;
  const folder = parts.join("\\");
  return <section className="studio-export-result" aria-label="Export result">
    <div className="studio-export-complete"><Check size={12} strokeWidth={1.8} aria-hidden /><span>Export complete</span></div>
    <p className="studio-export-name" title={filename}>{filename}</p>
    <p className="studio-export-folder" title={folder}>{folder}</p>
    <div className="studio-export-actions">
      <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void invoke("reveal_path", { path }).catch((e) => setError(String(e)))}>Show in folder</Button>
      <Button size="sm" variant="ghost" icon={Copy} onClick={() => void invoke("clipboard_copy_text", { text: path }).then(() => { setCopied(true); setError(null); }).catch((e) => setError(String(e)))}>{copied ? "Copied" : "Copy path"}</Button>
      <Button size="sm" variant="ghost" icon={Copy} onClick={()=>void invoke('studio_copy_video',{path}).then(()=>setError(null)).catch(e=>setError(String(e)))}>Copy video file</Button>
    </div>
    {error && <p className="studio-export-error" role="alert">{error}</p>}
  </section>;
}
