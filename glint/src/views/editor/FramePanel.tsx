import { useEditorStore } from "../../editor/useEditorStore";
import { GRADIENTS } from "../../editor/gradients";
import { PALETTE } from "../../editor/palette";

const ASPECTS = ["auto", "1:1", "16:9", "4:3"] as const;

/**
 * Right-docked frame controls: background type (solid/gradient/transparent),
 * the matching color/gradient picker, padding/radius/shadow sliders, an aspect
 * preset selector, and Reset affordances. Frame styling is live (not undoable);
 * crop is reset here too since this panel is the natural home for it.
 */
export function FramePanel() {
  const frame = useEditorStore((s) => s.frame);
  const setFrame = useEditorStore((s) => s.setFrame);
  const resetFrame = useEditorStore((s) => s.resetFrame);
  const crop = useEditorStore((s) => s.crop);
  const resetCrop = useEditorStore((s) => s.resetCrop);
  const bg = frame.background;

  return (
    <aside className="frame-panel" aria-label="Frame">
      <div className="frame-row">
        <span className="frame-label">Background</span>
        <div className="frame-seg">
          {(["solid", "gradient", "transparent"] as const).map((t) => (
            <button
              key={t}
              className={`frame-seg-btn${bg.type === t ? " is-active" : ""}`}
              onClick={() =>
                setFrame({
                  background:
                    t === "solid"
                      ? { type: "solid", color: PALETTE[3] }
                      : t === "gradient"
                        ? { type: "gradient", gradientId: GRADIENTS[0].id }
                        : { type: "transparent" },
                })
              }
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {bg.type === "solid" && (
        <div className="frame-swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`editor-swatch${bg.color.toLowerCase() === c.toLowerCase() ? " editor-swatch--active" : ""}`}
              style={{ background: c }}
              title={c}
              aria-label={`Background ${c}`}
              onClick={() => setFrame({ background: { type: "solid", color: c } })}
            />
          ))}
          <label className="editor-swatch editor-swatch--custom" style={{ background: bg.color }} title="Custom color">
            <input
              type="color"
              value={bg.color}
              onChange={(e) => setFrame({ background: { type: "solid", color: e.currentTarget.value } })}
              aria-label="Custom background color"
            />
          </label>
        </div>
      )}

      {bg.type === "gradient" && (
        <div className="frame-gradients">
          {GRADIENTS.map((g) => (
            <button
              key={g.id}
              title={g.label}
              aria-label={g.label}
              className={`frame-grad${bg.gradientId === g.id ? " is-active" : ""}`}
              style={{ background: `linear-gradient(135deg, ${g.stops[0].color}, ${g.stops[g.stops.length - 1].color})` }}
              onClick={() => setFrame({ background: { type: "gradient", gradientId: g.id } })}
            />
          ))}
        </div>
      )}

      <Slider label="Padding" value={frame.padding} onChange={(v) => setFrame({ padding: v })} />
      <Slider label="Radius" value={frame.radius} min={0} max={48} onChange={(v) => setFrame({ radius: v })} />
      <Slider label="Shadow" value={frame.shadow} onChange={(v) => setFrame({ shadow: v })} />

      <div className="frame-row">
        <span className="frame-label">Aspect</span>
        <div className="frame-seg">
          {ASPECTS.map((a) => (
            <button
              key={a}
              className={`frame-seg-btn${frame.aspect === a ? " is-active" : ""}`}
              onClick={() => setFrame({ aspect: a })}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="frame-actions">
        {crop && (
          <button className="frame-text-btn" onClick={() => resetCrop()}>
            Reset crop
          </button>
        )}
        <button className="frame-text-btn" onClick={() => resetFrame()}>
          Reset frame
        </button>
      </div>
    </aside>
  );
}

function Slider({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="frame-slider">
      <span className="frame-label">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
    </label>
  );
}
