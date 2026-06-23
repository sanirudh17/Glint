import { useEditorStore } from "../../editor/useEditorStore";
import { PALETTE as COLORS } from "../../editor/palette";

const WIDTHS: { label: string; value: number }[] = [
  { label: "S", value: 2 },
  { label: "M", value: 4 },
  { label: "L", value: 8 },
];

export function StyleBar() {
  const style = useEditorStore((s) => s.style);
  const setStyle = useEditorStore((s) => s.setStyle);
  const selectedId = useEditorStore((s) => s.selectedId);
  const update = useEditorStore((s) => s.update);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const tool = useEditorStore((s) => s.tool);

  // Applying a style updates the current tool default AND the selection (if any).
  // The selection's patch merges onto the annotation's OWN style, not the global
  // tool style — otherwise recoloring a shape would clobber its stroke width with
  // whatever the global tool width currently is.
  const patchSelected = (patch: Partial<typeof style>) => {
    if (!selectedId) return;
    const anno = useEditorStore.getState().annotations.find((a) => a.id === selectedId);
    if (!anno) return;
    pushHistory();
    update(selectedId, { style: { ...anno.style, ...patch } } as never);
  };
  const applyColor = (color: string) => {
    setStyle({ color });
    patchSelected({ color });
  };
  const applyWidth = (strokeWidth: number) => {
    setStyle({ strokeWidth });
    patchSelected({ strokeWidth });
  };

  const current = style.color.toLowerCase();
  const isPreset = COLORS.some((c) => c.toLowerCase() === current);

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
            current color isn't one of the presets. Local-first: a native input,
            no library. */}
        <label
          className={`editor-swatch editor-swatch--custom${isPreset ? "" : " editor-swatch--active"}`}
          style={{ background: isPreset ? undefined : style.color }}
          title="Custom color"
        >
          <input
            type="color"
            value={style.color}
            onChange={(e) => applyColor(e.currentTarget.value)}
            aria-label="Custom color"
          />
        </label>
      </div>
      <div className="editor-widths">
        {WIDTHS.map((w) => (
          <button
            key={w.value}
            className={`editor-width${style.strokeWidth === w.value ? " editor-width--active" : ""}`}
            title={`Stroke ${w.label}`}
            aria-label={`Stroke ${w.label}`}
            onClick={() => applyWidth(w.value)}
          >
            {w.label}
          </button>
        ))}
      </div>
      {tool === "text" && (
        <input
          className="editor-fontsize"
          type="number"
          min={8}
          max={120}
          value={style.fontSize}
          onChange={(e) => setStyle({ fontSize: Number(e.currentTarget.value) || 24 })}
          aria-label="Font size"
        />
      )}
    </div>
  );
}
