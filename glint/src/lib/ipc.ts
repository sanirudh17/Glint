/**
 * Glint IPC helpers — thin wrappers around Tauri invoke().
 * All network-free; calls go only to the local Rust backend.
 *
 * Task 11 will expand saveSetting() to persist to SQLite via Rust.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../store/useAppStore";

/** Fetch all persisted settings from the Rust backend. */
export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("settings_get_all");
}

/**
 * Persist a single setting key/value pair.
 * Returns the full updated Settings object.
 */
export async function saveSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<Settings> {
  return invoke<Settings>("settings_set", { key, value });
}
