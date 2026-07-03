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
  const setImageFormat = useAppStore((s) => s.setImageFormat);
  const setJpegQuality = useAppStore((s) => s.setJpegQuality);
  const setIncludeCursor = useAppStore((s) => s.setIncludeCursor);
  const isJpeg = (settings?.image_format ?? "png") === "jpeg";
  return (
    <Section
      title="Capture"
      description="Format and quality settings for screenshots."
    >
      <Field label="Image format" hint="File format for saved screenshots.">
        <Select
          value={settings?.image_format ?? "png"}
          options={FORMAT_OPTIONS}
          onChange={(v) => void setImageFormat(v as "png" | "jpeg" | "webp")}
        />
      </Field>
      <Field label="JPEG quality" hint="Compression level when saving as JPEG.">
        <Select
          value={settings?.jpeg_quality ?? "high"}
          options={QUALITY_OPTIONS}
          onChange={(v) => void setJpegQuality(v as "high" | "medium" | "low")}
          disabled={!isJpeg}
        />
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
