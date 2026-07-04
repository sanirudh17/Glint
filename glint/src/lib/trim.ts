/** trim.ts — typed wrappers for the recording-trim Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface ProbeResult {
  duration_secs: number;
  has_audio: boolean;
  fps: number;
  width: number;
  height: number;
  has_cam: boolean;
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
    mode,
  });

export const trimWaveform = (path: string, buckets: number, duration: number): Promise<number[]> =>
  invoke<number[]>("recorder_trim_waveform", { path, buckets, duration });
