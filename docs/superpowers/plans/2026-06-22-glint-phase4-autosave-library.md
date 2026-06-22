# Glint Phase 4 — Auto-save + Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every screenshot durable and discoverable — auto-saved to `Pictures\Glint`, recorded in the `captures` table by tray-core, and browsable in a real Library with Open/Reveal/Copy/Delete/Drag; the Auto-save settings panel goes live.

**Architecture:** Rust owns the `captures` table via `rusqlite` (the same `glint.db` plugin-sql uses for `settings`, different table). `finish_commit` branches on a hydrated `auto_save` setting: write the PNG to the save folder, generate a thumbnail, insert a row, emit `capture-saved`. The Library (JS) reads rows + thumbnail data-URLs via a Rust command and acts through small Rust commands; drag-out reuses `tauri-plugin-drag`.

**Tech Stack:** Tauri v2, Rust, `rusqlite` (bundled), `image` 0.25, `arboard`, `tauri-plugin-drag`, React + TypeScript, Zustand, plugin-sql (settings only).

## Global Constraints

- **Local-first:** no cloud, no network calls, no accounts, no auth. Verbatim constraint.
- **Recorder isolation:** the capture/library path has ZERO ffmpeg/scap/recorder dependency.
- **Base branch is `master`.** Phase work lives on `phase-N-*` branches. Phase 3 is not yet merged; **branch `phase-4-library` off the current `phase-3-hud` HEAD** and build there.
- **Tauri command args are camelCase** (e.g. `invoke("capture_delete", { id })`). serde structs without `rename_all` keep snake_case field names.
- **App-defined commands need NO ACL permission** (only plugin/core commands are capability-gated).
- **DB path:** `app_config_dir()/glint.db` (= `%APPDATA%\com.glint.app\glint.db`), the same file plugin-sql opens as `sqlite:glint.db`.
- **Rust creates no tables at startup.** Settings hydration tolerates a missing `settings` table (first launch → defaults). The `captures` table is ensured lazily with `CREATE TABLE IF NOT EXISTS` at capture/library time only (always after the main window's boot migration), so it never races plugin-sql's `CREATE TABLE`.
- **Save filename:** `Glint <yyyy-MM-dd> at <HH.mm.ss>.png` via existing `paths::capture_filename`; collisions via existing `paths::dedupe`.
- **Run all Rust commands from `glint/src-tauri`; all npm/tsc/vite from `glint`.**

---

### Task 0: Branch

- [ ] **Step 1: Create the Phase 4 branch off the current HEAD**

Run:
```bash
cd "/c/Users/sanir/Claude Code" && git checkout -b phase-4-library
```
Expected: `Switched to a new branch 'phase-4-library'`

---

### Task 1: Thumbnail helper (`thumb.rs`) — TDD

**Files:**
- Create: `glint/src-tauri/src/capture/thumb.rs`
- Modify: `glint/src-tauri/src/capture/mod.rs` (add `pub mod thumb;`)

**Interfaces:**
- Produces:
  - `pub fn thumb_dimensions(w: u32, h: u32, max: u32) -> (u32, u32)` — aspect-preserving, never upscales, min 1px.
  - `pub fn make_thumb(rgba: &[u8], w: u32, h: u32, max: u32) -> Result<Vec<u8>, String>` — returns PNG bytes of the downscaled image.

- [ ] **Step 1: Write the failing tests**

Create `glint/src-tauri/src/capture/thumb.rs`:
```rust
//! Thumbnail generation for Library cards. Pure resize math + an `image`-backed
//! encoder. No recorder dependency.

use image::{ImageBuffer, Rgba};

/// Aspect-preserving target size so the long edge is at most `max`. Never upscales
/// (a smaller image is returned unchanged). Clamps to a 1px floor.
pub fn thumb_dimensions(w: u32, h: u32, max: u32) -> (u32, u32) {
    let long = w.max(h);
    if long <= max || long == 0 {
        return (w.max(1), h.max(1));
    }
    let scale = max as f64 / long as f64;
    let nw = (w as f64 * scale).round() as u32;
    let nh = (h as f64 * scale).round() as u32;
    (nw.max(1), nh.max(1))
}

/// Downscale RGBA pixels to a thumbnail and encode as PNG bytes.
pub fn make_thumb(rgba: &[u8], w: u32, h: u32, max: u32) -> Result<Vec<u8>, String> {
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(w, h, rgba.to_vec()).ok_or("thumb: bad rgba buffer")?;
    let (tw, th) = thumb_dimensions(w, h, max);
    let resized = image::imageops::resize(&img, tw, th, image::imageops::FilterType::Triangle);
    let mut out = std::io::Cursor::new(Vec::new());
    resized
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_image_scales_long_edge_to_max() {
        assert_eq!(thumb_dimensions(1000, 500, 480), (480, 240));
    }

    #[test]
    fn tall_image_scales_long_edge_to_max() {
        assert_eq!(thumb_dimensions(500, 1000, 480), (240, 480));
    }

    #[test]
    fn small_image_is_unchanged() {
        assert_eq!(thumb_dimensions(120, 80, 480), (120, 80));
    }

    #[test]
    fn never_returns_zero() {
        assert_eq!(thumb_dimensions(10000, 1, 480), (480, 1));
    }

    #[test]
    fn make_thumb_encodes_a_png_at_scaled_size() {
        // 4x2 opaque-red image → downscale to max 2 → 2x1.
        let rgba: Vec<u8> = std::iter::repeat([255u8, 0, 0, 255]).take(4 * 2).flatten().collect();
        let png = make_thumb(&rgba, 4, 2, 2).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (2, 1));
    }
}
```

- [ ] **Step 2: Register the module**

In `glint/src-tauri/src/capture/mod.rs`, add to the module declarations at the top (next to `pub mod frozen;`):
```rust
pub mod thumb;
```

- [ ] **Step 3: Run the tests — expect PASS**

Run: `cd glint/src-tauri && cargo test thumb`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/capture/thumb.rs glint/src-tauri/src/capture/mod.rs
git commit -m "feat(p4): thumbnail resize helper (TDD)"
```

---

### Task 2: rusqlite captures layer (`db`) — TDD

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `rusqlite`)
- Modify: `glint/src-tauri/src/db/mod.rs` (add query layer + tests)

**Interfaces:**
- Produces:
  - `pub struct NewCapture { pub kind: String, pub path: String, pub thumb_path: Option<String>, pub width: Option<i64>, pub height: Option<i64>, pub bytes: Option<i64>, pub created_at: i64 }`
  - `pub struct CaptureRow { pub id: i64, pub kind: String, pub path: String, pub thumb_path: Option<String>, pub width: Option<i64>, pub height: Option<i64>, pub bytes: Option<i64>, pub created_at: i64 }`
  - `pub fn ensure_captures_table(conn: &rusqlite::Connection) -> rusqlite::Result<()>`
  - `pub fn insert_capture(conn: &rusqlite::Connection, c: &NewCapture) -> rusqlite::Result<i64>`
  - `pub fn list_captures(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<CaptureRow>>`
  - `pub fn soft_delete(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<()>`
  - `pub fn capture_path(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Option<String>>`

- [ ] **Step 1: Add the dependency**

In `glint/src-tauri/Cargo.toml`, under `[dependencies]`, add:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

- [ ] **Step 2: Write the query layer + failing tests**

Replace `glint/src-tauri/src/db/mod.rs` with (keep the existing `migrations()` exactly, append the new layer):
```rust
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create captures and settings",
        sql: "
            CREATE TABLE captures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,            -- 'screenshot' | 'recording'
                path TEXT NOT NULL,
                thumb_path TEXT,
                width INTEGER, height INTEGER,
                duration_ms INTEGER,           -- recordings only
                bytes INTEGER,
                app_name TEXT, window_title TEXT,
                created_at INTEGER NOT NULL,   -- unix seconds
                deleted_at INTEGER             -- soft delete
            );
            CREATE INDEX idx_captures_created ON captures(created_at);
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL            -- JSON-encoded
            );
        ",
        kind: MigrationKind::Up,
    }]
}

