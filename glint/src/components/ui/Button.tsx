import type { LucideIcon } from "lucide-react";
import "./ui.css";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "subtle";
  size?: "sm" | "md";
  icon?: LucideIcon;
  children?: React.ReactNode;
}

export function Button({
  variant = "subtle",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      className={[
        "g-btn",
        `g-btn-${variant}`,
        `g-btn-${size}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {Icon && <Icon size={iconSize} strokeWidth={1.75} />}
      {children && <span>{children}</span>}
    </button>
  );
}
