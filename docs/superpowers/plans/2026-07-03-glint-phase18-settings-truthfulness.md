# Glint Phase 18 — Settings Truthfulness + Library Rename/Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image-format/JPEG-quality and recording-fps real settings, represent the fixed
H.264 codec honestly (no fake control), and make Library search useful via renamable captures.

**Architecture:** New `settings::image` encoder core reads two new settings and is called at the
durable screenshot-save sites (capture auto-save, tray Save, pin Save); recording reads a new
`record_fps` through the recorder's existing `fps` parameter; a new `title` column + `capture_rename`
command + a pure `matchesCapture` search helper drive Library rename/search.

**Tech Stack:** Rust (Tauri v2, `image` 0.25, rusqlite, tauri-plugin-sql), TypeScript (React, Zustand, vitest).

## Global Constraints

- **Local-only:** no cloud/upload/accounts/network. **Single-user:** no auth.
- **Recorder isolation (SACRED):** nothing under `recorder/*` gains an import from `capture/`,
  `editor/`, `overlay/`, `ocr/`; `ocr/` gains nothing from `recorder/`. `record_fps` flows through
  the existing `fps` parameter — recorder reads only `settings` (permitted).
- **Green gate every task:** `cargo build` + `cargo clippy` warning-clean; `cargo test` +
  `npx vitest run` green; `npx tsc --noEmit` clean.
- **Boundary (approved):** image format applies to the direct screenshot saves only. The
  `latest.png` agent-mirror, HUD/tray thumbnails, and the editor's "Export" all stay PNG.
- **Settings values (verbatim):** `image_format` ∈ {`png`,`jpeg`,`webp`} default `png`;
  `jpeg_quality` ∈ {`high`,`medium`,`low`} → 92/80/65 default `high`; `record_fps` ∈ {30,60}
  default 60.
- **Branch:** `phase-18-settings-truthfulness` (already created). Single repo rooted at
  `C:/Users/sanir/Claude Code`; app code under `glint/`, docs under `docs/superpowers/`.
- **Commit trailers:** end each message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + the `Claude-Session:` line.

Rust commands run from `glint/src-tauri`; frontend from `glint`.

---

### Task 1: Add the three settings fields (backend)

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (struct fields, defaults, `apply_update`, tests)

**Interfaces:**
- Produces: `Settings.image_format: String`, `Settings.jpeg_quality: String`,
  `Settings.record_fps: u32`; `apply_update` keys `"image_format"`, `"jpeg_quality"`, `"record_fps"`.

- [ ] **Step 1: Write failing tests** (append to the `tests` module in `settings/mod.rs`)

```rust
#[test]
fn defaults_image_and_fps() {
    let s = Settings::default();
    assert_eq!(s.image_format, "png");
    assert_eq!(s.jpeg_quality, "high");
    assert_eq!(s.record_fps, 60);
}

#[test]
fn apply_update_sets_image_and_fps() {
    let mut s = Settings::default();
    apply_update(&mut s, "image_format", json!("jpeg")).unwrap();
    apply_update(&mut s, "jpeg_quality", json!("low")).unwrap();
    apply_update(&mut s, "record_fps", json!(30)).unwrap();
    assert_eq!(s.image_format, "jpeg");
    assert_eq!(s.jpeg_quality, "low");
    assert_eq!(s.record_fps, 30);
}

#[test]
fn apply_update_rejects_bad_image_and_fps() {
    let mut s = Settings::default();
    assert!(apply_update(&mut s, "image_format", json!("tiff")).is_err());
    assert!(apply_update(&mut s, "jpeg_quality", json!("ultra")).is_err());
    assert!(apply_update(&mut s, "record_fps", json!(45)).is_err());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --lib settings:: 2>&1 | grep -E "error|defaults_image"`
Expected: compile error (unknown field `image_format`).

- [ ] **Step 3: Add fields to the `Settings` struct** (after `include_cursor: bool,` at line 58)

```rust
    /// Saved-screenshot encoding: "png" | "jpeg" | "webp".
    pub image_format: String,
    /// JPEG quality bucket: "high" | "medium" | "low" (→ 92/80/65). JPEG only.
    pub jpeg_quality: String,
    /// Screen-recording frame rate: 30 or 60.
    pub record_fps: u32,
```

- [ ] **Step 4: Add defaults** (in `Default for Settings`, after `include_cursor: false,`)

```rust
            image_format: "png".into(),
            jpeg_quality: "high".into(),
            record_fps: 60,
```

