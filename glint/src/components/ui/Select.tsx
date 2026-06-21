import { ChevronDown } from "lucide-react";
import "./ui.css";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name for the underlying <select> when there's no visible <label for>. */
  ariaLabel?: string;
  /** When true, the control is inert and styled as unavailable. */
  disabled?: boolean;
}

export function Select({ value, options, onChange, ariaLabel, disabled = false }: SelectProps) {
  return (
    <div className={`g-select-wrap${disabled ? " g-select-wrap--disabled" : ""}`}>
      <select
        className="g-select"
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="g-select-chevron" aria-hidden="true">
        <ChevronDown size={14} strokeWidth={1.75} />
      </span>
    </div>
  );
}
