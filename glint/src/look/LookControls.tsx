import { useState } from "react";
import { GRADIENTS } from "../editor/gradients";
import { cloneLook, type AspectId, type LookConfig } from "./model";
import { savePreset, useLookPresets } from "./presets";

/** Used directly by both editor panels; presets contain the same LookConfig objects. */
export function LookControls({ look, onChange, checkpoint = () => {}, video = false }: {
  look: LookConfig; onChange: (patch: Partial<LookConfig>) => void; checkpoint?: () => void; video?: boolean;
}) {
  const presets = useLookPresets();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = (patch: Partial<LookConfig>) => { checkpoint(); onChange(patch); };
  const bg = look.background;
  const aspects: AspectId[] = video ? ["auto", "16:9", "1:1", "9:16", "4:5"] : ["auto", "1:1", "16:9", "4:3", "9:16", "4:5"];
  return <div className="look-controls">
    <label>Preset<select aria-label="Look preset" value="" onChange={(e) => {
      const preset = presets.find((p) => p.id === e.target.value);
      if (preset) change(cloneLook(preset.look));
    }}><option value="">Choose a saved look</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="look-preset-save"><input aria-label="Preset name" placeholder="Name this look" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" disabled={!name.trim()} onClick={() => { try { savePreset(name, look); setName(""); setError(null); } catch (e) { setError(String(e)); } }}>Save</button></div>
    <label>Background<select aria-label="Background type" value={bg.type} onChange={(e) => {
      const type = e.target.value;
      if (type === "solid") change({ background: { type, color: "#20242c" } });
      if (type === "gradient") change({ background: { type, gradientId: GRADIENTS[0].id } });
      if (type === "transparent") change({ background: { type } });
      if (type === "image") change({ background: { type, dataUrl: "" } });
    }}><option value="solid">Solid</option><option value="gradient">Gradient</option><option value="image">Image</option><option value="transparent">Transparent</option></select></label>
    {bg.type === "solid" && <label>Color<input aria-label="Background color" type="color" value={bg.color} onChange={(e) => change({ background: { type: "solid", color: e.target.value } })} /></label>}
    {bg.type === "gradient" && <div className="frame-gradients">{GRADIENTS.map((g) => <button type="button" key={g.id} title={g.label} aria-label={g.label} aria-pressed={bg.gradientId === g.id} className={`frame-grad${bg.gradientId === g.id ? " is-active" : ""}`} style={{ background: `linear-gradient(135deg, ${g.stops[0].color}, ${g.stops[g.stops.length - 1].color})` }} onClick={() => change({ background: { type: "gradient", gradientId: g.id } })} />)}</div>}
    {bg.type === "image" && <label>Choose image<input aria-label="Background image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 15 * 1024 * 1024) { setError("Choose an image smaller than 15 MB."); return; }
      const reader = new FileReader(); reader.onload = () => change({ background: { type: "image", dataUrl: String(reader.result) } }); reader.readAsDataURL(file);
    }} /></label>}
    {(["padding", "radius", "shadow"] as const).map((key) => <label key={key}>{key[0].toUpperCase() + key.slice(1)}<input aria-label={key} type="range" min="0" max="100" value={look[key]} onPointerDown={checkpoint} onChange={(e) => onChange({ [key]: Number(e.target.value) })} /></label>)}
    <label>Aspect<select aria-label="Export aspect" value={look.aspect} onChange={(e) => change({ aspect: e.target.value as AspectId })}>{aspects.map((a) => <option key={a}>{a}</option>)}</select></label>
    <details><summary>Advanced look</summary>
      <label>Shadow color<input aria-label="Shadow color" type="color" value={look.shadowColor ?? "#000000"} onChange={(e) => change({ shadowColor: e.target.value })} /></label>
      <label>Border<input aria-label="Border width" type="range" min="0" max="16" value={look.border?.width ?? 0} onChange={(e) => change({ border: { width: Number(e.target.value), color: look.border?.color ?? "#ffffff", style: look.border?.style ?? "solid" } })} /></label>
      <label>Border color<input aria-label="Border color" type="color" value={look.border?.color ?? "#ffffff"} onChange={(e) => change({ border: { width: look.border?.width ?? 1, color: e.target.value, style: look.border?.style ?? "solid" } })} /></label>
      <label>Border style<select aria-label="Border style" value={look.border?.style ?? "solid"} onChange={(e) => change({ border: { width: look.border?.width ?? 1, color: look.border?.color ?? "#ffffff", style: e.target.value as "solid" | "dashed" } })}><option>solid</option><option>dashed</option></select></label>
    </details>
    {video && bg.type === "transparent" && <p>MP4 fills transparent areas with black.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
