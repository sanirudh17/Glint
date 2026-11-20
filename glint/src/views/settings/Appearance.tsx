import { Check } from "../../icons";
import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore, ACCENT_PALETTE, type Theme } from "../../store/useAppStore";

const THEME_OPTIONS = [
  { value: "dark",   label: "Dark" },
  { value: "light",  label: "Light" },
  { value: "system", label: "System" },
];

export function Appearance() {
  // Atomic selectors — a single object-returning selector is an infinite
  // re-render under Zustand v5's Object.is equality (see HomeView).
  const settings = useAppStore((s) => s.settings);
  const setGlass = useAppStore((s) => s.setGlass);
  const setTheme = useAppStore((s) => s.setTheme);
  const setAccent = useAppStore((s) => s.setAccent);

  if (!settings) return null;

  return (
    <Section title="Appearance">
      <Field label="Theme">
        <Select
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(v) => void setTheme(v as Theme)}
          ariaLabel="Theme"
        />
      </Field>

      <Field label="Accent colour">
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
                onClick={() => void setAccent(entry.accent)}
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
      <Field label="Acrylic glass">
        <Switch checked={settings.glass ?? true} onChange={v=>void setGlass(v)} />
      </Field>
    </Section>
  );
}
