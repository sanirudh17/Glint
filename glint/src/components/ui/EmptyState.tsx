import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import "./ui.css";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <div className="g-empty">
      <span className="g-empty-icon" aria-hidden="true">
        <Icon size={32} strokeWidth={1.25} />
      </span>
      <p className="g-empty-title">{title}</p>
      {hint && <p className="g-empty-hint">{hint}</p>}
      {action && (
        <Button variant="subtle" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