- [ ] **Step 5: Add `apply_update` arms** (before the `other =>` arm)

```rust
        "image_format" => {
            let v = value.as_str().ok_or("image_format must be string")?;
            if !matches!(v, "png" | "jpeg" | "webp") {
                return Err("image_format must be png|jpeg|webp".into());
            }
            s.image_format = v.to_string();
        }
        "jpeg_quality" => {
            let v = value.as_str().ok_or("jpeg_quality must be string")?;
            if !matches!(v, "high" | "medium" | "low") {
                return Err("jpeg_quality must be high|medium|low".into());
            }
            s.jpeg_quality = v.to_string();
        }
        "record_fps" => {
            let v = value.as_u64().ok_or("record_fps must be a number")?;
            if v != 30 && v != 60 {
                return Err("record_fps must be 30 or 60".into());
            }
            s.record_fps = v as u32;
        }
```

- [ ] **Step 6: Run tests**

Run: `cargo test --lib settings:: 2>&1 | grep "test result"`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs
git commit -m "feat(p18): image_format, jpeg_quality, record_fps settings fields"
```

---

### Task 2: Image encoder core (`settings::image`)

**Files:**
- Create: `glint/src-tauri/src/settings/image.rs`
- Modify: `glint/src-tauri/src/settings/mod.rs` (add `pub mod image;`)

**Interfaces:**
- Produces: `pub fn encode_save(rgba: &[u8], w: u32, h: u32, fmt: &str, quality: &str) ->
  Result<(Vec<u8>, &'static str), String>` returning `(bytes, ext_without_dot)`; `png`→`"png"`,
  `jpeg`→`"jpg"`, `webp`→`"webp"`. JPEG drops alpha (RGBA→RGB); PNG/WebP keep RGBA.

- [ ] **Step 1: Write the file with failing tests**

```rust
//! Encode saved screenshots in the user's chosen format. PNG/WebP keep RGBA; JPEG is opaque
//! (screenshots have alpha=255, so dropping it is visually lossless). Fully local, no assets.
use image::{codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, codecs::webp::WebPEncoder,
    ExtendedColorType, ImageEncoder};

/// Map the quality bucket to a JPEG quality (1..=100).
pub fn jpeg_q(level: &str) -> u8 {
    match level {
        "medium" => 80,
        "low" => 65,
        _ => 92, // "high" and any unknown
    }
}

/// Encode `rgba` (row-major, 4 bytes/px) as the chosen format. Returns the bytes and the file
/// extension (no dot). Unknown format falls back to PNG.
pub fn encode_save(rgba: &[u8], w: u32, h: u32, fmt: &str, quality: &str)
    -> Result<(Vec<u8>, &'static str), String>
{
    let mut out = Vec::new();
    match fmt {
        "jpeg" => {
            // JPEG has no alpha channel — drop it (screenshots are opaque).
            let mut rgb = Vec::with_capacity((w * h * 3) as usize);
            for px in rgba.chunks_exact(4) {
                rgb.extend_from_slice(&px[0..3]);
            }
            JpegEncoder::new_with_quality(&mut out, jpeg_q(quality))
                .write_image(&rgb, w, h, ExtendedColorType::Rgb8)
                .map_err(|e| e.to_string())?;
            Ok((out, "jpg"))
        }
        "webp" => {
            WebPEncoder::new_lossless(&mut out)
                .write_image(rgba, w, h, ExtendedColorType::Rgba8)
                .map_err(|e| e.to_string())?;
            Ok((out, "webp"))
        }
        _ => {
            PngEncoder::new(&mut out)
                .write_image(rgba, w, h, ExtendedColorType::Rgba8)
                .map_err(|e| e.to_string())?;
            Ok((out, "png"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(w: u32, h: u32) -> Vec<u8> {
        // A simple gradient so JPEG quality actually changes the byte count.
        (0..w * h).flat_map(|i| [(i % 256) as u8, ((i / 2) % 256) as u8, 40, 255]).collect()
    }

    #[test]
    fn png_has_png_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "png", "high").unwrap();
        assert_eq!(&b[0..4], &[0x89, b'P', b'N', b'G']);
        assert_eq!(ext, "png");
    }

    #[test]
    fn jpeg_has_jpeg_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "jpeg", "high").unwrap();
        assert_eq!(&b[0..2], &[0xFF, 0xD8]);
        assert_eq!(ext, "jpg");
    }

    #[test]
    fn webp_has_riff_webp_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "webp", "high").unwrap();
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(&b[8..12], b"WEBP");
        assert_eq!(ext, "webp");
    }

    #[test]
    fn lower_jpeg_quality_is_smaller() {
        let hi = encode_save(&rgba(64, 64), 64, 64, "jpeg", "high").unwrap().0;
        let lo = encode_save(&rgba(64, 64), 64, 64, "jpeg", "low").unwrap().0;
        assert!(lo.len() < hi.len(), "low={} should be < high={}", lo.len(), hi.len());
    }

    #[test]
    fn unknown_format_falls_back_to_png() {
        let (b, ext) = encode_save(&rgba(4, 4), 4, 4, "tiff", "high").unwrap();
        assert_eq!(&b[0..4], &[0x89, b'P', b'N', b'G']);
        assert_eq!(ext, "png");
    }
}
```

- [ ] **Step 2: Register the module** — add to `settings/mod.rs` alongside the other `pub mod`s:

```rust
pub mod image;
```

- [ ] **Step 3: Run to verify (tests should now compile and pass)**

Run: `cargo test --lib settings::image 2>&1 | grep "test result"`
Expected: `test result: ok. 5 passed`.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/settings/image.rs glint/src-tauri/src/settings/mod.rs
git commit -m "feat(p18): settings::image encode_save (png/jpeg/webp) core + tests"
```

---

### Task 3: Filename extension + wire capture auto-save

**Files:**
- Modify: `glint/src-tauri/src/paths.rs` (`capture_filename` takes an `ext`; update its test)
- Modify: `glint/src-tauri/src/capture/commands.rs` (`finish_commit` auto-save path)

**Interfaces:**
- Consumes: `settings::image::encode_save`.
- Produces: `capture_filename(dt: DateTime<Local>, ext: &str) -> String`.

- [ ] **Step 1: Update the `capture_filename` test** (in `paths.rs` tests)

Find the existing test asserting the `.png` name and change it to pass an ext:
```rust
    #[test]
    fn capture_filename_uses_ext() {
        let dt = Local.with_ymd_and_hms(2026, 6, 21, 14, 30, 5).unwrap();
        assert_eq!(capture_filename(dt, "png"), "Glint 2026-06-21 at 14.30.05.png");
        assert_eq!(capture_filename(dt, "jpg"), "Glint 2026-06-21 at 14.30.05.jpg");
    }
```
(If the existing test uses a different construction for `dt`, keep that construction and only
add the `ext` argument + the second assertion.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --lib paths:: 2>&1 | grep -E "error|capture_filename"`
Expected: compile error (arity mismatch).

- [ ] **Step 3: Change `capture_filename`** (`paths.rs:12-14`)

```rust
/// Filesystem-safe capture filename, e.g. `Glint 2026-06-21 at 14.30.05.png`.
pub fn capture_filename(dt: DateTime<Local>, ext: &str) -> String {
    dt.format(&format!("Glint %Y-%m-%d at %H.%M.%S.{ext}")).to_string()
}
```

- [ ] **Step 4: Wire `finish_commit`** — extend the settings read (`commands.rs:178-182`) and the
auto-save branch (`185-191`):

Change the settings read to also grab format+quality:
```rust
    let (auto_save, auto_copy, open_in_editor, image_format, jpeg_quality) = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let s = state.0.lock().unwrap();
        (s.auto_save, s.auto_copy, s.open_in_editor, s.image_format.clone(), s.jpeg_quality.clone())
    };
```
Change the auto-save branch to encode with the chosen format (the `png` var stays PNG for the
thumbnail data-URL + `latest.png` mirror; only the durable file changes):
```rust
    let (path, saved) = if auto_save {
        let dir = crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Screenshot);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let (save_bytes, ext) =
            crate::settings::image::encode_save(&cropped, clamped.w, clamped.h, &image_format, &jpeg_quality)?;
        let filename = crate::paths::capture_filename(chrono::Local::now(), ext);
        let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
        std::fs::write(&dest, &save_bytes).map_err(|e| e.to_string())?;
        (dest, true)
    } else {
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dest = dir.join(format!("glint-{ts}.png"));
        std::fs::write(&dest, &png).map_err(|e| e.to_string())?;
        (dest, false)
    };
```
(The temp/non-auto-save path stays PNG — the tray card re-encodes on Save in Task 4.)

- [ ] **Step 5: Fix any other `capture_filename` callers**

Run: `grep -rn "capture_filename(" glint/src-tauri/src`
For every call NOT yet updated (tray_save at ~`commands.rs:406`, pin at `pin.rs:211`), pass an
ext argument — Task 4 rewrites those two properly, so for now pass `"png"` to keep it compiling
(Task 4 replaces them). Confirm the build compiles.

- [ ] **Step 6: Build + tests**

Run: `cargo build 2>&1 | grep -c warning:` → `0`.
Run: `cargo test --lib 2>&1 | grep "test result" | head -1` → passes.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/paths.rs glint/src-tauri/src/capture/commands.rs
git commit -m "feat(p18): format-aware capture auto-save (filename ext + encode_save)"
```

---

### Task 4: Wire tray Save + pin Save to the format encoder

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs` (`tray_save`)
- Modify: `glint/src-tauri/src/pin.rs` (save-to-library site ~209-213)

**Interfaces:**
- Consumes: `settings::image::encode_save`, `read_rgba` (already in `commands.rs`).

- [ ] **Step 1: Rewrite `tray_save`'s copy into a re-encode** (`commands.rs`, the block around 404-408)

Replace the `capture_filename` + `fs::copy` lines:
```rust
    let (image_format, jpeg_quality) = {
        let s = app.state::<crate::settings::commands::SettingsState>();
        let g = s.0.lock().unwrap();
        (g.image_format.clone(), g.jpeg_quality.clone())
    };
    // Re-encode from the temp file's pixels so the saved file honors the chosen format.
    let (src_rgba, sw, sh) = read_rgba(&it.path)?;
    let (save_bytes, ext) =
        crate::settings::image::encode_save(&src_rgba, sw, sh, &image_format, &jpeg_quality)?;
    let filename = crate::paths::capture_filename(chrono::Local::now(), ext);
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &save_bytes).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();
```
The later `read_rgba(&dest_str)` for the thumbnail can reuse `src_rgba`/`sw`/`sh` directly — replace
`let (rgba, w, h) = read_rgba(&dest_str)?;` with `let (rgba, w, h) = (src_rgba, sw, sh);`.

- [ ] **Step 2: Wire pin Save** (`pin.rs` ~209-213) — decode the stored PNG to pixels, then encode:

```rust
    let dir = crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Screenshot);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (image_format, jpeg_quality) = {
        let s = app.state::<crate::settings::commands::SettingsState>();
        let g = s.0.lock().unwrap();
        (g.image_format.clone(), g.jpeg_quality.clone())
    };
    let decoded = image::load_from_memory(&d.png).map_err(|e| e.to_string())?.to_rgba8();
    let (save_bytes, ext) = crate::settings::image::encode_save(
        &decoded, decoded.width(), decoded.height(), &image_format, &jpeg_quality)?;
    let filename = crate::paths::capture_filename(chrono::Local::now(), ext);
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &save_bytes).map_err(|e| e.to_string())?;
```
(Confirm the surrounding code uses `dest` for the Library row/thumb as before; only the write
changed. If a `create_dir_all` already exists just above, don't duplicate it.)

- [ ] **Step 3: Build + clippy + tests**

Run: `cargo build 2>&1 | grep -c warning:` → `0`; `cargo clippy 2>&1 | grep -c "^warning:"` → `0`;
`cargo test --lib 2>&1 | grep "test result" | head -1` → passes.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/pin.rs
git commit -m "feat(p18): tray Save + pin Save honor the image format setting"
```

---

### Task 5: Recording frame rate from settings

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (read `record_fps` in `recorder_start`, replace `FPS` uses)
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (add a fps-wiring test)

**Interfaces:**
- Consumes: `Settings.record_fps`.

- [ ] **Step 1: Add a failing ffmpeg-arg test** (in `ffmpeg.rs` tests)

```rust
    #[test]
    fn framerate_arg_follows_fps() {
        let a30 = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "out.mp4", &[], false, true);
        let a60 = build_ffmpeg_args(&RecordTarget::Fullscreen, 60, "out.mp4", &[], false, true);
        let fr = |a: &[String]| a.windows(2).find(|w| w[0] == "-framerate").map(|w| w[1].clone());
        assert_eq!(fr(&a30).as_deref(), Some("30"));
        assert_eq!(fr(&a60).as_deref(), Some("60"));
    }
```
(Match the real `build_ffmpeg_args` signature — see `ffmpeg.rs:38`; adjust arg list if it differs.)

- [ ] **Step 2: Run to verify it passes or fails honestly**

Run: `cargo test --lib recorder::ffmpeg 2>&1 | grep "test result"`
Expected: PASS (the arg builder already threads fps — this test pins that contract).

- [ ] **Step 3: Read `record_fps` in `recorder_start`** — near the top of `recorder_start` (before the
`ActiveRecording` is built at ~639), add:

```rust
    let fps = app.state::<crate::settings::commands::SettingsState>()
        .0.lock().unwrap().record_fps;
```
Then replace `fps: FPS,` (mod.rs:641) with `fps,` and `spawn_segment(&app, target, FPS, …)`
(mod.rs:662) with `spawn_segment(&app, target, fps, …)`.

- [ ] **Step 4: Remove the now-unused `const FPS`** (mod.rs:22-24) if nothing else references it.

Run: `grep -rn "\bFPS\b" glint/src-tauri/src/recorder` — if only the const definition remains,
delete it; otherwise leave it. Confirm build.

- [ ] **Step 5: Build + tests**

Run: `cargo build 2>&1 | grep -c warning:` → `0`; `cargo test --lib recorder:: 2>&1 | grep "test result"`.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/recorder/ffmpeg.rs
git commit -m "feat(p18): recording frame rate from record_fps setting"
```

---

### Task 6: DB title column + capture_rename command

**Files:**
- Modify: `glint/src-tauri/src/db/mod.rs` (migration v2, `ensure_captures_table`, `CaptureRow`,
  `list_captures`, new `set_title`, tests)
- Modify: `glint/src-tauri/src/capture/commands.rs` (new `capture_rename` command)
- Modify: `glint/src-tauri/src/lib.rs` (register `capture_rename`)

**Interfaces:**
- Produces: `CaptureRow.title: Option<String>`; `db::set_title(conn, id, Option<&str>)`;
  Tauri command `capture_rename(app, id: i64, title: String)`.

- [ ] **Step 1: Failing DB tests** (append to `db/mod.rs` tests)

```rust
    #[test]
    fn set_title_round_trips_and_clears() {
        let c = mem();
        let id = insert_capture(&c, &sample("/t.png", 100)).unwrap();
        set_title(&c, id, Some("Invoice")).unwrap();
        let rows = list_captures(&c).unwrap();
        assert_eq!(rows[0].title.as_deref(), Some("Invoice"));
        set_title(&c, id, None).unwrap();
        assert_eq!(list_captures(&c).unwrap()[0].title, None);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --lib db:: 2>&1 | grep -E "error|set_title"`
Expected: compile error (`title` field / `set_title` missing).

- [ ] **Step 3: Add the migration v2** (in `migrations()`, push a second `Migration`)

```rust
        Migration {
            version: 2,
            description: "add capture title",
            sql: "ALTER TABLE captures ADD COLUMN title TEXT;",
            kind: MigrationKind::Up,
        },
```

- [ ] **Step 4: Make `ensure_captures_table` title-aware** — add `title TEXT` to the
`CREATE TABLE IF NOT EXISTS` column list, and after the `execute_batch`, add a defensive column-add
that ignores the duplicate-column error (covers DBs the CREATE already made without it):

```rust
    // Older DBs created before the title column: add it, ignoring "duplicate column".
    let _ = conn.execute("ALTER TABLE captures ADD COLUMN title TEXT", []);
    Ok(())
```
(Place the `let _ = …` line just before the final `Ok(())`; the `execute_batch(...)?` above stays.)

- [ ] **Step 5: Add `title` to `CaptureRow` + `list_captures`**

In `CaptureRow` (after `created_at: i64,`): `pub title: Option<String>,`
In `list_captures`, add `title` to the SELECT and the row builder:
```rust
        "SELECT id, kind, path, thumb_path, width, height, bytes, created_at, title
         FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC",
```
```rust
                created_at: r.get(7)?,
                title: r.get(8)?,
```

- [ ] **Step 6: Add `set_title`**

```rust
pub fn set_title(conn: &Connection, id: i64, title: Option<&str>) -> rusqlite::Result<()> {
    ensure_captures_table(conn)?;
    conn.execute("UPDATE captures SET title = ?1 WHERE id = ?2", rusqlite::params![title, id])?;
    Ok(())
}
```

- [ ] **Step 7: Run DB tests**

Run: `cargo test --lib db:: 2>&1 | grep "test result"` → passes.

- [ ] **Step 8: Add the `capture_rename` command** (in `capture/commands.rs`, near the other Library commands)

```rust
/// Rename a Library capture. An empty/whitespace title clears it (back to NULL).
#[tauri::command]
pub fn capture_rename(app: AppHandle, id: i64, title: String) -> Result<(), String> {
    let trimmed = title.trim();
    let value = if trimmed.is_empty() { None } else { Some(trimmed) };
    let conn = app.state::<crate::Db>();
    let guard = conn.0.lock().unwrap();
    crate::db::set_title(&guard, id, value).map_err(|e| e.to_string())
}
```

- [ ] **Step 9: Register the command** in `lib.rs` `invoke_handler` list — add `capture_rename` next
to the other capture commands. Confirm build.

- [ ] **Step 10: Build + tests + commit**

Run: `cargo build 2>&1 | grep -c warning:` → `0`; `cargo test --lib 2>&1 | grep "test result" | head -1`.
```bash
git add glint/src-tauri/src/db/mod.rs glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p18): capture title column + capture_rename command"
```

---

### Task 7: Frontend — store, IPC types, Capture + Recording UI

**Files:**
- Modify: `glint/src/store/useAppStore.ts` (Settings fields + 3 setters)
- Modify: `glint/src/views/settings/Capture.tsx` (live format + quality)
- Modify: `glint/src/views/settings/Recording.tsx` (live fps + honest codec line)
- Modify: `glint/src/views/settings.css` (`.settings-static-value`)

**Interfaces:**
- Consumes: backend keys `image_format`, `jpeg_quality`, `record_fps`; `capture_rename` (Task 8).
- Produces: `setImageFormat`, `setJpegQuality`, `setRecordFps` store actions.

- [ ] **Step 1: Extend the `Settings` interface** (`useAppStore.ts:15-35`, after `include_cursor`)

```ts
  image_format: "png" | "jpeg" | "webp";
  jpeg_quality: "high" | "medium" | "low";
  record_fps: 30 | 60;
```

- [ ] **Step 2: Add the three setters** — declare in `AppState` and implement following the exact
pattern of `setSoundEffects` (optimistic `set`, then `saveSetting(key, v)` + `persistSetting(key, v)`).
For `record_fps` the value is a number:

```ts
  setImageFormat: (v: "png" | "jpeg" | "webp") => Promise<void>;
  setJpegQuality: (v: "high" | "medium" | "low") => Promise<void>;
  setRecordFps: (v: 30 | 60) => Promise<void>;
```
Implementations (mirror an existing setter; example for one):
```ts
  setImageFormat: async (v) => {
    set((s) => (s.settings ? { settings: { ...s.settings, image_format: v } } : s));
    await saveSetting("image_format", v);
    await persistSetting("image_format", v);
  },
  setJpegQuality: async (v) => {
    set((s) => (s.settings ? { settings: { ...s.settings, jpeg_quality: v } } : s));
    await saveSetting("jpeg_quality", v);
    await persistSetting("jpeg_quality", v);
  },
  setRecordFps: async (v) => {
    set((s) => (s.settings ? { settings: { ...s.settings, record_fps: v } } : s));
    await saveSetting("record_fps", v);
    await persistSetting("record_fps", v);
  },
```
(Match the actual `set(...)` shape used by neighboring setters in this file — copy their exact form.)

- [ ] **Step 3: Rebuild `Capture.tsx`** — replace the two inert controls with live Selects:

```tsx
import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

const FORMAT_OPTIONS = [
  { value: "png",  label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];
const QUALITY_OPTIONS = [
  { value: "high",   label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low",    label: "Low" },
];

export function Capture() {
  const settings = useAppStore((s) => s.settings);
  const setImageFormat = useAppStore((s) => s.setImageFormat);
  const setJpegQuality = useAppStore((s) => s.setJpegQuality);
  const setIncludeCursor = useAppStore((s) => s.setIncludeCursor);
  const isJpeg = (settings?.image_format ?? "png") === "jpeg";
  return (
    <Section title="Capture" description="Format and quality settings for screenshots.">
      <Field label="Image format" hint="File format for saved screenshots.">
        <Select
          value={settings?.image_format ?? "png"}
          options={FORMAT_OPTIONS}
          onChange={(v) => void setImageFormat(v as "png" | "jpeg" | "webp")}
        />
      </Field>
      <Field label="JPEG quality" hint="Compression level when saving as JPEG.">
        <Select
          value={settings?.jpeg_quality ?? "high"}
          options={QUALITY_OPTIONS}
          onChange={(v) => void setJpegQuality(v as "high" | "medium" | "low")}
          disabled={!isJpeg}
        />
      </Field>
      <Field label="Include cursor" hint="Bake the mouse pointer into screenshots.">
        <Switch
          checked={settings?.include_cursor ?? false}
          onChange={(v) => void setIncludeCursor(v)}
        />
      </Field>
    </Section>
  );
}
```

- [ ] **Step 4: Update `Recording.tsx`** — make Frame rate live (30/60 only) and replace the codec
inert control with an honest static line. Replace `FPS_OPTIONS` with `[{value:"60",label:"60 fps"},
{value:"30",label:"30 fps"}]`, drop `CODEC_OPTIONS`, add `setRecordFps` from the store, and swap
the two Fields:

```tsx
      <Field label="Frame rate" hint="Frames per second for screen recordings.">
        <Select
          value={String(settings?.record_fps ?? 60)}
          options={FPS_OPTIONS}
          onChange={(v) => void setRecordFps(Number(v) as 30 | 60)}
        />
      </Field>
      <Field label="Video codec" hint="Encoding format for recorded video.">
        <span className="settings-static-value">H.264 · MP4 (maximum compatibility)</span>
      </Field>
```
Remove the now-unused `Info` import if nothing else uses it.

- [ ] **Step 5: Add the static-value style** (`settings.css`, near the other settings styles)

```css
/* Honest read-only value where a setting is intentionally fixed (not a control). */
.settings-static-value { font-size: 13px; color: var(--text-dim); opacity: 0.9; }
```

- [ ] **Step 6: Typecheck + build**

Run (from `glint`): `npx tsc --noEmit` → clean. `npx vitest run 2>&1 | grep "Tests "` → still green.

- [ ] **Step 7: Commit**

```bash
git add glint/src/store/useAppStore.ts glint/src/views/settings/Capture.tsx glint/src/views/settings/Recording.tsx glint/src/views/settings.css
git commit -m "feat(p18): live format/quality/fps settings UI + honest codec line"
```

---

### Task 8: Frontend — Library rename + search

**Files:**
- Modify: `glint/src/lib/captures.ts` (`CaptureItem.title`, `renameCapture`)
- Create: `glint/src/views/library/search.ts` (pure `matchesCapture`)
- Create: `glint/src/views/library/search.test.ts` (vitest)
- Modify: `glint/src/views/library/CaptureCard.tsx` (title display + inline rename)
- Modify: `glint/src/views/LibraryView.tsx` (search via `matchesCapture`, placeholder)

**Interfaces:**
- Consumes: `capture_rename` command (Task 6).
- Produces: `matchesCapture(item: CaptureItem, query: string): boolean`; `renameCapture(id, title)`.

- [ ] **Step 1: Extend `CaptureItem` + add `renameCapture`** (`captures.ts`)

Add `title: string | null;` to the `CaptureItem` interface, and:
```ts
export const renameCapture = (id: number, title: string): Promise<void> =>
  invoke<void>("capture_rename", { id, title });
```

- [ ] **Step 2: Write the pure search helper with failing tests** — create `search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchesCapture } from "./search";
import type { CaptureItem } from "../../lib/captures";

const item = (over: Partial<CaptureItem>): CaptureItem => ({
  id: 1, kind: "screenshot", path: "/x/Glint 2026-07-02 at 13.07.00.png",
  thumb_path: null, width: 800, height: 600, created_at: 1751461620, title: null, ...over,
});

describe("matchesCapture", () => {
  it("empty query matches all", () => {
    expect(matchesCapture(item({}), "")).toBe(true);
    expect(matchesCapture(item({}), "   ")).toBe(true);
  });
  it("matches the custom title case-insensitively", () => {
    expect(matchesCapture(item({ title: "Invoice March" }), "invoice")).toBe(true);
    expect(matchesCapture(item({ title: "Invoice" }), "receipt")).toBe(false);
  });
  it("matches the kind keyword", () => {
    expect(matchesCapture(item({ kind: "recording" }), "record")).toBe(true);
  });
  it("matches an untitled capture by its human date", () => {
    // 1751461620 = 2026-07-02 in local time; a 'jul' or '2026' substring should hit.
    expect(matchesCapture(item({ title: null }), "2026")).toBe(true);
  });
});
```

- [ ] **Step 3: Implement `search.ts`** to pass:

```ts
import type { CaptureItem } from "../../lib/captures";

/** True when `query` (case-insensitive substring) matches the capture's title, kind, or
 *  human-readable date. Empty/whitespace query matches everything. */
export function matchesCapture(item: CaptureItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const date = new Date(item.created_at * 1000)
    .toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit" })
    .toLowerCase();
  const hay = [item.title ?? "", item.kind, date].join(" ").toLowerCase();
  return hay.includes(q);
}
```

- [ ] **Step 4: Run the search tests**

Run (from `glint`): `npx vitest run src/views/library/search.test.ts 2>&1 | grep "Tests "`
Expected: all pass.

- [ ] **Step 5: Wire search into `LibraryView.tsx`** — import `matchesCapture`, replace the
`matchesSearch` line in the `visible` filter, and update the placeholder/aria:

```tsx
  const visible = captures.filter((c) => {
    const matchesKind = kind === "all" || c.kind === kind;
    return matchesKind && matchesCapture(c, search);
  });
```
```tsx
            placeholder="Search by name or date…"
            ...
            aria-label="Search captures by name or date"
```

- [ ] **Step 6: Add title + inline rename to `CaptureCard.tsx`**

Add local state and a rename handler; show the title when set (replacing the dimensions line),
and add a "Rename" action. Concretely: import `renameCapture`; add
```tsx
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title ?? "");
  const commitRename = async () => {
    setRenaming(false);
    if ((draft.trim() || null) !== (item.title ?? null)) {
      await renameCapture(item.id, draft.trim());
      onChanged();
    }
  };
```
In the card's caption row, when `renaming` render an `<input>` (autoFocus; `onKeyDown` Enter →
`commitRename()`, Escape → `setRenaming(false)`; `onBlur` → `commitRename()`); otherwise render the
title (or the existing dimensions/`—` fallback) with a small "Rename" button in the hover actions
that does `setDraft(item.title ?? ""); setRenaming(true)`. Match the existing action-button markup
and CSS classes already used in this file.

