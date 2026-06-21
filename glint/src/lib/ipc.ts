/**
 * Glint IPC helpers — thin wrappers around Tauri invoke() and plugin-sql.
 * All network-free; calls go only to the local Rust backend or the local SQLite DB.
 *
 * Settings persistence uses the JS-side plugin-sql (not Rust invoke): the frontend
 * writes directly to the `settings` table via persistSetting/readSetting, and hydrates
 * from it on load. The Rust SettingsState holds the validated in-memory copy for the
 * current session but is NOT hydrated from disk on startup.
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

/** Fetch all persisted settings from the Rust backend (returns defaults). */
export async function getSettings(): Promise<Settings> {
  return invoke<Settings>("settings_get_all");
}

/**
 * Update the Rust in-memory settings copy (validation + live apply for the session).
 * Returns the full updated Settings object.
 * Call this alongside persistSetting() — they serve different purposes.
 */
export async function saveSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<Settings> {
  return invoke<Settings>("settings_set", { key, value });
}

// ─── SQLite-backed settings persistence ──────────────────────────────────────
//
// These two functions are the source-of-truth for settings that survive restart.
// The Rust SettingsState starts at Default() each launch; the frontend reads
// from SQLite at startup (loadSettings) and writes here on every change.
//
// Both reuse the db() singleton already shared with loadCaptures().

/**
 * Upsert a setting row in the `settings` table.
 * The value is JSON-encoded so any scalar or object can be stored uniformly.
 */
export async function persistSetting(key: string, value: unknown): Promise<void> {
  await (await db()).execute(
    "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",
    [key, JSON.stringify(value)],
  );
}

/**
 * Read one setting row from the `settings` table.
 * Returns null if the row does not exist yet (first run, or key never set).
 */
export async function readSetting<T>(key: string): Promise<T | null> {
  const rows = await (await db()).select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key=$1",
    [key],
  );
  return rows.length ? (JSON.parse(rows[0].value) as T) : null;
}
