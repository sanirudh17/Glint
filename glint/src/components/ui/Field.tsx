import { Children, cloneElement, isValidElement, useId } from "react";
import { Select } from "./Select";
import { Switch } from "./Switch";
import "./ui.css";

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="g-field" role="group" aria-labelledby={`${id}-label`} aria-describedby={hint ? `${id}-hint` : undefined}>
      <span id={`${id}-label`} className="g-field-label">{label}</span>
      {Children.map(children, child => {
        if (isValidElement<{ ariaLabel?: string }>(child) && (child.type === Select || child.type === Switch)) {
          return cloneElement(child, { ariaLabel: child.props.ariaLabel ?? label });
        }
        return child;
      })}
      {hint && <span id={`${id}-hint`} className="g-field-hint">{hint}</span>}
    </div>
  );
}
