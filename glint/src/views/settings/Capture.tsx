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
  const setHideDesktopIcons=useAppStore(s=>s.setHideDesktopIcons);
  const setQuickAccessAutoClose=useAppStore(s=>s.setQuickAccessAutoClose);
  const pushToast=useAppStore(s=>s.pushToast);
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
      <Field label="Capture delay" hint="Countdown length for the delayed-capture hotkeys (set them under Hotkeys).">
        <Select
          value={String(settings?.capture_delay_secs ?? 5)}
          options={DELAY_OPTIONS}
          onChange={(v) => void setCaptureDelay(Number(v) as 3 | 5 | 10)}
        />
      </Field>
      <Field label="Hide desktop icons" hint="Hide icons while grabbing a screenshot or scrolling strip, then restore their previous visibility.">
        <Switch ariaLabel="Hide desktop icons" checked={settings?.hide_desktop_icons??false} onChange={on=>void setHideDesktopIcons(on)}/>
      </Field>
      <Field label="Auto-close Quick Access" hint="Hide the capture tray after 8 idle seconds. Hovering or dragging pauses the timer; captures are kept.">
        <Switch ariaLabel="Auto-close Quick Access" checked={settings?.quick_access_auto_close??false} onChange={on=>void setQuickAccessAutoClose(on)}/>
      </Field>
      <Field label="Recording notifications" hint="Turn on Do not disturb in Windows before recording. Windows does not provide an unrestricted automatic switch for Glint.">
        <Button size="sm" variant="ghost" onClick={()=>void invoke('settings_open_notifications').catch(e=>pushToast(String(e)))}>Notification settings</Button>
      </Field>
    </Section>
  );
}
