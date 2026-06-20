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
}

export function Select({ value, options, onChange }: SelectProps) {
  return (
    <div className="g-select-wrap">
      <select
        className="g-select"
        value={value}
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
