/** trim.ts — typed wrappers for the recording-trim Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface ProbeResult {
  duration_secs: number;
  has_audio: boolean;
  fps: number;
  width: number;
  height: number;
  has_cam: boolean;
  /** Webcam overlay's initial placement (normalized), from the record-time .cam.json.
   *  All zero when absent → the editor uses its default. */
  cam_x: number;
  cam_y: number;
  cam_d: number;
  /** Webcam bubble shape at record time ("circle" | "rounded" | "square" | "rect"). */
  cam_shape: string;
}
export interface TrimTarget {
  id: number;
  path: string;
}

export const trimTarget = (): Promise<TrimTarget | null> =>
  invoke<TrimTarget | null>("recorder_trim_target");
export const trimProbe = (path: string): Promise<ProbeResult> =>
  invoke<ProbeResult>("recorder_trim_probe", { path });
export const openTrim = (id: number, path: string): Promise<void> =>
  invoke<void>("recorder_open_trim", { id, path });

export interface KeepSegment {
  start: number;
  end: number;
  speed: number;
}

/** Webcam overlay placement in source pixels (top-left + box w/h + shape), or null for none. */
export interface CamOverlay {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: string;
}

export const trimExport = (
  id: number,
  srcPath: string,
  segments: KeepSegment[],
  hasAudio: boolean,
  duration: number,
  width: number,
  height: number,
  fadeIn: number,
  fadeOut: number,
  camPath: string | null,
  camOverlay: CamOverlay | null,
  mode: "copy" | "overwrite",
): Promise<void> =>
  invoke<void>("recorder_trim_export", {
    id,
    srcPath,
    segments,
    hasAudio,
    duration,
    width,
    height,
    fadeIn,
    fadeOut,
    camPath,
    camOverlay,
    mode,
  });

export const trimWaveform = (path: string, buckets: number, duration: number): Promise<number[]> =>
  invoke<number[]>("recorder_trim_waveform", { path, buckets, duration });
