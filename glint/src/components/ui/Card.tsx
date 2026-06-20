import "./ui.css";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={["g-card", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
