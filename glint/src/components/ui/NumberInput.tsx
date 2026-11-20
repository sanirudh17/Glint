import { useEffect, useId, useState } from "react";
import { Minus, Plus } from "../../icons";
import "./ui.css";

/** Numeric editing and stepping without the operating system's spinner chrome. */
export function NumberInput({ value, onChange, min = 0, max, step = 1, unit, ariaLabel, disabled = false, live = false }: {
  value: number; onChange: (value: number) => void; min?: number; max: number;
  step?: number; unit?: string; ariaLabel: string; disabled?: boolean; live?: boolean;
}) {
  const id = useId();
  // Show values at the step's precision (0.1 → one decimal), never raw float noise
  // like 3.7540065673; an untouched field never rewrites its underlying value.
  const decimals = (String(step).split(".")[1] ?? "").length;
  const show = (n: number) => String(Number(n.toFixed(decimals)));
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value, decimals]);
  const clamp = (number: number) => Math.min(max, Math.max(min, Number((Math.round(number / step) * step).toFixed(decimals))));
  const number = draft.trim() ? Number(draft) : value;
  const pending = Number.isFinite(number) ? clamp(number) : value;
  const commit = () => {
    if(draft===show(value))return;
    setDraft(show(pending)); onChange(pending);
  };
  const bump = (direction: number) => {
    const next = clamp(pending + direction * step);
    setDraft(show(next)); onChange(next);
  };
  return <div className="g-number-input" data-editor-control>
    <input id={id} type="text" inputMode="numeric" role="spinbutton" aria-label={ariaLabel}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} disabled={disabled}
      value={draft} onBlur={commit}
      onChange={(e) => {
        const next = e.target.value; if (!/^-?\d*(?:\.\d*)?$/.test(next)) return;
        setDraft(next);
        const number=next.trim()?Number(next):NaN;
        if(live&&Number.isFinite(number)&&number>=min&&number<=max)onChange(clamp(number));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(show(value)); }
      }} />
    {unit && <span className="g-number-unit" aria-hidden>{unit}</span>}
    <button type="button" disabled={disabled || pending <= min} aria-label={`Decrease ${ariaLabel.toLowerCase()}`} onClick={() => bump(-1)}><Minus size={12} /></button>
    <button type="button" disabled={disabled || pending >= max} aria-label={`Increase ${ariaLabel.toLowerCase()}`} onClick={() => bump(1)}><Plus size={12} /></button>
  </div>;
}
