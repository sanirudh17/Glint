import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { GRADIENTS } from "../../editor/gradients";
import { BG_SOLIDS } from "../../editor/palette";

const TRANSPARENT_HINT =
  "No backdrop — the padding & rounded corners export as a see-through (alpha) PNG, so the framed " +
  "screenshot drops cleanly onto any color, slide, or doc. The checkerboard just marks the transparent " +
  "areas; it isn't part of the image.";
const ASPECT_HINT =
  "Aspect pads the backdrop out to a fixed shape (1:1 for social, 16:9 for slides). The screenshot never " +
  "shrinks — it stays centered while the frame grows. Most visible with a solid/gradient backdrop.";

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
  const setChrome = useEditorStore((s) => s.setChrome);
  const resetFrame = useEditorStore((s) => s.resetFrame);
  const crop = useEditorStore((s) => s.crop);
  const resetCrop = useEditorStore((s) => s.resetCrop);
  const bg = frame.background;
  const chrome = frame.chrome;

  return (
    <aside className="frame-panel" aria-label="Frame">
      <div className="frame-row">
        <span className="frame-labelrow">
          <span className="frame-label">Background</span>
          {bg.type === "transparent" && <Hint text={TRANSPARENT_HINT} />}
        </span>
        <div className="frame-seg">
          {(["solid", "gradient", "transparent"] as const).map((t) => (
            <button
              key={t}
              className={`frame-seg-btn${bg.type === t ? " is-active" : ""}`}
              onClick={() =>
                setFrame({
                  background:
                    t === "solid"
                      ? { type: "solid", color: BG_SOLIDS[0] }
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
          {BG_SOLIDS.map((c) => (
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

      <div className="frame-row">
        <span className="frame-label">Window</span>
        <div className="frame-seg">
          {(["none", "window", "browser"] as const).map((st) => (
            <button
              key={st}
              className={`frame-seg-btn${chrome.style === st ? " is-active" : ""}`}
              onClick={() => setChrome({ style: st })}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {chrome.style !== "none" && (
        <>
          <div className="frame-row">
            <span className="frame-label">Theme</span>
            <div className="frame-seg">
              {(["light", "dark"] as const).map((th) => (
                <button
                  key={th}
                  className={`frame-seg-btn${chrome.theme === th ? " is-active" : ""}`}
                  onClick={() => setChrome({ theme: th })}
                >
                  {th}
                </button>
              ))}
            </div>
          </div>

          <div className="frame-row">
            <span className="frame-label">Buttons</span>
            <div className="frame-seg">
              {([["none", "None"], ["mac", "macOS"], ["windows", "Windows"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  className={`frame-seg-btn${chrome.buttons === val ? " is-active" : ""}`}
                  style={{ textTransform: "none" }}
                  onClick={() => setChrome({ buttons: val })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {chrome.style === "window" && (
            <label className="frame-row">
              <span className="frame-label">Title</span>
              <input
                className="frame-input"
                type="text"
                value={chrome.title}
                placeholder="Window title"
                onChange={(e) => setChrome({ title: e.currentTarget.value })}
                aria-label="Window title"
              />
            </label>
          )}

          {chrome.style === "browser" && (
            <label className="frame-row">
              <span className="frame-label">URL</span>
              <input
                className="frame-input"
                type="text"
                value={chrome.url}
                placeholder="example.com"
                onChange={(e) => setChrome({ url: e.currentTarget.value })}
                aria-label="Address bar URL"
              />
            </label>
          )}
        </>
      )}

      <Slider label="Padding" value={frame.padding} onChange={(v) => setFrame({ padding: v })} />
      <Slider label="Radius" value={frame.radius} onChange={(v) => setFrame({ radius: v })} />
      <Slider label="Shadow" value={frame.shadow} onChange={(v) => setFrame({ shadow: v })} />

      <div className="frame-row">
        <span className="frame-labelrow">
          <span className="frame-label">Aspect</span>
          <Hint text={ASPECT_HINT} />
        </span>
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

/** A small info affordance: an ⓘ icon that reveals explanatory text on hover/focus.
    The tooltip is `position: fixed`, anchored to the icon via its bounding rect, so
    it escapes the frame panel's `overflow` clip (the panel scrolls, which would
    otherwise slice a tooltip drawn outside its box). It appears to the LEFT of the
    icon (the panel is right-docked, so there's always room over the canvas). */
function Hint({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Clamp vertically so a tall tooltip never clips off the top/bottom edge.
    const top = Math.min(Math.max(r.top + r.height / 2, 80), window.innerHeight - 80);
    setPos({ left: r.left - 8, top });
  };
  const hide = () => setPos(null);
  return (
    <span
      ref={ref}
      className="frame-info"
      tabIndex={0}
      role="note"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <Info size={13} strokeWidth={2} aria-hidden />
      {pos && (
        <span className="frame-tip" style={{ left: pos.left, top: pos.top }}>
          {text}
        </span>
      )}
    </span>
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
