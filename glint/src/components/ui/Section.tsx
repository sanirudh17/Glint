import "./ui.css";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Extra class on the <section> — e.g. to widen a specific settings panel. */
  className?: string;
}

export function Section({ title, description, children, className }: SectionProps) {
  return (
    <section className={`g-section${className ? ` ${className}` : ""}`}>
      <div className="g-section-header">
        <h2 className="g-section-title">{title}</h2>
        {description && (
          <p className="g-section-description">{description}</p>
        )}
      </div>
      <div className="g-section-body">{children}</div>
    </section>
  );
}
