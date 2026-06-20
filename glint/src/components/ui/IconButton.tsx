import type { LucideIcon } from "lucide-react";
import "./ui.css";

interface IconButtonProps {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}

export function IconButton({
  label,
  icon: Icon,
  onClick,
  active = false,
  disabled = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={[
        "g-icon-btn",
        active ? "g-icon-btn--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
