/**
 * Glint IPC helpers — thin wrappers around Tauri invoke().
 * All network-free; calls go only to the local Rust backend.
 *
 * Task 11 will expand saveSetting() to persist to SQLite via Rust.
 */
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { Settings } from "../store/useAppStore";

// ─── SQLite singleton ────────────────────────────────────────────────────────
//
// Lazy singleton — the Database.load() call is expensive and must happen only
// once per process. Both loadCaptures() (Task 10) and saveSetting/loadSetting
// (Task 11) share this loader; they each await db() rather than opening their
// own connection.
//
let dbP: Promise<Database> | null = null;
const db = () => (dbP ??= Database.load("sqlite:glint.db"));

// ─── Capture types ───────────────────────────────────────────────────────────

export interface CaptureRow {
  id: number;
  kind: string;           // 'screenshot' | 'recording'
  path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  bytes: number | null;
  app_name: string | null;
  window_title: string | null;
  created_at: number;     // unix seconds
}

/**
 * Load all non-deleted captures, newest first.
 * Returns [] when the DB is empty (expected in P1).
 */
export async function loadCaptures(): Promise<CaptureRow[]> {
  return (await db()).select<CaptureRow[]>(
    "SELECT * FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC",
  );
}

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
