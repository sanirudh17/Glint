import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Section, SettingsGroup, Field, Select, Switch, Button } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

const FPS_OPTIONS = [
  { value: "60", label: "60 fps" },
  { value: "30", label: "30 fps" },
];

const RESOLUTION_OPTIONS = [
  { value: "original", label: "Original" },
  { value: "1080p",    label: "1080p" },
  { value: "720p",     label: "720p" },
];

const VIDEO_QUALITY_OPTIONS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

// One control for the recorded cursor. Hide + size are folded into a single choice
// because they're mutually exclusive capture-time states (the pointer either shows
// at some size, or it's hidden). Maps to the two backend flags on change.
const CURSOR_STYLE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xl", label: "Extra large" },
  { value: "hidden", label: "Hidden" },
];

export function Recording() {
  const settings = useAppStore((s) => s.settings);
  const setRecordSystemAudio = useAppStore((s) => s.setRecordSystemAudio);
  const setRecordMicrophone = useAppStore((s) => s.setRecordMicrophone);
  const setRecordWebcam = useAppStore((s) => s.setRecordWebcam);
  const setRecordWebcamMovable = useAppStore((s) => s.setRecordWebcamMovable);
  const setRecordFx = useAppStore((s) => s.setRecordFx);
  const setRecordFps = useAppStore((s) => s.setRecordFps);
  const setRecordResolution = useAppStore((s) => s.setRecordResolution);
  const setRecordQuality = useAppStore((s) => s.setRecordQuality);
  const setWebcamDevice = useAppStore((s) => s.setWebcamDevice);
  const pushToast = useAppStore((s) => s.pushToast);

  // Enumerate cameras. Browsers only reveal device labels after camera permission
  // has been granted once; until then they read "Camera 1", "Camera 2"….
  const [cams, setCams] = useState<{ deviceId: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (!alive) return;
        const vids = list.filter((d) => d.kind === "videoinput");
        setCams(vids.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const cameraOptions = [
    { value: "", label: "System default" },
    ...cams.filter((c) => c.deviceId).map((c) => ({ value: c.deviceId, label: c.label })),
  ];

  const cursorStyle = settings?.record_cursor_hide
    ? "hidden"
    : settings?.record_cursor_size === "xl"
      ? "xl"
      : settings?.record_cursor_size === "large"
        ? "large"
        : "normal";
  const setCursorStyle = async (v: string) => {
    if (v === "hidden") {
      await setRecordFx("record_cursor_hide", true);
      await setRecordFx("record_cursor_size", "off");
    } else {
      await setRecordFx("record_cursor_hide", false);
      await setRecordFx("record_cursor_size", v === "large" ? "large" : v === "xl" ? "xl" : "off");
    }
  };

  return (
    <Section title="Recording">
      <SettingsGroup title="Video">
        <Field label="Frame rate">
          <Select
            value={String(settings?.record_fps ?? 60)}
            options={FPS_OPTIONS}
            onChange={(v) => void setRecordFps(Number(v) as 30 | 60)}
          />
        </Field>
        <Field label="Resolution">
          <Select
            value={settings?.record_resolution ?? "original"}
            options={RESOLUTION_OPTIONS}
            onChange={(v) => void setRecordResolution(v as "original" | "1080p" | "720p")}
          />
        </Field>
        <Field label="Quality">
          <Select
            value={settings?.record_quality ?? "high"}
            options={VIDEO_QUALITY_OPTIONS}
            onChange={(v) => void setRecordQuality(v as "high" | "medium" | "low")}
          />
        </Field>
        <Field label="Do Not Disturb">
          <Button size="sm" variant="subtle" onClick={()=>void invoke('settings_open_notifications').catch(e=>pushToast(String(e)))}>Windows settings</Button>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Audio">
        <Field label="System audio">
          <Switch
            checked={settings?.record_system_audio ?? true}
            onChange={(v) => setRecordSystemAudio(v)}
          />
        </Field>
        <Field label="Microphone">
          <Switch
            checked={settings?.record_microphone ?? false}
            onChange={(v) => setRecordMicrophone(v)}
          />
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Webcam">
        <Field label="Record webcam">
          <Switch
            checked={settings?.record_webcam ?? false}
            onChange={(v) => setRecordWebcam(v)}
          />
        </Field>
        <Field label="Camera">
          <Select
            value={settings?.webcam_device_id ?? ""}
            options={cameraOptions}
            onChange={(v) => void setWebcamDevice(v)}
          />
        </Field>
        <Field label="Editable in Studio">
          <Switch
            checked={settings?.record_webcam_movable ?? false}
            onChange={(v) => setRecordWebcamMovable(v)}
          />
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Cursor & effects">
        <Field label="Cursor">
          <Select
            value={cursorStyle}
            options={CURSOR_STYLE_OPTIONS}
            onChange={setCursorStyle}
          />
        </Field>
        <Field label="Show clicks">
          <Switch
            checked={settings?.record_click_viz ?? false}
            onChange={(v) => setRecordFx("record_click_viz", v)}
          />
        </Field>
        <Field label="Show keystrokes">
          <Switch
            checked={settings?.record_keystrokes ?? false}
            onChange={(v) => setRecordFx("record_keystrokes", v)}
          />
        </Field>
        <Field label="Cursor spotlight">
          <Switch
            checked={settings?.record_cursor_spotlight ?? false}
            onChange={(v) => setRecordFx("record_cursor_spotlight", v)}
          />
        </Field>
      </SettingsGroup>
    </Section>
  );
}
