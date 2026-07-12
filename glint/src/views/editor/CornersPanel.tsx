import { useEditorStore } from "../../editor/useEditorStore";

/**
 * Right-docked standalone corner-rounding control, independent of the decorative
 * Frame. Rounds the screenshot's corners; the exported PNG trims those corners to
 * transparent — no background, padding, or shadow. Shown only when the Frame is off
 * (with the Frame on, the Frame panel's Radius governs the card's rounding instead).
 * The radius is a 0–100 % of the shorter edge, so 100 % fully rounds the short axis.
 */
export function CornersPanel() {
  const cornerRadius = useEditorStore((s) => s.cornerRadius);
  const setCornerRadius = useEditorStore((s) => s.setCornerRadius);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  return (
    <aside className="frame-panel" aria-label="Corners">
      <div className="frame-row">
        <span className="frame-label">Corners</span>
      </div>
      <p className="frame-note">
        Rounds the screenshot's corners. Export trims them to transparent — no background added.
      </p>
      <label className="frame-slider">
        <span className="frame-label">Radius</span>
        <input
          type="range"
          min={0}
          max={100}
          value={cornerRadius}
          onPointerDown={() => pushHistory()}
          onChange={(e) => setCornerRadius(Number(e.currentTarget.value))}
        />
      </label>
      <div className="frame-actions">
        <button
          className="frame-text-btn"
          onClick={() => {
            if (cornerRadius !== 0) pushHistory();
            setCornerRadius(0);
          }}
        >
          Reset corners
        </button>
      </div>
    </aside>
  );
}
