import "./ui.css";

export function ColorControl({ value, onChange, ariaLabel }: {
  value: string; onChange: (value: string) => void; ariaLabel: string;
}) {
  return <label className="g-color-control" title={value}>
    <span className="g-color-chip" style={{ backgroundColor: value }} aria-hidden />
    <span className="g-color-value" aria-hidden>{value.toUpperCase()}</span>
    <input type="color" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  </label>;
}
