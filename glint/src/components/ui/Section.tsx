import "./ui.css";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="g-section">
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
