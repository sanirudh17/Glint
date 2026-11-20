import "./ui.css";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  /** Extra class on the <section> — e.g. to widen a specific settings panel. */
  className?: string;
}

/** A settings page: one title, then rows. No tagline — the rows speak for themselves. */
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={`g-section${className ? ` ${className}` : ""}`}>
      <h2 className="g-section-title">{title}</h2>
      <div className="g-section-body">{children}</div>
    </section>
  );
}

/** A titled run of rows inside a Section (e.g. Recording → Audio). */
export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="g-group" role="group" aria-label={title}>
      <h3 className="g-group-title">{title}</h3>
      {children}
    </div>
  );
}
