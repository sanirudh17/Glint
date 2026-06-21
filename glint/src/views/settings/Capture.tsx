import { Info } from "lucide-react";
import { Section, Field, Select } from "../../components/ui";

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
      <Field label="Include cursor" hint="Capture the mouse pointer in screenshots.">
        <span className="settings-phase-note" style={{ marginTop: 0 }}>
          <Info size={12} strokeWidth={1.75} />
          Available in a later phase
        </span>
      </Field>
    </Section>
  );
}
