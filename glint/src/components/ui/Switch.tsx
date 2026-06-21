import { useId } from "react";
import "./ui.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}

export function Switch({ checked, onChange, label, id }: SwitchProps) {
  const generatedId = useId();
  const inputId = id ?? `g-switch-${generatedId}`;
  return (
    <label className="g-switch-root" htmlFor={inputId}>
      <div className="g-switch-track">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          role="switch"
          aria-checked={checked}
        />
      </div>
      {label && <span className="g-switch-label">{label}</span>}
    </label>
  );
}
