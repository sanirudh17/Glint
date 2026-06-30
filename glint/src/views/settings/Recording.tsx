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

export function Recording() {
  const settings = useAppStore((s) => s.settings);
  const setRecordSystemAudio = useAppStore((s) => s.setRecordSystemAudio);
  const setRecordMicrophone = useAppStore((s) => s.setRecordMicrophone);
  const setRecordWebcam = useAppStore((s) => s.setRecordWebcam);

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
    </Section>
  );
}
