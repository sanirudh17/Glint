import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Select, ColorControl, ControlDisclosure } from "../components/ui";
import { GRADIENTS, type GradientStop } from "../editor/gradients";
import { GradientControls } from "./GradientControls";
import { cloneLook, type AspectId, type LookConfig } from "./model";
import { savePreset, useLookPresets } from "./presets";
import { OUTPUT_SIZES,autoBalance,watermarkImage,exportDimensions,originalExportSizing } from './sizing';
import { NumberInput } from '../components/ui';

export function LookControls({ look, onChange, checkpoint = () => {}, video = false, onSample, dimensions, fixedOutput=false }: {
  look: LookConfig; onChange: (patch: Partial<LookConfig>) => void; checkpoint?: () => void; video?: boolean;
  onSample?:()=>GradientStop[];
  dimensions?:{width:number;height:number}; fixedOutput?:boolean;
}) {
  const presets = useLookPresets();
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = (patch: Partial<LookConfig>) => { checkpoint(); setPresetId(""); onChange(patch); };
  const bg = look.background;
  const aspects: AspectId[] = ["auto", "1:1", "16:9", "4:3", "9:16", "4:5", "3:2", "1.91:1"];
  const wm=look.watermark;
  const output=exportDimensions(dimensions?.width??1920,dimensions?.height??1080,look);
  const setWatermark=(text:string,color=wm?.color??'#ffffff')=>change({watermark:text?{text,color,size:wm?.size??100,opacity:wm?.opacity??.75,position:wm?.position??'bottom-right',...watermarkImage(text,color)}:undefined});
  return <section className="look-controls" aria-label="Look" data-ui data-editor-control>
    <h3 className="studio-section-title">Look</h3>
    <div className="look-preset-field">
      <span className="look-label">Preset</span>
      <Select portal ariaLabel="Look preset" value={presetId}
        options={[{ value: "", label: "Choose a saved look" }, ...presets.map((p) => ({ value: p.id, label: p.name }))]}
        onChange={(id) => { const preset = presets.find((p) => p.id === id); if (preset) { checkpoint(); onChange(cloneLook(preset.look)); setPresetId(id); } }} />
      <div className="look-preset-save">
        <input aria-label="Preset name" placeholder="Name this look" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="g-btn g-btn-subtle g-btn-sm" disabled={!name.trim()} onClick={() => {
          try { savePreset(name, look); setName(""); setError(null); } catch (e) { setError(String(e)); }
        }}>Save</button>
      </div>
    </div>
    <div className="look-row"><span className="look-label">Background</span><div className="look-control">
      <Select portal ariaLabel="Background type" value={bg.type}
        options={[{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }, { value: "image", label: "Image" }, { value: "transparent", label: "Transparent" }]}
        onChange={(type) => {
          if (type === "solid") change({ background: { type, color: "#20242c" } });
          if (type === "gradient") change({ background: { type, gradientId: GRADIENTS[0].id } });
          if (type === "transparent") change({ background: { type } });
          if (type === "image") change({ background: { type, dataUrl: "" } });
        }} />
    </div></div>
    {bg.type === "solid" && <div className="look-row"><span className="look-label">Color</span><div className="look-control"><ColorControl ariaLabel="Background color" value={bg.color} onChange={(color) => change({ background: { type: "solid", color } })} /></div></div>}
    {bg.type === "gradient" && <GradientControls background={bg} checkpoint={checkpoint} onSample={onSample} onChange={background=>{setPresetId('');onChange({background});}}/>}
    {bg.type === "image" && <label className="look-image-picker"><ImagePlus size={16} strokeWidth={1.6} />{bg.dataUrl ? "Replace background image" : "Choose background image"}
      <input aria-label="Background image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 15 * 1024 * 1024) { setError("Choose an image smaller than 15 MB."); return; }
        const reader = new FileReader();
        reader.onerror = () => setError("This image could not be read. Choose another file.");
        reader.onload = () => {
          const dataUrl = String(reader.result), image = new Image();
          image.onerror = () => setError("Choose a valid PNG, JPEG or WebP image.");
          image.onload = () => {
            if (image.width > 16000 || image.height > 16000) { setError("Choose an image with each side under 16,000 px."); return; }
            setError(null); change({ background: { type: "image", dataUrl } });
          };
          image.src = dataUrl;
        };
        reader.readAsDataURL(file);
        e.target.value = "";
      }} />
    </label>}
    {(["padding", "radius", "shadow"] as const).map((key) => <LookSlider key={key} label={key[0].toUpperCase() + key.slice(1)} // taste-skill-ignore: media shadow strength control
      ariaLabel={key} value={look[key]} unit="%" checkpoint={checkpoint} onChange={(value) => { setPresetId(""); onChange({ [key]: value }); }} />)}
    <button type="button" className="g-btn g-btn-subtle g-btn-sm" title="Use equal margins around the screenshot; clear fixed output size" onClick={()=>change(autoBalance(dimensions?.width??1,dimensions?.height??1))}>Auto Balance</button>
    {!fixedOutput&&<><div className="look-row"><span className="look-label">Aspect</span><div className="look-control"><Select portal ariaLabel="Export aspect" value={look.aspect}
      options={aspects.map((aspect) => ({ value: aspect, label: aspect === "auto" ? "Original" : aspect }))}
      onChange={(aspect) => change({ aspect: aspect as AspectId,outputSize:undefined })} /></div></div>
    <div className="look-preset-field"><span className="look-label">Output size</span><div><Select portal ariaLabel="Output size preset" value={look.outputSize?OUTPUT_SIZES.find(s=>s.width===look.outputSize?.width&&s.height===look.outputSize?.height)?.id??'custom':''}
      options={[{value:'',label:'Original resolution'},...OUTPUT_SIZES.map(s=>({value:s.id,label:s.label})),...(look.outputSize?[{value:'custom',label:'Custom size'}]:[])]}
      onChange={id=>{const size=OUTPUT_SIZES.find(s=>s.id===id);change({enabled:true,...(size?{outputSize:{width:size.width,height:size.height}}:originalExportSizing())});}}/></div></div>
    {look.outputSize&&<p className="look-hint">{look.outputSize.width} × {look.outputSize.height} px</p>}
    </>}
    <ControlDisclosure title="Advanced look">
      {!video&&<><div className="look-row"><span className="look-label">Export width</span><div className="look-control"><NumberInput ariaLabel="Export width" min={16} max={Math.max(4096,output.width)} value={output.width} onChange={width=>change({outputSize:{width,height:output.height}})}/></div></div>
      <div className="look-row"><span className="look-label">Export height</span><div className="look-control"><NumberInput ariaLabel="Export height" min={16} max={Math.max(4096,output.height)} value={output.height} onChange={height=>change({outputSize:{height,width:output.width}})}/></div></div>
      <button type="button" className="g-btn g-btn-subtle g-btn-sm" disabled={!look.outputSize&&look.aspect==='auto'} onClick={()=>change(originalExportSizing())}>Reset export size</button></>}
      <div className="look-row"><span className="look-label">Shadow color</span><div className="look-control"><ColorControl ariaLabel="Shadow color" value={look.shadowColor ?? "#000000"} onChange={(shadowColor) => change({ shadowColor })} /></div></div>
      <LookSlider label="Border" ariaLabel="Border width" max={16} value={look.border?.width ?? 0} unit="px" checkpoint={checkpoint}
        onChange={(width) => change({ border: { width, color: look.border?.color ?? "#ffffff", style: look.border?.style ?? "solid" } })} />
      <div className="look-row"><span className="look-label">Border color</span><div className="look-control"><ColorControl ariaLabel="Border color" value={look.border?.color ?? "#ffffff"}
        onChange={(color) => change({ border: { width: look.border?.width ?? 1, color, style: look.border?.style ?? "solid" } })} /></div></div>
      <div className="look-row"><span className="look-label">Border style</span><div className="look-control"><Select portal ariaLabel="Border style" value={look.border?.style ?? "solid"}
        options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }]}
        onChange={(style) => change({ border: { width: look.border?.width ?? 1, color: look.border?.color ?? "#ffffff", style: style as "solid" | "dashed" } })} /></div></div>
    </ControlDisclosure>
    <ControlDisclosure title="Watermark">
      <label className="look-preset-save"><input aria-label="Watermark text" maxLength={64} placeholder="Your name or label" value={wm?.text??''} onChange={e=>setWatermark(e.target.value)}/></label>
      {wm&&<><div className="look-row"><span className="look-label">Color</span><div className="look-control"><ColorControl ariaLabel="Watermark color" value={wm.color} onChange={color=>setWatermark(wm.text,color)}/></div></div>
      <div className="look-row"><span className="look-label">Position</span><div className="look-control"><Select portal ariaLabel="Watermark position" value={wm.position} options={[{value:'bottom-left',label:'Bottom left'},{value:'bottom-right',label:'Bottom right'}]} onChange={position=>change({watermark:{...wm,position:position as typeof wm.position}})}/></div></div>
      <LookSlider label="Size" ariaLabel="Watermark size" unit="%" min={50} max={200} step={5} value={wm.size??100} checkpoint={checkpoint} onChange={size=>onChange({watermark:{...wm,size}})}/>
      <LookSlider label="Opacity" ariaLabel="Watermark opacity" unit="%" value={wm.opacity*100} checkpoint={checkpoint} onChange={opacity=>onChange({watermark:{...wm,opacity:opacity/100}})}/></>}
    </ControlDisclosure>
    {video && bg.type === "transparent" && <p className="look-hint">Transparent areas become black in MP4.</p>}
    {error && <p className="look-error" role="alert">{error}</p>}
  </section>;
}

export function LookSlider({ label, ariaLabel, value, min = 0, max = 100, step = 1, unit = "", onChange, checkpoint }: {
  label: string; ariaLabel?: string; value: number; min?: number; max?: number; step?: number; unit?: string;
  onChange: (value: number) => void; checkpoint?: () => void;
}) {
  return <label className="look-row look-slider"><span className="look-label">{label}</span><span className="look-slider-control">
    <input aria-label={ariaLabel ?? label} type="range" min={min} max={max} step={step} value={value}
      onPointerDown={checkpoint} onKeyDown={(e) => { if (e.key.startsWith("Arrow")) checkpoint?.(); }} onChange={(e) => onChange(Number(e.target.value))} />
    <output>{Math.round(value * 100) / 100}{unit}</output>
  </span></label>;
}
