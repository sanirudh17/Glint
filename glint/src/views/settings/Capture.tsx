import { Info } from "lucide-react";
import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

const FORMAT_OPTIONS = [
  { value: "png",  label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

const QUALITY_OPTIONS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

export function Capture() {
  const settings = useAppStore((s) => s.settings);
  const setIncludeCursor = useAppStore((s) => s.setIncludeCursor);
  return (
    <Section
      title="Capture"
      description="Format and quality settings for screenshots."
    >
      <Field label="Image format" hint="File format for saved screenshots.">
        <div className="settings-inert-control">
          <Select
            value="png"
            options={FORMAT_OPTIONS}
            onChange={() => {}}
            disabled
          />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="JPEG quality" hint="Compression level when saving as JPEG.">
        <div className="settings-inert-control">
          <Select
            value="high"
            options={QUALITY_OPTIONS}
            onChange={() => {}}
            disabled
          />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Include cursor" hint="Bake the mouse pointer into screenshots.">
        <Switch
          checked={settings?.include_cursor ?? false}
          onChange={(v) => void setIncludeCursor(v)}
        />
      </Field>
    </Section>
  );
}