- [ ] **Step 7: Typecheck + full frontend tests**

Run (from `glint`): `npx tsc --noEmit` → clean. `npx vitest run 2>&1 | grep "Tests "` → green
(baseline 99 + the new search tests).

- [ ] **Step 8: Commit**

```bash
git add glint/src/lib/captures.ts glint/src/views/library/search.ts glint/src/views/library/search.test.ts glint/src/views/library/CaptureCard.tsx glint/src/views/LibraryView.tsx
git commit -m "feat(p18): library rename + title/date/kind search"
```

---

### Task 9: Full green gate + at-screen + merge

**Files:** none (verification + merge).

- [ ] **Step 1: Full green gate**

From `glint/src-tauri`: `cargo build 2>&1 | grep -c warning:` → `0`;
`cargo clippy 2>&1 | grep -c "^warning:"` → `0`; `cargo test 2>&1 | grep "test result" | head -1`.
From `glint`: `npx vitest run 2>&1 | grep "Tests "`; `npx tsc --noEmit`.

- [ ] **Step 2: At-screen acceptance** (present to the user; do NOT merge before sign-off)

Launch `npm run tauri dev` (no truncating pipe). Verify: set format=JPEG, capture → a `.jpg`
lands in the save folder and opens; set format=WebP → a `.webp` lands; set fps=30, record a few
seconds → the file plays; rename a Library capture and find it by its new name in search; the
codec line reads as static "H.264 · MP4 (maximum compatibility)".

