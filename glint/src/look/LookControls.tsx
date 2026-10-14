import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Select, ColorControl, ControlDisclosure } from "../components/ui";
import { GRADIENTS } from "../editor/gradients";
import { cloneLook, type AspectId, type LookConfig } from "./model";
import { savePreset, useLookPresets } from "./presets";

export function LookControls({ look, onChange, checkpoint = () => {}, video = false }: {
  look: LookConfig; onChange: (patch: Partial<LookConfig>) => void; checkpoint?: () => void; video?: boolean;
}) {
  const presets = useLookPresets();
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = (patch: Partial<LookConfig>) => { checkpoint(); setPresetId(""); onChange(patch); };
  const bg = look.background;
  const aspects: AspectId[] = video ? ["auto", "16:9", "1:1", "9:16", "4:5"] : ["auto", "1:1", "16:9", "4:3", "9:16", "4:5"];
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
    {bg.type === "gradient" && <div className="look-gradient-grid">{GRADIENTS.map((g) => <button type="button" key={g.id}
      title={g.label} aria-label={g.label} aria-pressed={bg.gradientId === g.id}
      className={`look-gradient${bg.gradientId === g.id ? " is-active" : ""}`}
      style={{ background: `linear-gradient(135deg, ${g.stops[0].color}, ${g.stops[g.stops.length - 1].color})` }} // taste-skill-ignore: previews the user-selected media gradient
      onClick={() => change({ background: { type: "gradient", gradientId: g.id } })} />)}</div>}
    {bg.type === "image" && <label className="look-image-picker"><ImagePlus size={16} strokeWidth={1.6} />{bg.dataUrl ? "Replace background image" : "Choose background image"}
      <input aria-label="Background image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
        const file = e.target.files?.[0]; if (!file) return;
        if (file.size > 15 * 1024 * 1024) { setError("Choose an image smaller than 15 MB."); return; }
        const reader = new FileReader(); reader.onload = () => change({ background: { type: "image", dataUrl: String(reader.result) } }); reader.readAsDataURL(file);
      }} />
    </label>}
    {(["padding", "radius", "shadow"] as const).map((key) => <LookSlider key={key} label={key[0].toUpperCase() + key.slice(1)} // taste-skill-ignore: media shadow strength control
      ariaLabel={key} value={look[key]} unit="%" checkpoint={checkpoint} onChange={(value) => { setPresetId(""); onChange({ [key]: value }); }} />)}
    <div className="look-row"><span className="look-label">Aspect</span><div className="look-control"><Select portal ariaLabel="Export aspect" value={look.aspect}
      options={aspects.map((aspect) => ({ value: aspect, label: aspect === "auto" ? "Original" : aspect }))}
      onChange={(aspect) => change({ aspect: aspect as AspectId })} /></div></div>
    <ControlDisclosure title="Advanced look">
      <div className="look-row"><span className="look-label">Shadow color</span><div className="look-control"><ColorControl ariaLabel="Shadow color" value={look.shadowColor ?? "#000000"} onChange={(shadowColor) => change({ shadowColor })} /></div></div>
      <LookSlider label="Border" ariaLabel="Border width" max={16} value={look.border?.width ?? 0} unit="px" checkpoint={checkpoint}
        onChange={(width) => change({ border: { width, color: look.border?.color ?? "#ffffff", style: look.border?.style ?? "solid" } })} />
      <div className="look-row"><span className="look-label">Border color</span><div className="look-control"><ColorControl ariaLabel="Border color" value={look.border?.color ?? "#ffffff"}
        onChange={(color) => change({ border: { width: look.border?.width ?? 1, color, style: look.border?.style ?? "solid" } })} /></div></div>
      <div className="look-row"><span className="look-label">Border style</span><div className="look-control"><Select portal ariaLabel="Border style" value={look.border?.style ?? "solid"}
        options={[{ value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }]}
        onChange={(style) => change({ border: { width: look.border?.width ?? 1, color: look.border?.color ?? "#ffffff", style: style as "solid" | "dashed" } })} /></div></div>
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