// ─── rusqlite captures layer (tray-core owns the captures table) ───────────────

use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct NewCapture {
    pub kind: String,
    pub path: String,
    pub thumb_path: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CaptureRow {
    pub id: i64,
    pub kind: String,
    pub path: String,
    pub thumb_path: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
}

/// Idempotent — matches the plugin-sql migration shape. Safe to call repeatedly and
/// at capture/library time (always after the main window's boot migration).
pub fn ensure_captures_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            path TEXT NOT NULL,
            thumb_path TEXT,
            width INTEGER, height INTEGER,
            duration_ms INTEGER,
            bytes INTEGER,
            app_name TEXT, window_title TEXT,
            created_at INTEGER NOT NULL,
            deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);",
    )
}

pub fn insert_capture(conn: &Connection, c: &NewCapture) -> rusqlite::Result<i64> {
    ensure_captures_table(conn)?;
    conn.execute(
        "INSERT INTO captures (kind, path, thumb_path, width, height, bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![c.kind, c.path, c.thumb_path, c.width, c.height, c.bytes, c.created_at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_captures(conn: &Connection) -> rusqlite::Result<Vec<CaptureRow>> {
    ensure_captures_table(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, path, thumb_path, width, height, bytes, created_at
         FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CaptureRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                path: r.get(2)?,
                thumb_path: r.get(3)?,
                width: r.get(4)?,
                height: r.get(5)?,
                bytes: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn soft_delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    ensure_captures_table(conn)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute("UPDATE captures SET deleted_at = ?1 WHERE id = ?2", rusqlite::params![now, id])?;
    Ok(())
}

pub fn capture_path(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    ensure_captures_table(conn)?;
    let mut stmt = conn.prepare("SELECT path FROM captures WHERE id = ?1 AND deleted_at IS NULL")?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        ensure_captures_table(&c).unwrap();
        c
    }

    fn sample(path: &str, at: i64) -> NewCapture {
        NewCapture {
            kind: "screenshot".into(),
            path: path.into(),
            thumb_path: Some(format!("{path}.thumb.png")),
            width: Some(800),
            height: Some(600),
            bytes: Some(1234),
            created_at: at,
        }
    }

    #[test]
    fn insert_returns_increasing_ids() {
        let c = mem();
        let a = insert_capture(&c, &sample("/a.png", 100)).unwrap();
        let b = insert_capture(&c, &sample("/b.png", 200)).unwrap();
        assert!(b > a);
    }

    #[test]
    fn list_is_newest_first() {
        let c = mem();
        insert_capture(&c, &sample("/old.png", 100)).unwrap();
        insert_capture(&c, &sample("/new.png", 200)).unwrap();
        let rows = list_captures(&c).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].path, "/new.png");
    }

    #[test]
    fn soft_delete_hides_a_row() {
        let c = mem();
        let id = insert_capture(&c, &sample("/x.png", 100)).unwrap();
        soft_delete(&c, id).unwrap();
        assert!(list_captures(&c).unwrap().is_empty());
        assert_eq!(capture_path(&c, id).unwrap(), None);
    }

    #[test]
    fn capture_path_returns_the_path() {
        let c = mem();
        let id = insert_capture(&c, &sample("/y.png", 100)).unwrap();
        assert_eq!(capture_path(&c, id).unwrap(), Some("/y.png".to_string()));
    }
}
```

- [ ] **Step 3: Run the tests — expect PASS**

Run: `cd glint/src-tauri && cargo test --lib db::`
Expected: 4 db tests pass (rusqlite compiles `bundled` SQLite on first build — allow a minute).

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/db/mod.rs
git commit -m "feat(p4): rusqlite captures layer — insert/list/soft-delete (TDD)"
```

