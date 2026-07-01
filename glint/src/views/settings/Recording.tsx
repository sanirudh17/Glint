import { Info } from "lucide-react";
import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

const FPS_OPTIONS = [
  { value: "60", label: "60 fps" },
  { value: "30", label: "30 fps" },
  { value: "24", label: "24 fps" },
];

const CODEC_OPTIONS = [
  { value: "h264", label: "H.264" },
  { value: "h265", label: "H.265 / HEVC" },
  { value: "av1",  label: "AV1" },
];

const CURSOR_SIZE_OPTIONS = [
  { value: "off", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xl", label: "Extra large" },
];

export function Recording() {
  const settings = useAppStore((s) => s.settings);
  const setRecordSystemAudio = useAppStore((s) => s.setRecordSystemAudio);
  const setRecordMicrophone = useAppStore((s) => s.setRecordMicrophone);
  const setRecordWebcam = useAppStore((s) => s.setRecordWebcam);
  const setRecordFx = useAppStore((s) => s.setRecordFx);

  return (
    <Section
      title="Recording"
      description="Video recording quality and codec settings."
    >
      <Field label="Frame rate" hint="Frames per second for screen recordings.">
        <div className="settings-inert-control">
          <Select value="60" options={FPS_OPTIONS} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Video codec" hint="Encoding format for recorded video.">
        <div className="settings-inert-control">
          <Select value="h264" options={CODEC_OPTIONS} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Record system audio" hint="Include speaker/app audio in recordings by default.">
        <Switch
          checked={settings?.record_system_audio ?? true}
          onChange={(v) => setRecordSystemAudio(v)}
        />
      </Field>
      <Field label="Record microphone" hint="Include your microphone in recordings by default.">
        <Switch
          checked={settings?.record_microphone ?? false}
          onChange={(v) => setRecordMicrophone(v)}
        />
      </Field>
      <Field label="Record webcam" hint="Include your webcam in recordings by default.">
        <Switch
          checked={settings?.record_webcam ?? false}
          onChange={(v) => setRecordWebcam(v)}
        />
      </Field>
      <Field label="Visualize clicks" hint="Show a ripple at each mouse click during recording.">
        <Switch
          checked={settings?.record_click_viz ?? false}
          onChange={(v) => setRecordFx("record_click_viz", v)}
        />
      </Field>
      <Field label="Show keystrokes" hint="Overlay pressed keys at the bottom of the recording.">
        <Switch
          checked={settings?.record_keystrokes ?? false}
          onChange={(v) => setRecordFx("record_keystrokes", v)}
        />
      </Field>
      <Field label="Cursor spotlight" hint="Draw a soft halo that follows the cursor.">
        <Switch
          checked={settings?.record_cursor_spotlight ?? false}
          onChange={(v) => setRecordFx("record_cursor_spotlight", v)}
        />
      </Field>
      <Field label="Hide real cursor" hint="Replace the OS cursor with our own pointer (set at recording start).">
        <Switch
          checked={settings?.record_cursor_hide ?? false}
          onChange={(v) => setRecordFx("record_cursor_hide", v)}
        />
      </Field>
      <Field label="Cursor size" hint="Enlarge the recorded cursor for visibility (set at recording start).">
        <Select
          value={settings?.record_cursor_size ?? "off"}
          options={CURSOR_SIZE_OPTIONS}
          onChange={(v) => setRecordFx("record_cursor_size", v as "off" | "large" | "xl")}
        />
      </Field>
    </Section>
  );
}
