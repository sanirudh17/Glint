import { useState } from "react";
import { Check, Copy, FolderOpen, Save } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button, ControlDisclosure, NumberInput,Switch } from "../components/ui";
import { LookControls, LookSlider } from "../look/LookControls";
import { CursorControls } from "./CursorControls";
import { clampCrop } from "./studioLayout";
import { clampPlacement, type CamPlacement } from "./camOverlay";
import type { StudioEvents,StudioProject } from "./studioModel";
import { StudioZoomControls } from "./StudioZoomControls";
import { StudioMaskControls } from "./StudioMaskControls";

export function StudioPanel({ project, path, width, height, saveStatus, exportMessage, exporting, cam, onCamChange, onChange, onSave, time, duration, selectedZoom, onSelectZoom, onPickZoom, events, selectedMask, onSelectMask, drawingMask, onDrawMask, onSeek }: {
  project: StudioProject; path: string; width: number; height: number; saveStatus: string;
  exportMessage: string | null; exporting: boolean; cam: CamPlacement | null;
  onCamChange: (cam: CamPlacement) => void; onChange: (patch: Partial<StudioProject>) => void; onSave: () => void;
  time:number;duration:number;selectedZoom:string|null;onSelectZoom:(id:string|null)=>void;onPickZoom:()=>void;
  events:StudioEvents;
  selectedMask:string|null;onSelectMask:(id:string|null)=>void;drawingMask:boolean;onDrawMask:()=>void;onSeek:(time:number)=>void;
}) {
  const parts = path.split(/[\\/]/);
  const name = (parts[parts.length - 2] ?? "Recording").replace(/\.glint-studio$/, "");
  const crop = project.crop ?? { x: 0, y: 0, w: width, h: height };
  const saved = saveStatus === "Saved";
  return <aside className="studio-panel" aria-label="Studio settings" data-ui>
    <header className="studio-panel-header">
      <h2>Studio</h2>
      <p className="studio-project-name" title={path}>{name}</p>
      <div className={`studio-save-status${saved ? " is-saved" : ""}`} role="status">
        {saved && <Check size={11} strokeWidth={1.8} aria-hidden />}
        <span>{saved ? "All changes saved" : saveStatus}</span>
      </div>
    </header>
    {exportMessage && (exportMessage.startsWith("Exported: ")
      ? <ExportResult path={exportMessage.slice(10)} />
      : <p className="studio-export-error" role="alert">{exportMessage}</p>)}
    <fieldset className="studio-panel-controls" disabled={exporting}>
      <LookControls video look={project.look} onChange={(patch) => onChange({ look: { ...project.look, ...patch } })} />
      <StudioZoomControls segments={project.zoomSegments} selected={selectedZoom} time={time} duration={duration} events={events} onChange={zoomSegments=>onChange({zoomSegments})} onSelect={onSelectZoom} onPick={onPickZoom}/>
      <StudioMaskControls masks={project.masks} selected={selectedMask} time={time} duration={duration} width={width} height={height} drawing={drawingMask} onDraw={onDrawMask} onChange={masks=>onChange({masks})} onSelect={onSelectMask} onSeek={onSeek}/>
      {project.masks.length>0&&<div className="look-row"><span className="look-label">Delete source after export</span><Switch ariaLabel="Delete unmasked source after export" checked={project.deleteSourceAfterExport??false} onChange={deleteSourceAfterExport=>onChange({deleteSourceAfterExport})}/></div>}
      <CursorControls cursor={project.cursor} onChange={(patch) => onChange({ cursor: { ...project.cursor, ...patch } })} />
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
        {(["x", "y", "diameter"] as const).map((key) => <LookSlider key={key} label={{ x: "Horizontal", y: "Vertical", diameter: "Size" }[key]}
          ariaLabel={`Camera ${key}`} value={cam[key] * 100} unit="%" onChange={(value) => onCamChange(clampPlacement({ ...cam, [key]: value / 100 }))} />)}
      </ControlDisclosure>}
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
    </div>
    {error && <p className="studio-export-error" role="alert">{error}</p>}
  </section>;
}
