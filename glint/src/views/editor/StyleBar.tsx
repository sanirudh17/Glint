import { ArrowLeftRight } from "lucide-react";
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
      </div>
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
            <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" />
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
          <ArrowLeftRight size={15} strokeWidth={1.75} />
        </button>
      )}
      {isText && (
        <input
          className="editor-fontsize"
          type="number"
          min={8}
          max={120}
          value={eff.fontSize}
          onChange={(e) => applyFontSize(Number(e.currentTarget.value) || 24)}
          aria-label="Font size"
        />
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
    </div>
  );
}
