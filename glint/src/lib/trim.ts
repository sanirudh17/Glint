/** trim.ts — typed wrappers for the recording-trim Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface ProbeResult {
  duration_secs: number;
  has_audio: boolean;
  fps: number;
  width: number;
  height: number;
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
