/** recorder.ts — typed wrappers for the screen recorder's Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface RecorderStatus { recording: boolean; elapsed_secs: number }

export const recorderStartFullscreen = (audio?: { system: boolean; mic: boolean }): Promise<void> =>
  invoke<void>("recorder_start", { mode: "fullscreen", system: audio?.system ?? true, mic: audio?.mic ?? false });
export const recorderStartRegion = (
  r: { x: number; y: number; w: number; h: number },
  audio?: { system: boolean; mic: boolean },
): Promise<void> =>
  invoke<void>("recorder_start", { mode: "region", x: r.x, y: r.y, w: r.w, h: r.h, system: audio?.system ?? true, mic: audio?.mic ?? false });
export const recorderPause = (): Promise<void> => invoke<void>("recorder_pause");
export const recorderResume = (): Promise<void> => invoke<void>("recorder_resume");
export const recorderStop = (): Promise<void> => invoke<void>("recorder_stop");
export const recorderCancel = (): Promise<void> => invoke<void>("recorder_cancel");
export const recorderStatus = (): Promise<RecorderStatus | null> =>
  invoke<RecorderStatus | null>("recorder_status");
