/** recorder.ts — typed wrappers for the screen recorder's Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface RecorderStatus {
  recording: boolean;
  elapsed_secs: number;
  system: boolean;
  mic: boolean;
  system_muted: boolean;
  mic_muted: boolean;
  webcam: boolean;
  click_viz: boolean;
  keystrokes: boolean;
  spotlight: boolean;
  cursor_hide: boolean;
  cursor_size: "off" | "large" | "xl";
}

export interface FxOpts {
  click_viz?: boolean;
  keystrokes?: boolean;
  spotlight?: boolean;
  cursor_hide?: boolean;
  cursor_size?: "off" | "large" | "xl";
}

// Tauri maps camelCase JS arg keys → snake_case Rust params (clickViz → click_viz).
// These MUST be camelCase or the multi-word args silently arrive as None (false) —
// which is exactly why click/hide/size effects didn't apply at recording start.
const fxPayload = (fx?: FxOpts) => ({
  clickViz: fx?.click_viz ?? false,
  keystrokes: fx?.keystrokes ?? false,
  spotlight: fx?.spotlight ?? false,
  cursorHide: fx?.cursor_hide ?? false,
  cursorSize: fx?.cursor_size ?? "off",
});

// `webcamMovable` maps to Rust `webcam_movable` (record the camera as its own track).
type StartSources = { system: boolean; mic: boolean; webcam: boolean; webcamMovable?: boolean };

export const recorderStartFullscreen = (
  audio?: StartSources,
  fx?: FxOpts,
): Promise<void> =>
  invoke<void>("recorder_start", {
    mode: "fullscreen",
    system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false,
    webcamMovable: audio?.webcamMovable ?? false,
    ...fxPayload(fx),
  });
export const recorderStartRegion = (
  r: { x: number; y: number; w: number; h: number },
  audio?: StartSources,
  fx?: FxOpts,
): Promise<void> =>
  invoke<void>("recorder_start", {
    mode: "region", x: r.x, y: r.y, w: r.w, h: r.h,
    system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false,
    webcamMovable: audio?.webcamMovable ?? false,
    ...fxPayload(fx),
  });
export const recorderPause = (): Promise<void> => invoke<void>("recorder_pause");
export const recorderResume = (): Promise<void> => invoke<void>("recorder_resume");
export const recorderStop = (): Promise<void> => invoke<void>("recorder_stop");
export const recorderCancel = (): Promise<void> => invoke<void>("recorder_cancel");
export const recorderStatus = (): Promise<RecorderStatus | null> =>
  invoke<RecorderStatus | null>("recorder_status");
export const recorderSetMute = (source: "system" | "mic", muted: boolean): Promise<void> =>
  invoke<void>("recorder_set_mute", { source, muted });
export const recorderSetWebcam = (on: boolean): Promise<void> => invoke<void>("recorder_set_webcam", { on });
export const recorderSetFx = (effect: "click_viz" | "keystrokes" | "spotlight", on: boolean): Promise<void> =>
  invoke<void>("recorder_set_fx", { effect, on });
