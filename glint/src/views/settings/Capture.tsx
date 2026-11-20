import { OcrEngineControls } from "../../ocr/OcrEngineControls";
import { Section, SettingsGroup, Field, Select, Switch } from "../../components/ui";
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

const DELAY_OPTIONS = [
  { value: "3",  label: "3 seconds" },
  { value: "5",  label: "5 seconds" },
  { value: "10", label: "10 seconds" },
];

export function Capture() {
  const settings = useAppStore((s) => s.settings);
  const setImageFormat = useAppStore((s) => s.setImageFormat);
  const setJpegQuality = useAppStore((s) => s.setJpegQuality);
  const setIncludeCursor = useAppStore((s) => s.setIncludeCursor);
  const setCaptureDelay = useAppStore((s) => s.setCaptureDelay);
  const setOpenInEditor=useAppStore(s=>s.setOpenInEditor);
  const setCaptureOnRelease=useAppStore(s=>s.setCaptureOnRelease);
  const setHideDesktopIcons=useAppStore(s=>s.setHideDesktopIcons);
  const setQuickAccessAutoClose=useAppStore(s=>s.setQuickAccessAutoClose);
  const setIndexScreenshotText = useAppStore(s => s.setIndexScreenshotText);
  const isJpeg = (settings?.image_format ?? "png") === "jpeg";
  return (
    <Section title="Capture">
      <SettingsGroup title="Screenshots">
        <Field label="Format">
          <Select
            value={settings?.image_format ?? "png"}
            options={FORMAT_OPTIONS}
            onChange={(v) => void setImageFormat(v as "png" | "jpeg" | "webp")}
          />
        </Field>
        {isJpeg && (
          <Field label="JPEG quality">
            <Select
              value={settings?.jpeg_quality ?? "high"}
              options={QUALITY_OPTIONS}
              onChange={(v) => void setJpegQuality(v as "high" | "medium" | "low")}
            />
          </Field>
        )}
        <Field label="Include cursor">
          <Switch
            checked={settings?.include_cursor ?? false}
            onChange={(v) => void setIncludeCursor(v)}
          />
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Capturing">
        <Field label="Capture on mouse release">
          <Switch ariaLabel="Capture on mouse release" checked={settings?.capture_on_release??false} onChange={on=>void setCaptureOnRelease(on)}/>
        </Field>
        <Field label="Delayed capture countdown">
          <Select
            value={String(settings?.capture_delay_secs ?? 5)}
            options={DELAY_OPTIONS}
            onChange={(v) => void setCaptureDelay(Number(v) as 3 | 5 | 10)}
          />
        </Field>
        <Field label="Hide desktop icons while capturing">
          <Switch ariaLabel="Hide desktop icons" checked={settings?.hide_desktop_icons??false} onChange={on=>void setHideDesktopIcons(on)}/>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="After capture">
        <Field label="Open in editor after capture">
          <Switch ariaLabel="Open in editor after capture" checked={settings?.open_in_editor??false} onChange={on=>void setOpenInEditor(on)}/>
        </Field>
        <Field label="Close Quick Access when idle">
          <Switch ariaLabel="Auto-close Quick Access" checked={settings?.quick_access_auto_close??false} onChange={on=>void setQuickAccessAutoClose(on)}/>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Text">
        <OcrEngineControls />
        <Field label="Search text in screenshots">
          <Switch ariaLabel="Search screenshot text" checked={settings?.index_screenshot_text ?? true} onChange={v => void setIndexScreenshotText(v)} />
        </Field>
      </SettingsGroup>
    </Section>
  );
}