---

### Task 3: Auto-save settings — Rust fields + hydration, frontend wiring

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (fields, defaults, apply_update, tests)
- Create: `glint/src-tauri/src/settings/hydrate.rs` (read settings table → SettingsState)
- Modify: `glint/src-tauri/src/lib.rs` (call hydration in setup, with the Db; see Task 4 for Db — order: do Task 4 Step 1–2 first if executing strictly, but hydration only needs a Connection)
- Modify: `glint/src/store/useAppStore.ts` (Settings type + setters)
- Modify: `glint/src/views/settings/AutoSave.tsx` (enable the two real toggles)

**Interfaces:**
- Consumes: `db` connection (Task 4 provides the managed `Db`; hydration takes a `&Connection`).
- Produces:
  - Rust `Settings` gains `pub auto_save: bool` (default `true`), `pub auto_copy: bool` (default `true`).
  - `apply_update` handles keys `"auto_save"`, `"auto_copy"` (bool).
  - `settings::hydrate::hydrate_from_db(conn: &rusqlite::Connection, s: &mut Settings)`.
  - Frontend `Settings` gains `auto_save: boolean; auto_copy: boolean`; store setters `setAutoSave`, `setAutoCopy`.

- [ ] **Step 1: Extend the Rust Settings struct + apply_update + tests**

In `glint/src-tauri/src/settings/mod.rs`, change the `Settings` struct and its `Default`:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: Theme,
    pub accent: String,
    pub hotkeys: Hotkeys,
    pub auto_save: bool,
    pub auto_copy: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            accent: "#5B7CFA".into(),
            hotkeys: Hotkeys::default(),
            auto_save: true,
            auto_copy: true,
        }
    }
}
```
In `apply_update`, add two arms before the `other =>` arm:
```rust
        "auto_save" => {
            s.auto_save = value.as_bool().ok_or("auto_save must be boolean")?;
        }
        "auto_copy" => {
            s.auto_copy = value.as_bool().ok_or("auto_copy must be boolean")?;
        }
```
Add tests inside the existing `#[cfg(test)] mod tests`:
```rust
    #[test]
    fn defaults_enable_autosave_and_autocopy() {
        let s = Settings::default();
        assert!(s.auto_save && s.auto_copy);
    }

    #[test]
    fn apply_update_sets_autosave_bool() {
        let mut s = Settings::default();
        apply_update(&mut s, "auto_save", json!(false)).unwrap();
        assert!(!s.auto_save);
    }

    #[test]
    fn apply_update_rejects_non_bool_autosave() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "auto_save", json!("yes")).is_err());
    }
```

- [ ] **Step 2: Run settings tests — expect PASS**

Run: `cd glint/src-tauri && cargo test --lib settings::`
Expected: all settings tests pass (including the 3 new ones).

- [ ] **Step 3: Write the hydration helper**

Create `glint/src-tauri/src/settings/hydrate.rs`:
```rust
//! Hydrate the in-memory Settings from the persisted `settings` table at startup.
//! Tolerant of a missing table (first launch — nothing persisted yet → defaults).

use super::{apply_update, Settings};
use rusqlite::Connection;

/// Read every persisted setting row and apply known keys onto `s`. Unknown keys and
/// any read error (e.g. the table doesn't exist yet) are ignored — defaults stand.
pub fn hydrate_from_db(conn: &Connection, s: &mut Settings) {
    let mut stmt = match conn.prepare("SELECT key, value FROM settings") {
        Ok(stmt) => stmt,
        Err(_) => return, // table missing on first launch
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    });
    let rows = match rows {
        Ok(rows) => rows,
        Err(_) => return,
    };
    for row in rows.flatten() {
        let (key, raw) = row;
        // Persisted values are JSON-encoded (the JS persistSetting wraps with JSON.stringify).
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            let _ = apply_update(s, &key, value);
        }
    }
}
```
In `glint/src-tauri/src/settings/mod.rs`, register the module next to `pub mod commands;`:
```rust
pub mod hydrate;
```

- [ ] **Step 4: Run build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles (hydration is wired into setup in Task 4).

- [ ] **Step 5: Frontend Settings type + setters**

In `glint/src/store/useAppStore.ts`, extend the `Settings` interface:
```ts
export interface Settings {
  theme: Theme;
  accent: string;
  hotkeys: Record<string, string>;
  auto_save: boolean;
  auto_copy: boolean;
}
```
Add to the `AppState` interface (next to `setAccent`):
```ts
  setAutoSave: (on: boolean) => Promise<void>;
  setAutoCopy: (on: boolean) => Promise<void>;
```
In the store body, after `setAccent`, add:
```ts
  setAutoSave: async (on: boolean) => {
    const updated = await saveSetting("auto_save", on);
    await persistSetting("auto_save", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setAutoCopy: async (on: boolean) => {
    const updated = await saveSetting("auto_copy", on);
    await persistSetting("auto_copy", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```
