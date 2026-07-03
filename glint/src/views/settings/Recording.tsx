import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

const FPS_OPTIONS = [
  { value: "60", label: "60 fps" },
  { value: "30", label: "30 fps" },
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
  const setRecordFx = useAppStore((s) => s.setRecordFx);
  const setRecordFps = useAppStore((s) => s.setRecordFps);

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
    <Section
      title="Recording"
      description="Video recording quality and codec settings."
    >
      <Field label="Frame rate" hint="Frames per second for screen recordings.">
        <Select
          value={String(settings?.record_fps ?? 60)}
          options={FPS_OPTIONS}
          onChange={(v) => void setRecordFps(Number(v) as 30 | 60)}
        />
      </Field>
      <Field label="Video codec" hint="Encoding format for recorded video.">
        <span className="settings-static-value">H.264 · MP4 (maximum compatibility)</span>
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
      <Field label="Recorded cursor" hint="Enlarge or hide the mouse cursor in recordings. Chosen before recording starts (it changes how the screen is captured), so it isn't a live toggle.">
        <Select
          value={cursorStyle}
          options={CURSOR_STYLE_OPTIONS}
          onChange={setCursorStyle}
        />
      </Field>
    </Section>
  );
}
