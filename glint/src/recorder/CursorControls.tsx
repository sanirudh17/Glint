import type { CursorConfig } from "./studioModel";
export function CursorControls({ cursor, onChange }: { cursor: CursorConfig; onChange: (patch: Partial<CursorConfig>) => void }) {
  return <section className="studio-cursor" aria-label="Cursor and effects"><h3>Cursor &amp; effects</h3>
    {([ ["visible", "Show cursor"], ["hideIdle", "Hide when idle"], ["clicks", "Click effects"], ["keystrokes", "Show keystrokes"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="checkbox" checked={cursor[key]} onChange={(e) => onChange({ [key]: e.target.checked })} /></label>)}
    <label>Smoothing<input aria-label="Cursor smoothing" type="range" min="0" max="1" step="0.05" value={cursor.smoothing} onChange={(e) => onChange({ smoothing: Number(e.target.value) })} /></label>
    <label>Cursor size<input aria-label="Cursor size" type="range" min="12" max="96" value={cursor.size} onChange={(e) => onChange({ size: Number(e.target.value) })} /></label>
    <label>Click size<input aria-label="Click size" type="range" min="12" max="96" value={cursor.clickSize} onChange={(e) => onChange({ clickSize: Number(e.target.value) })} /></label>
    <label>Style<select aria-label="Cursor style" value={cursor.style} onChange={(e) => onChange({ style: e.target.value as "arrow" | "dot" })}><option value="arrow">Arrow</option><option value="dot">Dot</option></select></label>
  </section>;
}
