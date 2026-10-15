import { ArrowLeftRight, Pipette,ChevronUp,ChevronDown } from "lucide-react";
import {Select,NumberInput} from '../../components/ui';
import {textPreset,snapArrowBend} from '../../editor/annotationStyles';
import type {Style} from '../../editor/model';
import { useEditorStore } from "../../editor/useEditorStore";
import { PALETTE as COLORS } from "../../editor/palette";

const WIDTHS: { label: string; value: number }[] = [
  { label: "S", value: 2 },
  { label: "M", value: 4 },
  { label: "L", value: 8 },
];

// Eraser footprint radius (image px). Larger = wipes a wider band per pass.
const ERASER_SIZES: { label: string; value: number }[] = [
  { label: "S", value: 8 },
  { label: "M", value: 16 },
  { label: "L", value: 30 },
];

export function StyleBar() {
  const style = useEditorStore((s) => s.style);
  const setStyle = useEditorStore((s) => s.setStyle);
  const selectedId = useEditorStore((s) => s.selectedId);
  const annotations = useEditorStore((s) => s.annotations);
  const tool = useEditorStore((s) => s.tool);
  const eraserSize = useEditorStore((s) => s.eraserSize);
  const setEraserSize = useEditorStore((s) => s.setEraserSize);
  const setSpotlightDim = useEditorStore((s) => s.setSpotlightDim);
  const picking = useEditorStore((s) => s.picking);
  const setPicking = useEditorStore((s) => s.setPicking);

  // The bar reflects the SELECTED annotation when there is one — so you can restyle
  // an existing shape (the fill/dashed/etc. controls appear for the selection, not
  // only while its draw tool is active) — otherwise it shows the active tool's
  // defaults. Applying writes to BOTH the tool default and the selection.
  const selectedAnno = selectedId ? annotations.find((a) => a.id === selectedId) : undefined;
  const effType = selectedAnno?.type ?? tool;
  const eff = selectedAnno?.style ?? style;

  // Reads FRESH store state (not a render-time closure) so a style change always
  // lands on whatever is currently selected — this is what makes the opacity/fill
  // edits reliably update the shape.
  const patchSelected = (patch: Partial<typeof style>, hist = true) => {
    const st = useEditorStore.getState();
    if (!st.selectedId) return;
    const anno = st.annotations.find((a) => a.id === st.selectedId);
    if (!anno) return;
    if (hist) st.pushHistory();
    st.update(st.selectedId, { style: { ...anno.style, ...patch } } as never);
  };
  const applyColor = (color: string) => { setStyle({ color }); patchSelected({ color }); };
  const applyWidth = (strokeWidth: number) => { setStyle({ strokeWidth }); patchSelected({ strokeWidth }); };
  const applyFill = (fill: string | null) => { setStyle({ fill }); patchSelected({ fill }); };
  const applyDashed = (dashed: boolean) => { setStyle({ dashed }); patchSelected({ dashed }); };
  const applyArrowStart = (arrowStart: boolean) => { setStyle({ arrowStart }); patchSelected({ arrowStart }); };
  // Font size + opacity change continuously — don't push a history entry per tick.
  // Opacity captures ONE history entry at drag start (onPointerDown) so the whole
  // slide is a single undo; typing a font size just isn't tracked in history.
  const applyFontSize = (fontSize: number) => { setStyle({ fontSize }); patchSelected({ fontSize }, false); };
  const applyFillOpacity = (fillOpacity: number) => { setStyle({ fillOpacity }); patchSelected({ fillOpacity }, false); };
  const applyRedactStyle = (redactStyle: "solid" | "pixelate") => { setStyle({ redactStyle }); patchSelected({ redactStyle }); };
  const applyRegion = (region: "rect" | "ellipse") => { setStyle({ region }); patchSelected({ region }); };
  const applyDim = (fillOpacity: number) => { setStyle({ fillOpacity }); setSpotlightDim(fillOpacity); };

  const isShape = effType === "rect" || effType === "ellipse";
  const isStroke = isShape || effType === "line" || effType === "arrow";
  const isArrow = effType === "arrow";
  const isText = effType === "text";
  const isRedact = effType === "redact";
  const isSpotlight = effType === "spotlight";

  const current = eff.color.toLowerCase();
  const isPreset = COLORS.some((c) => c.toLowerCase() === current);

  // Select ("cursor") is purely for moving/picking shapes — it has no style of its
  // own. With nothing selected there's nothing to restyle, so show an EMPTY bar (no
  // colors, no S/M/L). The controls only reappear once a shape is selected, where
  // they legitimately restyle that shape. Keeps the toolbar row height stable.
  if (tool === "select" && !selectedAnno) {
    return <div className="editor-stylebar" role="toolbar" aria-label="Style" />;
  }
  if(effType==='image')return <div className="editor-stylebar" role="toolbar" aria-label="Style"><span className="editor-status">Image layer · drag or resize on canvas</span></div>;

  // Eraser has no color/stroke — only a footprint size. Show just that so the
  // S/M/L controls unambiguously mean the eraser radius (not pen thickness).
  if (tool === "eraser") {
    return (
      <div className="editor-stylebar" role="toolbar" aria-label="Eraser">
        <span className="editor-status">Eraser size</span>
        <div className="editor-widths">
          {ERASER_SIZES.map((sz) => (
            <button
              key={sz.value}
              className={`editor-width${eraserSize === sz.value ? " editor-width--active" : ""}`}
              title={`Eraser ${sz.label}`}
              aria-label={`Eraser ${sz.label}`}
              onClick={() => setEraserSize(sz.value)}
            >
              {sz.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="editor-stylebar" role="toolbar" aria-label="Style">
      {/* A spotlight has no color or stroke — it's a dimmed cut-out. Show only its own
          controls (shape + dim, below); hide the color swatches and S/M/L widths that
          don't apply to it. */}
      {!isSpotlight && (
      <div className="editor-swatches">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`editor-swatch${c.toLowerCase() === current ? " editor-swatch--active" : ""}`}
            style={{ background: c }}
            title={c}
            aria-label={`Color ${c}`}
            onClick={() => applyColor(c)}
          />
        ))}
        {/* Custom color — opens the OS spectrum/hex picker. Active ring when the
            current color isn't one of the presets. Local-first: a native input. */}
        <label
          className={`editor-swatch editor-swatch--custom${isPreset ? "" : " editor-swatch--active"}`}
          style={{ background: isPreset ? undefined : eff.color }}
          title="Custom color"
        >
          <input
            type="color"
            value={eff.color}
            onChange={(e) => applyColor(e.currentTarget.value)}
            aria-label="Custom color"
          />
        </label>
        {/* Eyedropper picks a color for the NEXT annotation, so it only appears with
            a drawing tool active — not in select ("cursor") mode, where it's a no-op
            that just confuses. */}
        {tool !== "select" && (
          <button
            className={`editor-swatch editor-eyedrop${picking ? " editor-eyedrop--active" : ""}`}
            title="Pick a color from the image (I)"
            aria-label="Eyedropper"
            onClick={() => setPicking(!picking)}
          >
            <Pipette size={14} strokeWidth={1.5} />
          </button>
        )}
      </div>
      )}
      {!isSpotlight && (
      <div className="editor-widths">
        {WIDTHS.map((w) => (
          <button
            key={w.value}
            className={`editor-width${eff.strokeWidth === w.value ? " editor-width--active" : ""}`}
            title={`Stroke ${w.label}`}
            aria-label={`Stroke ${w.label}`}
            onClick={() => applyWidth(w.value)}
          >
            {w.label}
          </button>
        ))}
      </div>
      )}
      {isShape && (
        <div className="editor-fillgroup">
          <button
            className={`editor-width${!eff.fill ? " editor-width--active" : ""}`}
            title="No fill"
            aria-label="No fill"
            onClick={() => applyFill(null)}
          >
            ⦸
          </button>
          <label className="editor-swatch editor-swatch--custom" title="Fill color" style={{ background: eff.fill ?? undefined }}>
            <input
              type="color"
              value={eff.fill ?? "#ffffff"}
              onChange={(e) => applyFill(e.currentTarget.value)}
              aria-label="Fill color"
            />
          </label>
          {/* Opacity only appears when a shape is picked with the CURSOR (select
              tool) — not while a draw tool is active (where the just-drawn shape is
              still technically selected). It edits the picked shape's transparency. */}
          {tool === "select" && selectedAnno && eff.fill && (
            <input
              className="editor-opacity"
              type="range"
              min={0} max={100}
              value={Math.round((eff.fillOpacity ?? 1) * 100)}
              onPointerDown={() => { const st = useEditorStore.getState(); if (st.selectedId) st.pushHistory(); }}
              onChange={(e) => applyFillOpacity(Number(e.currentTarget.value) / 100)}
              aria-label="Fill opacity"
              title="Fill opacity"
            />
          )}
        </div>
      )}
      {isStroke && (
        <button
          className={`editor-width${eff.dashed ? " editor-width--active" : ""}`}
          title="Dashed stroke"
          aria-label="Toggle dashed stroke"
          onClick={() => applyDashed(!eff.dashed)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 8h3 M10 8h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {isArrow && (
        <button
          className={`editor-width${eff.arrowStart ? " editor-width--active" : ""}`}
          title="Head at start too"
          aria-label="Toggle start arrowhead"
          onClick={() => applyArrowStart(!eff.arrowStart)}
        >
          <ArrowLeftRight size={15} strokeWidth={1.5} />
        </button>
      )}
      {isArrow&&<label className="editor-bend"><span>Bend</span><span className="editor-bend-track">
        <input type="range" min={-100} max={100} value={Math.round((eff.curve??0)*100)} aria-label="Arrow bend"
          aria-valuetext={(eff.curve??0)===0?'Straight':`${Math.round((eff.curve??0)*100)}% bend`} title="Center snaps to a straight arrow"
          onPointerDown={()=>{if(selectedAnno)useEditorStore.getState().pushHistory();}}
          onKeyDown={e=>{
            if(!e.key.startsWith('Arrow'))return;
            e.stopPropagation();
            e.preventDefault();if(selectedAnno)useEditorStore.getState().pushHistory();
            const direction=e.key==='ArrowRight'||e.key==='ArrowUp'?1:-1,curve=snapArrowBend(Math.round((eff.curve??0)*100)+direction*10);
            setStyle({curve});patchSelected({curve},false);
          }}
          onChange={e=>{const curve=snapArrowBend(Number(e.target.value));setStyle({curve});patchSelected({curve},false);}}/>
      </span></label>}
      {isText && (
        <><div className="editor-text-preset"><Select portal ariaLabel="Text style" value={eff.textPreset??'plain'} options={['plain','heading','label','code'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))} onChange={preset=>{const patch=textPreset(preset as NonNullable<Style['textPreset']>);setStyle(patch);patchSelected(patch);}}/></div><div className="editor-text-size"><NumberInput min={8} max={120} ariaLabel="Font size" value={eff.fontSize} onChange={value=>{if(value!==eff.fontSize){if(selectedAnno)useEditorStore.getState().pushHistory();applyFontSize(value);}}}/></div></>
      )}
      {isRedact && (
        <div className="editor-widths" role="group" aria-label="Redaction style">
          <button
            className={`editor-toggle${(eff.redactStyle ?? "solid") === "solid" ? " editor-toggle--active" : ""}`}
            title="Solid block"
            aria-label="Solid block"
            onClick={() => applyRedactStyle("solid")}
          >
            Solid
          </button>
          <button
            className={`editor-toggle${eff.redactStyle === "pixelate" ? " editor-toggle--active" : ""}`}
            title="Pixelate"
            aria-label="Pixelate"
            onClick={() => applyRedactStyle("pixelate")}
          >
            Pixel
          </button>
        </div>
      )}
      {isSpotlight && (
        <>
          <div className="editor-widths" role="group" aria-label="Spotlight shape">
            <button
              className={`editor-width${(eff.region ?? "rect") === "rect" ? " editor-width--active" : ""}`}
              title="Rectangle" aria-label="Rectangle"
              onClick={() => applyRegion("rect")}
            >
              ▭
            </button>
            <button
              className={`editor-width${eff.region === "ellipse" ? " editor-width--active" : ""}`}
              title="Ellipse" aria-label="Ellipse"
              onClick={() => applyRegion("ellipse")}
            >
              ◯
            </button>
          </div>
          <input
            className="editor-opacity"
            type="range"
            min={10} max={90}
            value={Math.round((eff.fillOpacity ?? 0.6) * 100)}
            onPointerDown={() => { const st = useEditorStore.getState(); if (st.selectedId) st.pushHistory(); }}
            onChange={(e) => applyDim(Number(e.currentTarget.value) / 100)}
            aria-label="Dim strength"
            title="Dim strength"
          />
        </>
      )}
      {selectedAnno&&<div className="editor-layer-actions" role="group" aria-label="Annotation layer order"><button className="editor-width" aria-label="Bring annotation forward" title="Bring forward" disabled={annotations.filter(a=>a.type!=='image').slice(-1)[0]?.id===selectedAnno.id} onClick={()=>useEditorStore.getState().bringForward(selectedAnno.id)}><ChevronUp size={16}/></button><button className="editor-width" aria-label="Send annotation backward" title="Send backward" disabled={annotations.find(a=>a.type!=='image')?.id===selectedAnno.id} onClick={()=>useEditorStore.getState().sendBackward(selectedAnno.id)}><ChevronDown size={16}/></button></div>}
    </div>
  );
}
