import { Info } from "lucide-react";
import { Section, Field, Select } from "../../components/ui";

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
      <Field label="Record audio" hint="Include system audio in recordings.">
        <span className="settings-phase-note" style={{ marginTop: 0 }}>
          <Info size={12} strokeWidth={1.75} />
          Available in a later phase
        </span>
      </Field>
    </Section>
  );
}
