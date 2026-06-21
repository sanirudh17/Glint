import { Check } from "lucide-react";
import { Section, Field, Select } from "../../components/ui";
import { useAppStore, ACCENT_PALETTE, type Theme } from "../../store/useAppStore";

const THEME_OPTIONS = [
  { value: "dark",   label: "Dark" },
  { value: "light",  label: "Light" },
  { value: "system", label: "System" },
];

export function Appearance() {
  const { settings, setTheme, setAccent } = useAppStore((s) => ({
    settings:  s.settings,
    setTheme:  s.setTheme,
    setAccent: s.setAccent,
  }));

  if (!settings) return null;

  return (
    <Section
      title="Appearance"
      description="Controls how Glint looks. Theme and accent persist across restarts."
    >
      <Field label="Theme">
        <Select
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(v) => setTheme(v as Theme)}
          ariaLabel="Theme"
        />
      </Field>

      <Field
        label="Accent colour"
        hint="Used for active states, focus rings, and primary actions."
      >
        <div className="settings-accent-row" role="radiogroup" aria-label="Accent colour">
          {ACCENT_PALETTE.map((entry) => {
            const active =
              settings.accent.toLowerCase() === entry.accent.toLowerCase();
            return (
              <button
                key={entry.accent}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={entry.name}
                title={entry.name}
                className={[
                  "settings-accent-swatch",
                  active ? "settings-accent-swatch--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--swatch-color": entry.accent } as React.CSSProperties}
                onClick={() => setAccent(entry.accent)}
              >
                {active && (
                  <Check
                    size={12}
                    strokeWidth={2.5}
                    className="settings-accent-check"
                  />
                )}
              </button>
            );
          })}
        </div>
      </Field>
    </Section>
  );
}