In `loadSettings`, after the existing SQLite override block (the `try { ... } catch {}`), add auto_save/auto_copy hydration so they survive restart on the JS side too:
```ts
    let auto_save = rustSettings.auto_save;
    let auto_copy = rustSettings.auto_copy;
    try {
      const dbAutoSave = await readSetting<boolean>("auto_save");
      if (dbAutoSave !== null) auto_save = dbAutoSave;
      const dbAutoCopy = await readSetting<boolean>("auto_copy");
      if (dbAutoCopy !== null) auto_copy = dbAutoCopy;
    } catch {
      // plugin-sql unavailable — use Rust defaults.
    }
```
and change the `merged` line to include them:
```ts
    const merged: Settings = { ...rustSettings, theme, accent, auto_save, auto_copy };
```

- [ ] **Step 6: Wire the AutoSave panel (two live toggles, one stub)**

Replace `glint/src/views/settings/AutoSave.tsx` with:
```tsx
import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

export function AutoSave() {
  const settings = useAppStore((s) => s.settings);
  const setAutoSave = useAppStore((s) => s.setAutoSave);
  const setAutoCopy = useAppStore((s) => s.setAutoCopy);

  return (
    <Section
      title="Auto-save"
      description="Automatically save captures to disk after taking them."
    >
      <Field label="Auto-save captures" hint="Save each capture to Pictures\Glint without prompting.">
        <Switch
          checked={settings?.auto_save ?? true}
          onChange={(v) => setAutoSave(v)}
        />
      </Field>
      <Field label="Auto-copy to clipboard" hint="Copy the capture to the clipboard immediately after taking it.">
        <Switch
          checked={settings?.auto_copy ?? true}
          onChange={(v) => setAutoCopy(v)}
        />
      </Field>
      <Field label="Open in editor after capture" hint="Open each capture in the editor view automatically.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in Phase 5
          </span>
        </div>
      </Field>
    </Section>
  );
}
```
> Note: confirm the `Switch` `onChange` signature passes the new boolean. If `Switch` calls `onChange(e)` with an event, adapt to `onChange={(e) => setAutoSave(e.currentTarget.checked)}`. Check `glint/src/components/ui/Switch.tsx` before finalizing.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/settings glint/src/store/useAppStore.ts glint/src/views/settings/AutoSave.tsx
git commit -m "feat(p4): live auto-save/auto-copy settings + Rust hydration"
```

---

### Task 4: Managed Db + commit branches on auto-save

**Files:**
- Modify: `glint/src-tauri/src/lib.rs` (Db state, open connection, hydrate settings, register)
- Modify: `glint/src-tauri/src/capture/mod.rs` (`LastCapture` gains `saved: bool`)
- Modify: `glint/src-tauri/src/capture/commands.rs` (`finish_commit` branches; insert row; emit `capture-saved`)
- Modify: `glint/src-tauri/src/paths.rs` (add `thumbs_dir`)

**Interfaces:**
- Consumes: `db::{NewCapture, insert_capture}`, `thumb::make_thumb`, `settings::hydrate::hydrate_from_db`, `paths::{glint_save_dir, capture_filename, dedupe, latest_png}`.
- Produces:
  - `pub struct Db(pub std::sync::Mutex<rusqlite::Connection>)` managed state (in `lib.rs` or a small `src/db` re-export).
  - `LastCapture { …, pub saved: bool }`.
  - Event `capture-saved` (no payload) emitted after a successful insert.

- [ ] **Step 1: Add `thumbs_dir` to paths.rs**

In `glint/src-tauri/src/paths.rs`, add (and a test):
```rust
/// Thumbnail storage dir: `<app_local_data>/thumbs`.
pub fn thumbs_dir(app_local: &Path) -> PathBuf {
    app_local.join("thumbs")
}
```
Add to the `tests` module:
```rust
    #[test]
    fn thumbs_dir_joins() {
        assert_eq!(thumbs_dir(Path::new("C:/x")), PathBuf::from("C:/x/thumbs"));
    }
```

- [ ] **Step 2: Add the managed Db + hydrate settings in lib.rs**

In `glint/src-tauri/src/lib.rs`, add a Db newtype near the top (after the `use` lines):
```rust
/// tray-core's owned connection to the captures table (same glint.db as plugin-sql).
pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);
```
In `run()`'s `.setup(|app| { ... })`, before `Ok(())`, add:
```rust
            // Open tray-core's rusqlite connection to the same glint.db plugin-sql uses.
            use tauri::Manager;
            let db_path = app.path().app_config_dir()
                .map(|d| d.join("glint.db"))
                .map_err(|e| format!("config dir: {e}"))?;
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let conn = rusqlite::Connection::open(&db_path)
                .map_err(|e| format!("open glint.db: {e}"))?;
            let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
            // Hydrate persisted settings into the live SettingsState.
            {
                let state = app.state::<SettingsState>();
                let mut s = state.0.lock().unwrap();
                crate::settings::hydrate::hydrate_from_db(&conn, &mut s);
            }
            app.manage(Db(std::sync::Mutex::new(conn)));
```
Register no new command here yet (Task 5 adds the capture_* commands).

- [ ] **Step 3: `LastCapture` gains `saved`**

In `glint/src-tauri/src/capture/mod.rs`, add to `LastCapture`:
```rust
    pub saved: bool,
