import { Select, Switch } from "../components/ui";
import { LookSlider } from "../look/LookControls";
import type { CursorConfig } from "./studioModel";

export function CursorControls({ cursor, onChange }: { cursor: CursorConfig; onChange: (patch: Partial<CursorConfig>) => void }) {
  return <section className="studio-cursor" aria-label="Cursor and effects" data-editor-control>
    <h3 className="studio-section-title">Cursor &amp; effects</h3>
    {([ ["visible", "Show cursor"], ["hideIdle", "Hide when idle"], ["clicks", "Click effects"], ["keystrokes", "Show keystrokes"], ["spotlight", "Cursor spotlight"], ["recordedEffects", "Follow recorded toggles"] ] as const).map(([key, label]) =>
      <div className="look-row" key={key}><span className="look-label">{label}</span><Switch ariaLabel={label} checked={cursor[key]??(key==='recordedEffects')} onChange={(checked) => onChange({ [key]: checked, ...(['clicks','keystrokes','spotlight'].includes(key)?{recordedEffects:false}:{}) })} /></div>)}
    <LookSlider label="Smoothing" ariaLabel="Cursor smoothing" value={cursor.smoothing * 100} unit="%" step={5} onChange={(value) => onChange({ smoothing: value / 100 })} />
    <LookSlider label="Cursor size" value={cursor.size} min={12} max={96} unit="px" onChange={(size) => onChange({ size })} />
    <LookSlider label="Click size" value={cursor.clickSize} min={12} max={96} unit="px" onChange={(clickSize) => onChange({ clickSize, clicks:true, recordedEffects:false })} />
    <div className="look-row"><span className="look-label">Cursor style</span><div className="look-control"><Select portal ariaLabel="Cursor style" value={cursor.style}
      options={[{ value: "arrow", label: "Arrow" }, { value: "dot", label: "Dot" }]}
      onChange={(style) => onChange({ style: style as "arrow" | "dot" })} /></div></div>
  </section>;
}
