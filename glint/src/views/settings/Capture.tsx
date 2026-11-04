import { OcrEngineControls } from "../../ocr/OcrEngineControls";
import { Section, Field, Select, Switch,Button } from "../../components/ui";
import {invoke} from '@tauri-apps/api/core';
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
  const setOpenInEditor = useAppStore((s) => s.setOpenInEditor);
  const setScreenshotRetention = useAppStore((s) => s.setScreenshotRetention);
  const setHideDesktopIcons=useAppStore(s=>s.setHideDesktopIcons);
  const setQuickAccessAutoClose=useAppStore(s=>s.setQuickAccessAutoClose);
  const pushToast=useAppStore(s=>s.pushToast);
  const setIndexScreenshotText = useAppStore(s => s.setIndexScreenshotText);
  const isJpeg = (settings?.image_format ?? "png") === "jpeg";
  return (
    <Section
      title="Capture"
      description="Screenshot format, quality, and capture behavior."
    >
      <Field label="Image format" hint="File format for saved screenshots.">
        <Select
          value={settings?.image_format ?? "png"}
          options={FORMAT_OPTIONS}
          onChange={(v) => void setImageFormat(v as "png" | "jpeg" | "webp")}
        />
      </Field>
      <Field label="JPEG quality" hint={isJpeg ? "Compression level when saving as JPEG." : "Available when Image format is set to JPEG."}>
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
      <Field label="Capture delay" hint="Countdown length for the delayed-capture hotkeys (set them under Hotkeys).">
        <Select
          value={String(settings?.capture_delay_secs ?? 5)}
          options={DELAY_OPTIONS}
          onChange={(v) => void setCaptureDelay(Number(v) as 3 | 5 | 10)}
        />
      </Field>
      <Field label="Open in editor after capture" hint="Open screenshots in the editor automatically. Turn off to show Quick Access instead.">
        <Switch
          ariaLabel="Open in editor after capture"
          checked={settings?.open_in_editor ?? false}
          onChange={(on) => void setOpenInEditor(on)}
        />
      </Field>
      <Field label="Hide desktop icons" hint="Hide icons while grabbing a screenshot or scrolling strip, then restore their previous visibility.">
        <Switch ariaLabel="Hide desktop icons" checked={settings?.hide_desktop_icons??false} onChange={on=>void setHideDesktopIcons(on)}/>
      </Field>
      <Field label="Dismiss cards after 8 seconds" hint="Remove expired cards from Quick Access. Hovering or dragging pauses that card. Saved screenshots stay in Library.">
        <Switch ariaLabel="Auto-close Quick Access" checked={settings?.quick_access_auto_close??false} onChange={on=>void setQuickAccessAutoClose(on)}/>
      </Field>
      <Field label="Auto-delete saved screenshots" hint="Permanently delete Library screenshots older than this age. Recordings and GIFs are kept. Never keeps all screenshots.">
        <Select ariaLabel="Auto-delete saved screenshots"
          value={String(settings?.screenshot_retention_days ?? 0)}
          options={[{ value: "0", label: "Never" }, { value: "1", label: "After 1 day" }, { value: "7", label: "After 7 days" }, { value: "30", label: "After 30 days" }]}
          onChange={value => { if (value === "0" || value === "1" || value === "7" || value === "30") void setScreenshotRetention(value === "0" ? 0 : value === "1" ? 1 : value === "7" ? 7 : 30); }} />
      </Field>
      <Field label="Recording notifications" hint="Turn on Do not disturb in Windows before recording. Windows does not provide an unrestricted automatic switch for Glint.">
        <Button size="md" variant="subtle" onClick={()=>void invoke('settings_open_notifications').catch(e=>pushToast(String(e)))}>Notification settings</Button>
      </Field>
      <OcrEngineControls />
      <Field label="Search screenshot text" hint="Search readable text in saved screenshots, on this device. Turning this off clears the text index.">
        <Switch ariaLabel="Search screenshot text" checked={settings?.index_screenshot_text ?? true} onChange={v => void setIndexScreenshotText(v)} />
      </Field>
    </Section>
  );
}
