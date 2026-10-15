import { LookControls } from "../../look/LookControls";
import "../../look/look.css";
import { useEditorStore } from "../../editor/useEditorStore";
import { paletteFromPixels } from "../../look/gradientRender";

/**
 * Right-docked frame controls: background type (solid/gradient/transparent),
 * the matching color/gradient picker, padding/radius/shadow sliders, an aspect
 * preset selector, and Reset affordances. Each control checkpoints history at the
 * start of its gesture (slider pointer-down, discrete click, text focus) so undo
 * backs out one gesture at a time; crop is reset here too.
 */
export function FramePanel() {
  const frame = useEditorStore((s) => s.frame);
  const setFrame = useEditorStore((s) => s.setFrame);
  const setChrome = useEditorStore((s) => s.setChrome);
  const resetFrame = useEditorStore((s) => s.resetFrame);
  const crop = useEditorStore((s) => s.crop);
  const resetCrop = useEditorStore((s) => s.resetCrop);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const chrome = frame.chrome;
  const base = useEditorStore((s)=>s.base);
  const canvasSize=useEditorStore(s=>s.canvasSize);
  const sample = () => {
    const base=useEditorStore.getState().base,canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const ctx=canvas.getContext('2d')!;if(base)ctx.drawImage(base.image,0,0,64,64);
    return paletteFromPixels(ctx.getImageData(0,0,64,64).data);
  };

  return (
    <aside className="frame-panel" aria-label="Frame">
      <LookControls look={frame} onChange={setFrame} checkpoint={pushHistory} onSample={sample} dimensions={base?{width:crop?.w??canvasSize?.width??base.width,height:crop?.h??canvasSize?.height??base.height}:undefined}/>

      <div className="frame-row">
        <span className="frame-label">Window</span>
        <div className="frame-seg">
          {(["none", "window", "browser"] as const).map((st) => (
            <button
              key={st}
              className={`frame-seg-btn${chrome.style === st ? " is-active" : ""}`}
              onClick={() => {
                if (chrome.style !== st) pushHistory();
                setChrome({ style: st });
              }}
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
                  onClick={() => {
                    if (chrome.theme !== th) pushHistory();
                    setChrome({ theme: th });
                  }}
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
                  onClick={() => {
                    if (chrome.buttons !== val) pushHistory();
                    setChrome({ buttons: val });
                  }}
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
                onFocus={() => pushHistory()}
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
                onFocus={() => pushHistory()}
                onChange={(e) => setChrome({ url: e.currentTarget.value })}
                aria-label="Address bar URL"
              />
            </label>
          )}
        </>
      )}

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

