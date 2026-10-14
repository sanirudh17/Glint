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
  const number = draft.trim() ? Number(draft) : value;
  const pending = Number.isFinite(number) ? clamp(number) : value;
  const commit = () => {
    setDraft(String(pending)); onChange(pending);
  };
  const bump = (direction: number) => {
    const next = clamp(pending + direction * step);
    setDraft(String(next)); onChange(next);
  };
  return <div className="g-number-input" data-editor-control>
    <input id={id} type="text" inputMode="numeric" role="spinbutton" aria-label={ariaLabel}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} disabled={disabled}
      value={draft} onBlur={commit}
      onChange={(e) => {
        const next = e.target.value; if (!/^-?\d*(?:\.\d*)?$/.test(next)) return;
        setDraft(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(String(value)); }
      }} />
    {unit && <span className="g-number-unit" aria-hidden>{unit}</span>}
    <button type="button" disabled={disabled || pending <= min} aria-label={`Decrease ${ariaLabel.toLowerCase()}`} onClick={() => bump(-1)}><Minus size={12} /></button>
    <button type="button" disabled={disabled || pending >= max} aria-label={`Increase ${ariaLabel.toLowerCase()}`} onClick={() => bump(1)}><Plus size={12} /></button>
  </div>;
}
