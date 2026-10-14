import { useId } from "react";
import "./ui.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  ariaLabel?: string;
  id?: string;
  /** When true, the control is inert and styled as unavailable. */
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, ariaLabel, id, disabled = false }: SwitchProps) {
  const generatedId = useId();
  const inputId = id ?? `g-switch-${generatedId}`;
  return (
    <label
      className={`g-switch-root${disabled ? " g-switch-root--disabled" : ""}`}
      htmlFor={inputId}
    >
      <div className="g-switch-track">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel ?? label}
        />
      </div>
      {label && <span className="g-switch-label">{label}</span>}
    </label>
  );
}
