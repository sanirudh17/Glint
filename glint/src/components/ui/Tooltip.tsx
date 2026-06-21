import "./ui.css";

interface TooltipProps {
  label: string;
  /** Which side the bubble opens toward. Use "right" inside the narrow nav rail. */
  side?: "top" | "right";
  children: React.ReactNode;
}

export function Tooltip({ label, side = "top", children }: TooltipProps) {
  return (
    <span className="g-tooltip-root">
      {children}
      <span
        className={`g-tooltip-bubble${side === "right" ? " g-tooltip-bubble--right" : ""}`}
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}