- [ ] **Step 3: Merge to master** (after acceptance)

```bash
cd "C:/Users/sanir/Claude Code"
git checkout master
git merge --no-ff phase-18-settings-truthfulness -m "merge: Phase 18 — settings truthfulness + library rename/search"
git branch -d phase-18-settings-truthfulness
git checkout -- glint/src-tauri/Cargo.toml   # discard any CRLF/LF EOL noise
```

- [ ] **Step 4: Update ROADMAP** — add a Phase 18 "Shipped" entry (image format/quality, selectable
fps, honest codec, library rename/search) in the established prose style; commit.

## Self-Review

- **Spec coverage:** A (image format/quality) → Tasks 1,2,3,4,7; B (fps + honest codec) → Tasks
  1,5,7; C (rename/search) → Tasks 6,8. Green gate + docs → Task 9. All spec sections covered.
- **Placeholders:** none — every code step shows real code; the one prose-described UI step
  (CaptureCard rename, Task 8 Step 6) gives exact state + handlers and defers only to existing
  in-file markup conventions, which is appropriate.
- **Type consistency:** `encode_save(rgba,w,h,fmt,quality) -> (Vec<u8>, &'static str)` used
  identically in Tasks 3/4; `capture_filename(dt, ext)` consistent across Tasks 3/4; `set_title` /
  `capture_rename` / `renameCapture` / `matchesCapture` names match across Tasks 6/8; settings keys
  `image_format`/`jpeg_quality`/`record_fps` consistent backend (Task 1) ↔ store (Task 7).
