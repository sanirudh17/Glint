import "./ui.css";

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="g-field">
      <span className="g-field-label">{label}</span>
      {children}
      {hint && <span className="g-field-hint">{hint}</span>}
    </div>
  );
}
