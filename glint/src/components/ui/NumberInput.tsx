import { useEffect, useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import "./ui.css";

/** Numeric editing and stepping without the operating system's spinner chrome. */
export function NumberInput({ value, onChange, min = 0, max, step = 1, unit, ariaLabel, disabled = false }: {
  value: number; onChange: (value: number) => void; min?: number; max: number;
  step?: number; unit?: string; ariaLabel: string; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const clamp = (number: number) => Math.min(max, Math.max(min, Math.round(number / step) * step));
  const commit = () => {
    const number = draft.trim() ? Number(draft) : value;
    const next = Number.isFinite(number) ? clamp(number) : value;
    setDraft(String(next)); onChange(next);
  };
  const bump = (direction: number) => {
    const next = clamp(value + direction * step);
    setDraft(String(next)); onChange(next);
  };
  return <div className="g-number-input" data-editor-control>
    <input id={id} type="text" inputMode="numeric" role="spinbutton" aria-label={ariaLabel}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} disabled={disabled}
      value={draft} onBlur={commit}
      onChange={(e) => {
        const next = e.target.value; if (!/^-?\d*(?:\.\d*)?$/.test(next)) return;
        setDraft(next);
        const number = Number(next);
        if (next.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(clamp(number));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
        if (e.key === "Enter") { e.preventDefault(); commit(); }
      }} />
    {unit && <span className="g-number-unit" aria-hidden>{unit}</span>}
    <button type="button" disabled={disabled || value <= min} aria-label={`Decrease ${ariaLabel.toLowerCase()}`} onClick={() => bump(-1)}><Minus size={12} /></button>
    <button type="button" disabled={disabled || value >= max} aria-label={`Increase ${ariaLabel.toLowerCase()}`} onClick={() => bump(1)}><Plus size={12} /></button>
  </div>;
}
