import "./ui.css";

interface TooltipProps {
  label: string;
  children: React.ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  return (
    <span className="g-tooltip-root">
      {children}
      <span className="g-tooltip-bubble" role="tooltip">
        {label}
      </span>
    </span>
  );
}
