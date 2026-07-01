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

export const recorderStartFullscreen = (audio?: { system: boolean; mic: boolean; webcam: boolean }): Promise<void> =>
  invoke<void>("recorder_start", { mode: "fullscreen", system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false });
export const recorderStartRegion = (
  r: { x: number; y: number; w: number; h: number },
  audio?: { system: boolean; mic: boolean; webcam: boolean },
): Promise<void> =>
  invoke<void>("recorder_start", { mode: "region", x: r.x, y: r.y, w: r.w, h: r.h, system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false });
export const recorderPause = (): Promise<void> => invoke<void>("recorder_pause");
export const recorderResume = (): Promise<void> => invoke<void>("recorder_resume");
export const recorderStop = (): Promise<void> => invoke<void>("recorder_stop");
export const recorderCancel = (): Promise<void> => invoke<void>("recorder_cancel");
export const recorderStatus = (): Promise<RecorderStatus | null> =>
  invoke<RecorderStatus | null>("recorder_status");
export const recorderSetMute = (source: "system" | "mic", muted: boolean): Promise<void> =>
  invoke<void>("recorder_set_mute", { source, muted });
export const recorderSetWebcam = (on: boolean): Promise<void> => invoke<void>("recorder_set_webcam", { on });