```

- [ ] **Step 4: Branch `finish_commit` on auto-save**

In `glint/src-tauri/src/capture/commands.rs`, replace the body of `finish_commit` from the temp-PNG write through the `LastCapture` stash with the auto-save-aware version. Full replacement of `finish_commit`:
```rust
fn finish_commit(
    app: &AppHandle,
    session: crate::capture::CaptureSession,
    rect: RectArg,
) -> Result<(), String> {
    let phys = logical_to_physical(
        LogicalRect { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        session.scale,
    );
    let clamped = clamp_rect(phys, session.image.width, session.image.height)
        .ok_or("empty selection")?;
    let cropped = crop_rgba(&session.image.rgba, session.image.width, session.image.height, clamped);

    let out_img = crate::capture::frozen::CapturedImage {
        width: clamped.w,
        height: clamped.h,
        rgba: cropped.clone(),
    };
    let png = crate::capture::frozen::encode_png(&out_img).map_err(|e| e.to_string())?;

    // Read the live settings (hydrated at startup).
    let (auto_save, auto_copy) = {
        let s = app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap();
        (s.auto_save, s.auto_copy)
    };

    // Decide where the durable file lives.
    let (path, saved) = if auto_save {
        let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
        let dir = crate::paths::glint_save_dir(&pictures);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let filename = crate::paths::capture_filename(chrono::Local::now());
        let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
        std::fs::write(&dest, &png).map_err(|e| e.to_string())?;
        (dest, true)
    } else {
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        let dest = dir.join(format!("glint-{ts}.png"));
        std::fs::write(&dest, &png).map_err(|e| e.to_string())?;
        (dest, false)
    };
    let path_str = path.to_string_lossy().to_string();

    // Clipboard (gated by auto_copy) — non-fatal.
    let clip = if auto_copy {
        clipboard::copy_image(&cropped, clamped.w, clamped.h)
    } else {
        Ok(())
    };
    if let Err(ref e) = clip {
        log::warn!("clipboard copy failed: {e}");
    }

    // latest.png mirror — always. Non-fatal.
    if let Ok(home) = app.path().home_dir() {
        let latest = crate::paths::latest_png(&home);
        if let Some(parent) = latest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&latest, &png) {
            log::warn!("latest.png mirror failed: {e}");
        }
    }

    // Record in the Library when auto-saved: thumbnail + DB row + capture-saved event.
    if saved {
        let thumb_path = write_thumb(app, &cropped, clamped.w, clamped.h, &path_str);
        let row = crate::db::NewCapture {
            kind: "screenshot".into(),
            path: path_str.clone(),
            thumb_path,
            width: Some(clamped.w as i64),
            height: Some(clamped.h as i64),
            bytes: Some(png.len() as i64),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
        };
        let conn = app.state::<crate::Db>();
        match crate::db::insert_capture(&conn.0.lock().unwrap(), &row) {
            Ok(_) => { let _ = app.emit("capture-saved", ()); }
            Err(e) => log::error!("insert_capture failed: {e}"),
        }
    }

    // Stash for the HUD.
    *app.state::<crate::capture::LastCaptureState>().0.lock().unwrap() =
        Some(crate::capture::LastCapture {
            path: path_str.clone(),
            width: clamped.w,
            height: clamped.h,
            rgba: cropped,
            saved,
        });

    if let Err(e) = crate::hud::open(app) {
        log::error!("hud open failed: {e}");
        app.emit(
            "capture-complete",
            serde_json::json!({
                "path": path_str, "width": clamped.w, "height": clamped.h, "clipboard": clip.is_ok(),
            }),
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Write a thumbnail PNG next to the capture and return its path. Non-fatal: returns
/// None on any failure (the Library card falls back to a placeholder tile).
fn write_thumb(app: &AppHandle, rgba: &[u8], w: u32, h: u32, src_path: &str) -> Option<String> {
    let png = crate::capture::thumb::make_thumb(rgba, w, h, 480).ok()?;
    let dir = app.path().app_local_data_dir().ok()?;
    let dir = crate::paths::thumbs_dir(&dir);
    std::fs::create_dir_all(&dir).ok()?;
    let stem = std::path::Path::new(src_path).file_stem().and_then(|s| s.to_str()).unwrap_or("thumb");
    let dest = dir.join(format!("{stem}.thumb.png"));
    std::fs::write(&dest, &png).ok()?;
    Some(dest.to_string_lossy().to_string())
}
```
> The other `LastCapture { … }` constructions (in the file) must also set `saved`. There is only one other — none; `finish_commit` is the sole constructor. If `cargo build` reports a missing `saved` field elsewhere, add `saved: false` there.

- [ ] **Step 5: Build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles. (`emit` already imported via `tauri::Emitter` in this file.)

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/lib.rs glint/src-tauri/src/capture/mod.rs glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/paths.rs
git commit -m "feat(p4): managed Db, settings hydration, auto-save commit + capture row"
```

---

### Task 5: Library Rust commands

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs` (add the 5 commands)
- Modify: `glint/src-tauri/src/lib.rs` (register them)

**Interfaces:**
- Consumes: `db::{list_captures, capture_path, soft_delete}`, `crate::Db`, `clipboard::copy_image`.
- Produces (Tauri commands; JS sees camelCase args):
  - `captures_list() -> Vec<CaptureListItem>` where `CaptureListItem` = `CaptureRow` flattened + `thumb_data_url: Option<String>`.
  - `capture_open(id: i64)`, `capture_reveal(id: i64)`, `capture_copy(id: i64)`, `capture_delete(id: i64)` → `Result<(), String>`.

- [ ] **Step 1: Add the commands**

Append to `glint/src-tauri/src/capture/commands.rs`:
```rust
// ─── Library commands ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CaptureListItem {
    pub id: i64,
    pub kind: String,
    pub path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
    /// base64 data URL of the thumbnail PNG, when one exists on disk.
    pub thumb_data_url: Option<String>,
}

#[tauri::command]
pub fn captures_list(db: State<crate::Db>) -> Result<Vec<CaptureListItem>, String> {
    let conn = db.0.lock().unwrap();
    let rows = crate::db::list_captures(&conn).map_err(|e| e.to_string())?;
    let items = rows
        .into_iter()
        .map(|r| {
            let thumb_data_url = r.thumb_path.as_ref().and_then(|tp| {
                std::fs::read(tp).ok().map(|bytes| {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    format!("data:image/png;base64,{b64}")
                })
            });
            CaptureListItem {
                id: r.id,
                kind: r.kind,
                path: r.path,
                width: r.width,
                height: r.height,
                bytes: r.bytes,
                created_at: r.created_at,
                thumb_data_url,
            }
        })
        .collect();
    Ok(items)
}

fn path_for(db: &State<crate::Db>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    crate::db::capture_path(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "capture not found".to_string())
}

/// Open the capture in the OS default image viewer.
#[tauri::command]
pub fn capture_open(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for(&db, id)?;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveal (select) the capture in Windows Explorer.
#[tauri::command]
pub fn capture_reveal(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for(&db, id)?;
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Re-copy a Library capture image to the clipboard (decode PNG → rgba).
#[tauri::command]
pub fn capture_copy(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for(&db, id)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    clipboard::copy_image(&img.into_raw(), w, h)
}

/// Soft-delete a capture and remove its files (best effort).
#[tauri::command]
pub fn capture_delete(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = {
        let conn = db.0.lock().unwrap();
        let p = crate::db::capture_path(&conn, id).map_err(|e| e.to_string())?;
        crate::db::soft_delete(&conn, id).map_err(|e| e.to_string())?;
        p
    };
    if let Some(p) = path {
        let _ = std::fs::remove_file(&p);
        let stem = std::path::Path::new(&p).file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());
        // Best-effort thumb removal mirrors write_thumb's naming.
        if let (Some(stem), Ok(local)) = (stem, std::path::Path::new(&p).parent().map(|_| ()).map(|_| ()).ok_or(()).and(Ok(()))) {
            let _ = local; // (thumb lives in app_local_data/thumbs; removed below)
            let _ = stem;
        }
    }
    Ok(())
}
```
> Simplify `capture_delete`'s thumb cleanup: the thumb path isn't returned by `capture_path`. For P4, removing the main file is enough; orphan thumbs are harmless and cleaned in a P8 pass. Replace the `if let (Some(stem), …)` block with nothing (delete it), leaving just `let _ = std::fs::remove_file(&p);`.

- [ ] **Step 2: Register the commands**

In `glint/src-tauri/src/lib.rs`, extend the `use capture::commands::{…}` import and the `generate_handler!` list with:
```rust
captures_list, capture_open, capture_reveal, capture_copy, capture_delete,
```

- [ ] **Step 3: Build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles. (`base64::Engine` and `image` are already deps; confirm `use base64::Engine;` is present at the top of commands.rs — it is, from Phase 3.)

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p4): Library commands — list/open/reveal/copy/delete"
```

---

### Task 6: Library frontend — real cards + actions + drag

**Files:**
- Create: `glint/src/lib/captures.ts` (typed wrappers)
- Create: `glint/src/views/library/CaptureCard.tsx`
- Modify: `glint/src/views/LibraryView.tsx` (use Rust list + cards + reload on event)
- Modify: `glint/src/views/library.css` (card styles)

**Interfaces:**
- Consumes: Rust `captures_list`/`capture_open`/`capture_reveal`/`capture_copy`/`capture_delete`; `dragOut` from `lib/hudIpc`.
- Produces: `CaptureItem` type, `listCaptures`, `openCapture`, `revealCapture`, `copyCapture`, `deleteCapture`.

- [ ] **Step 1: Typed IPC wrappers**

Create `glint/src/lib/captures.ts`:
```ts
/**
 * captures.ts — typed wrappers for the Library's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin.
 */
import { invoke } from "@tauri-apps/api/core";
export { dragOut } from "./hudIpc";

export interface CaptureItem {
  id: number;
  kind: string;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: number; // unix seconds
  thumb_data_url: string | null;
}

export const listCaptures = (): Promise<CaptureItem[]> => invoke<CaptureItem[]>("captures_list");
export const openCapture = (id: number): Promise<void> => invoke<void>("capture_open", { id });
export const revealCapture = (id: number): Promise<void> => invoke<void>("capture_reveal", { id });
export const copyCapture = (id: number): Promise<void> => invoke<void>("capture_copy", { id });
export const deleteCapture = (id: number): Promise<void> => invoke<void>("capture_delete", { id });
```

- [ ] **Step 2: CaptureCard component**

Create `glint/src/views/library/CaptureCard.tsx`:
```tsx
import { ExternalLink, FolderOpen, Copy, Trash2 } from "lucide-react";
import type { CaptureItem } from "../../lib/captures";
import { openCapture, revealCapture, copyCapture, deleteCapture, dragOut } from "../../lib/captures";

function when(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function CaptureCard({ item, onChanged }: { item: CaptureItem; onChanged: () => void }) {
  async function act(fn: () => Promise<void>) {
    try { await fn(); } catch { /* non-fatal; Library stays as-is */ }
  }

  return (
    <div
      className="cap-card"
      role="listitem"
      onPointerDown={() => dragOut(item.path)}
      title="Drag to share"
    >
      <div className="cap-thumb">
        {item.thumb_data_url ? (
          <img src={item.thumb_data_url} alt="" draggable={false} />
        ) : (
          <div className="cap-thumb--empty" />
        )}
      </div>

      <div className="cap-meta">
        <span className="cap-dims">
          {item.width && item.height ? `${item.width}×${item.height}` : "—"}
        </span>
        <span className="cap-when">{when(item.created_at)}</span>
      </div>

      <div className="cap-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button className="cap-btn" aria-label="Open" title="Open" onClick={() => act(() => openCapture(item.id))}>
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>
        <button className="cap-btn" aria-label="Reveal in Explorer" title="Reveal" onClick={() => act(() => revealCapture(item.id))}>
          <FolderOpen size={15} strokeWidth={1.75} />
        </button>
        <button className="cap-btn" aria-label="Copy" title="Copy" onClick={() => act(() => copyCapture(item.id))}>
          <Copy size={15} strokeWidth={1.75} />
        </button>
        <button
          className="cap-btn cap-btn--danger"
          aria-label="Delete"
          title="Delete"
          onClick={() => act(async () => { await deleteCapture(item.id); onChanged(); })}
        >
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rebuild LibraryView**

Replace the data + render parts of `glint/src/views/LibraryView.tsx`. Full file:
```tsx
import { useCallback, useEffect, useState } from "react";
import { Images } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { EmptyState, Select } from "../components/ui";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { CaptureCard } from "./library/CaptureCard";
import "./library.css";

const KIND_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "screenshot", label: "Screenshots" },
  { value: "recording",  label: "Recordings" },
];

export default function LibraryView() {
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [search, setSearch]     = useState("");
  const [kind, setKind]         = useState("all");

  const reload = useCallback(() => {
    listCaptures().then(setCaptures).catch(() => setCaptures([]));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Refresh when a new capture is saved (or one is deleted elsewhere).
  useEffect(() => {
    const p = listen("capture-saved", () => reload());
    return () => { p.then((un) => un()); };
  }, [reload]);

  const visible = captures.filter((c) => {
    const matchesKind   = kind === "all" || c.kind === kind;
    const matchesSearch =
      search.trim() === "" || c.path.toLowerCase().includes(search.toLowerCase());
    return matchesKind && matchesSearch;
  });

  const isEmpty = visible.length === 0;

  return (
    <div className="library-view">
      <section className="library-section" aria-label="Library controls">
        <span className="label library-section-label" id="lib-label">Library</span>
        <div className="library-bar" role="search" aria-label="Filter captures">
          <input
            className="library-search"
            type="search"
            placeholder="Search captures…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search captures by name"
          />
          <Select value={kind} options={KIND_OPTIONS} onChange={setKind} />
        </div>
      </section>

      <section className="library-section library-section--grow" aria-labelledby="lib-label">
        {isEmpty ? (
          <div className="library-empty-wrap">
            <EmptyState
              icon={Images}
              title="Your library is empty"
              hint="Screenshots you take will be collected here."
            />
          </div>
        ) : (
          <div className="library-grid" role="list" aria-label="Captures">
            {visible.map((c) => (
              <CaptureCard key={c.id} item={c} onChanged={reload} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Card styles**

Append to `glint/src/views/library.css`:
```css
/* ── Capture card (Phase 4) ───────────────────────────────────────────────── */
.cap-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  overflow: hidden;
  background: var(--bg-elev);
  cursor: grab;
  transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.cap-card:hover { border-color: var(--border-strong); }
.cap-card:active { cursor: grabbing; }

.cap-thumb {
  aspect-ratio: 16 / 10;
  background: var(--bg-elev2);
  overflow: hidden;
}
.cap-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.cap-thumb--empty { width: 100%; height: 100%; background: var(--bg-elev2); }

.cap-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
}
.cap-dims {
  font-family: var(--ff-mono, ui-monospace, monospace);
  font-size: var(--fz-xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
}
.cap-when { font-size: var(--fz-xs); color: var(--text-faint); }

.cap-actions {
  position: absolute;
  top: var(--s2);
  right: var(--s2);
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r1);
  background: rgba(8, 9, 13, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  transition: opacity var(--dur) var(--ease);
}
.cap-card:hover .cap-actions { opacity: 1; }

.cap-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r1);
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.cap-btn:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.cap-btn--danger:hover { background: var(--danger-subtle, rgba(217,95,118,0.18)); color: var(--danger, #d95f76); }
```

- [ ] **Step 5: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: tsc clean; vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/captures.ts glint/src/views/library glint/src/views/LibraryView.tsx glint/src/views/library.css
git commit -m "feat(p4): real Library — capture cards, actions, drag-out, live reload"
```

---

### Task 7: HUD Save↔Reveal coherence

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs` (`hud_data` returns `saved`; `hud_save` reveals when already saved)
- Modify: `glint/src/lib/hudIpc.ts` (`HudData.saved`)
- Modify: `glint/src/hud/HudActions.tsx` (Save↔Reveal icon/tip by `saved`)
- Modify: `glint/src/hud/HudApp.tsx` (pass `saved`; reveal action)

**Interfaces:**
- Consumes: `LastCapture.saved`, `crate::Db` reveal via Explorer.
- Produces: `hud_data` adds `saved: bool`; `hud_reveal()` command.

- [ ] **Step 1: `hud_data` returns `saved`; add `hud_reveal`**

In `glint/src-tauri/src/capture/commands.rs`, add `pub saved: bool` to `HudData` and set it from `last.saved` in `hud_data`. Add a command:
```rust
/// Reveal the (already auto-saved) capture in Explorer.
#[tauri::command]
pub fn hud_reveal(state: State<crate::capture::LastCaptureState>) -> Result<(), String> {
    let path = {
        let guard = state.0.lock().unwrap();
        guard.as_ref().ok_or("no capture result")?.path.clone()
    };
    std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```
Register `hud_reveal` in `lib.rs`'s import + `generate_handler!`.

- [ ] **Step 2: Frontend HudData + actions**

In `glint/src/lib/hudIpc.ts`, add `saved: boolean;` to `HudData` and `RawHudData` (`saved`), map it in `getHudData`. Add:
```ts
export const hudReveal = (): Promise<void> => invoke<void>("hud_reveal");
```
In `glint/src/hud/HudActions.tsx`, accept a `saved` prop and swap the Save entry:
```tsx
import { Copy, Link2, Save, FolderOpen, Pencil, Pin, type LucideIcon } from "lucide-react";
// ...
export function HudActions({ onAction, saved }: { onAction: (a: HudAction) => void; saved: boolean }) {
  const actions: ButtonDef[] = [
    { id: "copy",      icon: Copy,  tip: "Copy image" },
    { id: "copy-path", icon: Link2, tip: "Copy path" },
    saved
      ? { id: "save", icon: FolderOpen, tip: "Reveal in folder" }
      : { id: "save", icon: Save,       tip: "Save" },
    { id: "annotate",  icon: Pencil, tip: "Annotate" },
    { id: "pin",       icon: Pin,    tip: "Pin" },
  ];
  return (
    <div className="hud-toolbar">
      {actions.map(({ id, icon: Icon, tip }) => (
        <button key={id} type="button" className="hud-btn" data-tip={tip} aria-label={tip}
          onPointerDown={(e) => e.stopPropagation()} onClick={() => onAction(id)}>
          <Icon size={16} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
```
(Remove the old module-level `ACTIONS` constant.)

- [ ] **Step 3: HudApp passes `saved`; save action reveals when saved**

In `glint/src/hud/HudApp.tsx`: pass `saved={data?.saved ?? false}` to `<HudActions>`, and in `onAction`'s `"save"` case branch on it:
```tsx
        case "save":
          if (data?.saved) {
            await hudReveal().then(() => flash("Revealed in folder")).catch(() => flash("Couldn't reveal"));
          } else {
            await hudSave().then((dest) => flash(`Saved · ${fileName(dest)}`)).catch(() => flash("Couldn't save"));
          }
          break;
```
Import `hudReveal` from `../lib/hudIpc`.

- [ ] **Step 4: Typecheck + Rust build — expect PASS**

Run: `cd glint && npx tsc --noEmit && cd src-tauri && cargo build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/lib.rs glint/src/lib/hudIpc.ts glint/src/hud
git commit -m "feat(p4): HUD Save becomes Reveal when the capture was auto-saved"
```

---

### Task 8: Green gate + acceptance notes

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ledger)
- Create: `docs/superpowers/PHASE-4-ACCEPTANCE.md`

- [ ] **Step 1: Full green gate**

Run:
```bash
cd glint && npx tsc --noEmit && npx vite build && cd src-tauri && cargo test
```
Expected: tsc clean; vite build clean; cargo test all pass (existing 20 + thumb 5 + db 4 + settings 3 new).

- [ ] **Step 2: Write the acceptance checklist**

Create `docs/superpowers/PHASE-4-ACCEPTANCE.md` with the manual checklist from the spec §6 (auto-save writes to Pictures\Glint; Library shows the capture instantly; Open/Reveal/Copy/Delete/Drag work; toggle auto-save off stops it and HUD Save adds on demand; auto-copy off leaves the clipboard untouched; latest.png updates; settings survive restart).

- [ ] **Step 3: Update the ledger**

Append a Phase 4 section to `.superpowers/sdd/progress.md` summarizing tasks T1–T8, the rusqlite ownership decision, and the pending manual acceptance.

- [ ] **Step 4: Commit**

```bash
git add .superpowers/sdd/progress.md docs/superpowers/PHASE-4-ACCEPTANCE.md
git commit -m "docs(p4): Phase 4 acceptance checklist + ledger"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** auto-save (T4), captures table ownership (T2/T4), settings live + hydration (T3), Library cards + actions + drag (T5/T6), HUD Save↔Reveal (T7), thumbnails (T1/T4), error handling (non-fatal paths throughout T4/T5), tests (T1/T2/T3). All spec sections map to a task.
- **Switch signature caveat** flagged in T3 Step 6 — verify against `Switch.tsx` before finalizing.
- **`capture_delete` thumb cleanup** simplified to file-only in T5 (orphan thumbs are a P8 cleanup) — note included inline.
- **DB DDL race** avoided: Rust never creates tables at setup; `ensure_captures_table` (IF NOT EXISTS) runs only at capture/library time; settings hydration tolerates a missing table.
