# Screen Recorder — R1 (Core Video) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a screen region or the fullscreen primary monitor to a silent MP4 via a bundled ffmpeg sidecar, show a floating control bar while recording, and land the finished file in the Library as a `kind="recording"` row.

**Architecture:** A new **isolated** `recorder/` Rust module owns a bundled **ffmpeg** sidecar that captures the screen directly (`gdigrab`, with `ddagrab` as an optional enhancement) **and** encodes to MP4 in one process. Stop is graceful (`q`→stdin, never kill). The only coupling to the rest of the app is outbound: on stop the recorder writes the MP4 + inserts one Library row (the same seam screenshots use). Three small always-on-top windows (region selector, countdown, control bar) drive the UX.

**Tech Stack:** Tauri v2 (Rust), `tauri-plugin-shell` (sidecar spawn), bundled `ffmpeg.exe`, React 19 + TypeScript, the existing `db`/`paths`/`image` infrastructure.

## Global Constraints

- **Local-first:** no network/upload/accounts. Single user, no auth.
- **Recorder isolation (SACRED):** `capture/`, `editor/`, and the Library list/grid import **nothing** from `recorder/`. ffmpeg lives only behind `recorder/`. Coupling is outbound only (MP4 + one Library row + `capture-saved` emit).
- **No GIF, no audio (R2), no webcam (R3), no in-app player, no settings UI** in R1. Fixed defaults: MP4 / H.264 (libx264, `-preset ultrafast`) / yuv420p / 30 fps / native resolution / `+faststart`.
- **Save to** `Videos\Glint\`, filename `Glint <YYYY-MM-DD at HH.MM.SS>.mp4`.
- **New window checklist (learned the hard way):** every new window type needs (1) build OFF the main thread, (2) a label-scoped `capabilities/*.json`, (3) a FORCED recompile after editing a capability (`touch src/lib.rs && cargo build` — cargo fingerprinting misses capability edits).
- **Window-build deadlock rule:** building a `WebviewWindow` on the main thread deadlocks the event loop. Build from a spawned thread or a `#[tauri::command(async)]`.
- **Visible feedback always:** every failure path emits a `glint-toast` — never silent.
- **Commit message footer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Recorder module scaffold + pure helpers (TDD)

Pure, dependency-free logic: ffmpeg argument building, output filename, and region-rect validation/even-rounding. Fully unit-testable before any ffmpeg/window work.

**Files:**
- Create: `glint/src-tauri/src/recorder/mod.rs`
- Create: `glint/src-tauri/src/recorder/ffmpeg.rs`
- Modify: `glint/src-tauri/src/lib.rs` (add `mod recorder;` after `mod paths;` — keep alphabetical: `paths`, `pin`, `recorder`, `settings`)

**Interfaces:**
- Produces:
  - `pub enum RecordTarget { Fullscreen, Region { x: i32, y: i32, w: u32, h: u32 } }` (in `recorder/mod.rs`)
  - `pub fn even(n: u32) -> u32` (round down to even — yuv420p needs even dims)
  - `pub fn normalize_region(x: i32, y: i32, w: u32, h: u32) -> Option<(i32, i32, u32, u32)>` (returns None if w/h < 16 after rounding; rounds w/h down to even)
  - `pub fn recording_filename(now: chrono::DateTime<chrono::Local>) -> String` → `"Glint 2026-06-28 at 14.30.05.mp4"`
  - `pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str) -> Vec<String>` (gdigrab capture + libx264 args)

- [ ] **Step 1: Create the module files with the test module first (RED)**

Create `glint/src-tauri/src/recorder/ffmpeg.rs` with ONLY tests first (won't compile — that's RED):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::RecordTarget;

    #[test]
    fn even_rounds_down() {
        assert_eq!(even(1920), 1920);
        assert_eq!(even(1921), 1920);
        assert_eq!(even(1), 0);
    }

    #[test]
    fn fullscreen_args_have_no_offset() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4");
        assert!(a.contains(&"gdigrab".to_string()));
        assert!(a.contains(&"desktop".to_string()));
        assert!(!a.iter().any(|s| s == "-offset_x"));
        // ends with the output path
        assert_eq!(a.last().unwrap(), "C:/out.mp4");
        // libx264 + yuv420p + faststart present
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
    }

    #[test]
    fn region_args_carry_offset_and_size() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(&t, 30, "C:/r.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
    }

    #[test]
    fn normalize_rejects_tiny_and_rounds_even() {
        assert!(super::super::normalize_region(0, 0, 10, 10).is_none());
        assert_eq!(super::super::normalize_region(5, 6, 641, 480), Some((5, 6, 640, 480)));
    }

    #[test]
    fn filename_format() {
        use chrono::TimeZone;
        let dt = chrono::Local.with_ymd_and_hms(2026, 6, 28, 14, 30, 5).unwrap();
        assert_eq!(super::super::recording_filename(dt), "Glint 2026-06-28 at 14.30.05.mp4");
    }
}
```

Create `glint/src-tauri/src/recorder/mod.rs` with the module wiring + the test-referenced items as stubs that fail to compile if wrong (start empty so it's RED):

```rust
//! Screen recorder (R1: silent video). ISOLATED — owns the bundled ffmpeg
//! sidecar; the screenshot/library/editor path imports nothing from here. The
//! only outbound coupling is on stop: write the MP4 + insert one Library row.

pub mod ffmpeg;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint/src-tauri && cargo test recorder::`
Expected: FAIL — `cannot find function build_ffmpeg_args` / `RecordTarget` etc.

- [ ] **Step 3: Implement the pure helpers**

In `glint/src-tauri/src/recorder/mod.rs`, ABOVE `pub mod ffmpeg;`:

```rust
/// What to record. Region coords/size are PHYSICAL pixels on the primary monitor.
#[derive(Clone, Copy, Debug)]
pub enum RecordTarget {
    Fullscreen,
    Region { x: i32, y: i32, w: u32, h: u32 },
}

/// Round a region rect for recording: even w/h (yuv420p requires it); reject if
/// the result is too small to be a real selection (< 16px either side).
pub fn normalize_region(x: i32, y: i32, w: u32, h: u32) -> Option<(i32, i32, u32, u32)> {
    let w = ffmpeg::even(w);
    let h = ffmpeg::even(h);
    if w < 16 || h < 16 {
        return None;
    }
    Some((x, y, w, h))
}

/// `Glint 2026-06-28 at 14.30.05.mp4` — dots in the time so it's a valid filename.
pub fn recording_filename(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("Glint %Y-%m-%d at %H.%M.%S.mp4").to_string()
}
```

In `glint/src-tauri/src/recorder/ffmpeg.rs`, ABOVE the test module:

```rust
use crate::recorder::RecordTarget;

/// Round down to the nearest even number (yuv420p needs even width/height).
pub fn even(n: u32) -> u32 {
    n - (n % 2)
}

/// Build the ffmpeg arg list: capture the screen via gdigrab and encode H.264 MP4.
/// `-preset ultrafast` keeps encoding real-time at 30 fps; `+faststart` + a clean
/// `q`-driven stop yield a seekable, playable file.
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str) -> Vec<String> {
    let mut a: Vec<String> = vec!["-y".into(), "-f".into(), "gdigrab".into(),
        "-framerate".into(), fps.to_string()];
    if let RecordTarget::Region { x, y, w, h } = target {
        a.extend([
            "-offset_x".into(), x.to_string(),
            "-offset_y".into(), y.to_string(),
            "-video_size".into(), format!("{w}x{h}"),
        ]);
    }
    a.extend([
        "-i".into(), "desktop".into(),
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
        "-movflags".into(), "+faststart".into(),
        out.into(),
    ]);
    a
}
```

Add `mod recorder;` to `glint/src-tauri/src/lib.rs` after `mod paths;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd glint/src-tauri && cargo test recorder::`
Expected: PASS — 5 tests.

- [ ] **Step 5: Verify the build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds (unused-fn warnings OK until later tasks).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/ glint/src-tauri/src/lib.rs
git commit -m "feat(p8): recorder module scaffold + ffmpeg arg/region/filename helpers"
```

---

### Task 2: Bundle the ffmpeg sidecar + spawn spike

Wire `tauri-plugin-shell`, bundle `ffmpeg.exe` as a sidecar, and prove the app can spawn it. This de-risks the whole feature before any recording logic.

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `tauri-plugin-shell`)
- Modify: `glint/src-tauri/tauri.conf.json` (`bundle.externalBin`)
- Create: `glint/src-tauri/binaries/` (place the ffmpeg binary — see step 2)
- Modify: `glint/src-tauri/src/lib.rs` (init the shell plugin; add a temporary `recorder_ffmpeg_check` command)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (the check command)

**Interfaces:**
- Produces: `#[tauri::command(async)] fn recorder_ffmpeg_check(app) -> Result<String, String>` returning the first line of `ffmpeg -version`.

- [ ] **Step 1: Add the shell plugin dependency**

In `glint/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-shell = "2"
```

- [ ] **Step 2: Obtain the ffmpeg binary and place it as a sidecar**

Tauri sidecars are named with the target triple. For this machine (Windows x64):

```bash
mkdir -p glint/src-tauri/binaries
# Download a static ffmpeg.exe (e.g. gyan.dev "essentials" build) and place it as:
#   glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
# Verify the triple:
rustc -Vv | grep host    # e.g. host: x86_64-pc-windows-msvc
```

Place the downloaded `ffmpeg.exe` at `glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe` (rename to match the printed host triple exactly). This file is git-ignored if large; document its required presence in the acceptance doc.

- [ ] **Step 3: Declare the external binary in tauri.conf.json**

In `glint/src-tauri/tauri.conf.json`, in the `bundle` object, add:

```json
"externalBin": ["binaries/ffmpeg"]
```

(Tauri resolves `binaries/ffmpeg` to `binaries/ffmpeg-<target-triple>.exe`.)

- [ ] **Step 4: Init the shell plugin + add the check command**

In `glint/src-tauri/src/lib.rs`, add to the Builder chain (next to the other `.plugin(...)` calls):

```rust
.plugin(tauri_plugin_shell::init())
```

In `glint/src-tauri/src/recorder/mod.rs`, add:

```rust
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Spike/health-check: spawn the bundled ffmpeg sidecar and return its version
/// banner's first line. Confirms bundling + spawn + permissions before we build
/// the recorder on top. Runs off the main thread.
#[tauri::command(async)]
pub async fn recorder_ffmpeg_check(app: AppHandle) -> Result<String, String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar resolve: {e}"))?
        .args(["-version"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().unwrap_or("ffmpeg (no banner)").to_string())
}
```

Register it in `lib.rs` `invoke_handler![ … ]` (add `recorder::recorder_ffmpeg_check,`) and `use recorder::recorder_ffmpeg_check;` is not needed if you reference it as `recorder::recorder_ffmpeg_check` in the handler list.

- [ ] **Step 5: Verify spawn works**

Run: `cd glint/src-tauri && cargo build`
Then from the running app (dev), invoke the command from the devtools console:
`window.__TAURI__.core.invoke('recorder_ffmpeg_check').then(console.log)`
Expected: logs something like `ffmpeg version 7.x ...`. If "sidecar resolve" fails, the binary name/triple is wrong; if a permission error, see step 6.

- [ ] **Step 6: (If needed) shell permission**

Spawning a sidecar from Rust generally does not require a JS capability. If a permission error appears, add to `capabilities/default.json` permissions: `"shell:allow-execute"`. Rebuild (capability edits need a forced recompile: `touch src/lib.rs && cargo build`).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/tauri.conf.json glint/src-tauri/src/lib.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p8): bundle ffmpeg sidecar + spawn health-check"
```

---

### Task 3: Recorder core — start/stop/cancel + thumbnail + Library row (tray-testable)

The heart of R1: spawn ffmpeg to record, stop it gracefully, extract a thumbnail, write the Library row. Made at-screen testable NOW via temporary tray items (Start Fullscreen / Stop) before any custom UI.

**Files:**
- Create: `glint/src-tauri/src/recorder/thumb.rs`
- Modify: `glint/src-tauri/src/recorder/mod.rs` (state, commands, orchestration)
- Modify: `glint/src-tauri/src/lib.rs` (manage `RecorderState`, register commands)
- Modify: `glint/src-tauri/src/tray.rs` (temporary Start Fullscreen / Stop items)

**Interfaces:**
- Consumes: `build_ffmpeg_args`, `RecordTarget`, `recording_filename`, `normalize_region` (Task 1); `recorder_ffmpeg_check` pattern (Task 2); `crate::db::{NewCapture, insert_capture}`, `crate::Db`, `crate::paths`.
- Produces:
  - `pub struct RecorderState(pub Mutex<Option<ActiveRecording>>)` (derives Default)
  - `ActiveRecording { child: CommandChild, out_path: String, width: u32, height: u32, started: Instant }`
  - Commands: `recorder_start(app, mode: String, x?, y?, w?, h?)`, `recorder_stop(app)`, `recorder_cancel(app)`, `recorder_status(app) -> Option<RecorderStatusDto>`

- [ ] **Step 1: Thumbnail extractor**

Create `glint/src-tauri/src/recorder/thumb.rs`:

```rust
//! First-frame thumbnail for a finished recording — a quick second ffmpeg pass.
//! Recorder-owned (no call into capture/). Non-fatal: returns None on any failure.

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

pub async fn extract_thumb(app: &AppHandle, mp4_path: &str) -> Option<String> {
    let dir = app.path().app_local_data_dir().ok()?;
    let dir = crate::paths::thumbs_dir(&dir);
    std::fs::create_dir_all(&dir).ok()?;
    let stem = std::path::Path::new(mp4_path).file_stem()?.to_string_lossy().to_string();
    let thumb = dir.join(format!("{stem}.png"));
    let thumb_str = thumb.to_string_lossy().to_string();
    let status = app
        .shell()
        .sidecar("ffmpeg").ok()?
        .args(["-y", "-i", mp4_path, "-ss", "0", "-vframes", "1", "-vf", "scale=480:-1", &thumb_str])
        .output()
        .await
        .ok()?;
    if status.status.success() && thumb.exists() { Some(thumb_str) } else { None }
}
```

- [ ] **Step 2: State + start/stop/cancel/status in `recorder/mod.rs`**

Add to `glint/src-tauri/src/recorder/mod.rs` (imports + state + commands):

```rust
use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;

pub mod thumb;

/// One in-flight recording. Holds the ffmpeg child so stop can talk to its stdin.
pub struct ActiveRecording {
    pub child: CommandChild,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub started: Instant,
}

#[derive(Default)]
pub struct RecorderState(pub Mutex<Option<ActiveRecording>>);

#[derive(Serialize)]
pub struct RecorderStatusDto {
    pub recording: bool,
    pub elapsed_secs: u64,
}

/// Start recording. `mode` is "fullscreen" or "region"; region passes x/y/w/h
/// (physical px). Spawns ffmpeg (capture+encode) and stores the child. Off the
/// main thread so the spawn never blocks the event loop.
#[tauri::command(async)]
pub async fn recorder_start(
    app: tauri::AppHandle,
    mode: String,
    x: Option<i32>,
    y: Option<i32>,
    w: Option<u32>,
    h: Option<u32>,
) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    // Already recording? Ignore (single recording in R1).
    if app.state::<RecorderState>().0.lock().unwrap().is_some() {
        return Err("already recording".into());
    }

    let target = match mode.as_str() {
        "fullscreen" => RecordTarget::Fullscreen,
        "region" => {
            let (x, y, w, h) = (x.unwrap_or(0), y.unwrap_or(0), w.unwrap_or(0), h.unwrap_or(0));
            let (x, y, w, h) = normalize_region(x, y, w, h).ok_or("selection too small")?;
            RecordTarget::Region { x, y, w, h }
        }
        other => return Err(format!("unknown mode: {other}")),
    };

    // Output path in Videos\Glint.
    let videos = app.path().video_dir().map_err(|e| e.to_string())?;
    let dir = videos.join("Glint");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out = dir.join(recording_filename(chrono::Local::now()));
    let out_str = out.to_string_lossy().to_string();

    let (width, height) = match target {
        RecordTarget::Region { w, h, .. } => (w, h),
        RecordTarget::Fullscreen => (0, 0), // filled by the monitor below if needed
    };

    let args = ffmpeg::build_ffmpeg_args(&target, 30, &out_str);
    let (_rx, child) = app
        .shell()
        .sidecar("ffmpeg").map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    *app.state::<RecorderState>().0.lock().unwrap() = Some(ActiveRecording {
        child,
        out_path: out_str,
        width,
        height,
        started: Instant::now(),
    });
    let _ = app.emit("recorder-started", ());
    Ok(())
}

/// Stop + finalize: send `q` to ffmpeg (clean MP4), wait briefly, extract a
/// thumbnail, insert the Library row, emit capture-saved. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_stop(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    let rec = rec.ok_or("not recording")?;
    let ActiveRecording { mut child, out_path, .. } = rec;

    // Graceful stop: ffmpeg quits on 'q' and writes the moov atom. NEVER kill.
    let _ = child.write(b"q");
    // Give ffmpeg a moment to finalize; then ensure the process is gone.
    std::thread::sleep(std::time::Duration::from_millis(800));
    let _ = child.kill(); // no-op if already exited; safety net

    if !std::path::Path::new(&out_path).exists() {
        let _ = app.emit("glint-toast", "Recording failed to save");
        return Err("no output file".into());
    }
    let bytes = std::fs::metadata(&out_path).map(|m| m.len() as i64).unwrap_or(0);
    if bytes < 1024 {
        let _ = std::fs::remove_file(&out_path);
        let _ = app.emit("glint-toast", "Recording too short");
        return Ok(());
    }

    let thumb_path = thumb::extract_thumb(&app, &out_path).await;
    let row = crate::db::NewCapture {
        kind: "recording".into(),
        path: out_path.clone(),
        thumb_path,
        width: None,
        height: None,
        bytes: Some(bytes),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("recording insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    let _ = app.emit("recorder-stopped", ());
    let _ = app.emit("glint-toast", "Recording saved");
    Ok(())
}

/// Discard an in-flight recording: stop ffmpeg and delete the partial file.
#[tauri::command(async)]
pub async fn recorder_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    if let Some(ActiveRecording { mut child, out_path, .. }) = rec {
        let _ = child.write(b"q");
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = child.kill();
        let _ = std::fs::remove_file(&out_path);
    }
    let _ = app.emit("recorder-stopped", ());
    Ok(())
}

#[tauri::command]
pub fn recorder_status(app: tauri::AppHandle) -> Option<RecorderStatusDto> {
    let guard = app.state::<RecorderState>().0.lock().unwrap();
    guard.as_ref().map(|r| RecorderStatusDto {
        recording: true,
        elapsed_secs: r.started.elapsed().as_secs(),
    })
}
```

> NOTE (spike-verify): confirm the `tauri-plugin-shell` v2 API names against the installed version — `sidecar()`, `.spawn() -> (Receiver<CommandEvent>, CommandChild)`, `CommandChild::write(&[u8])` and `kill(self)`. Adjust if the installed version differs (e.g. `write` taking `&self` vs `&mut self`).

- [ ] **Step 3: Manage state + register commands in `lib.rs`**

In `glint/src-tauri/src/lib.rs`: add `.manage(crate::recorder::RecorderState::default())` near the other `.manage(...)` calls, and add to `invoke_handler![ … ]`:

```rust
            recorder::recorder_ffmpeg_check,
            recorder::recorder_start,
            recorder::recorder_stop,
            recorder::recorder_cancel,
            recorder::recorder_status,
```

- [ ] **Step 4: Temporary tray items to test end-to-end**

In `glint/src-tauri/src/tray.rs`, add two items to the menu (temporary — replaced by the real submenu in Task 6) and handlers:

```rust
let rec_full = MenuItem::with_id(app, "rec_full", "Start Fullscreen Recording", true, None::<&str>)?;
let rec_stop = MenuItem::with_id(app, "rec_stop", "Stop Recording", true, None::<&str>)?;
```

Add them to the `Menu::with_items(...)` list, and in `on_menu_event`:

```rust
"rec_full" => {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::recorder::recorder_start(app2.clone(), "fullscreen".into(), None, None, None, None).await {
            let _ = tauri::Emitter::emit(&app2, "glint-toast", format!("Record failed: {e}"));
        }
    });
}
"rec_stop" => {
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::recorder::recorder_stop(app2).await;
    });
}
```

- [ ] **Step 5: Build + at-screen smoke test**

Run: `cd glint/src-tauri && cargo build && cargo test`
Then in the dev app: tray → **Start Fullscreen Recording**, wait a few seconds, tray → **Stop Recording**.
Expected: an MP4 appears in `Videos\Glint\`, plays in a video player, AND a recording row appears in the Library (with a thumbnail) after the `capture-saved` event.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/ glint/src-tauri/src/lib.rs glint/src-tauri/src/tray.rs
git commit -m "feat(p8): recorder start/stop/cancel + thumbnail + Library row (tray-tested)"
```

---

### Task 4: Control bar + countdown windows

The floating control bar (REC dot · timer · Stop) and the 3-2-1 countdown. Frontend routes + off-thread window builders + a `recorder` capability.

**Files:**
- Create: `glint/src/recorder/ControlBar.tsx`, `glint/src/recorder/Countdown.tsx`, `glint/src/recorder/recorder.css`
- Create: `glint/src/lib/recorder.ts` (IPC wrappers)
- Modify: `glint/src/router.tsx` (`/rec-bar`, `/rec-countdown` routes, chrome-free)
- Modify: `glint/src/main.tsx` (force transparent bg for `#/rec-bar` and `#/rec-countdown`, like `#/pin`)
- Create: `glint/src-tauri/src/recorder/windows.rs` (off-thread builders for the bar + countdown)
- Create: `glint/src-tauri/capabilities/recorder.json` (windows `rec-*`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`pub mod windows;`; show the bar on start, close on stop; run countdown before start)

**Interfaces:**
- Consumes: `recorder_stop`, `recorder_status` (Task 3).
- Produces: `glint/src/lib/recorder.ts` exports `recorderStop()`, `recorderStatus()`, `recorderStartFullscreen()`, `recorderStartRegion(rect)`; `build_control_bar(app)`, `build_countdown(app)` (Rust).

- [ ] **Step 1: IPC wrappers**

Create `glint/src/lib/recorder.ts`:

```ts
/** recorder.ts — typed wrappers for the screen recorder's Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface RecorderStatus { recording: boolean; elapsed_secs: number }

export const recorderStartFullscreen = (): Promise<void> =>
  invoke<void>("recorder_start", { mode: "fullscreen" });
export const recorderStartRegion = (r: { x: number; y: number; w: number; h: number }): Promise<void> =>
  invoke<void>("recorder_start", { mode: "region", x: r.x, y: r.y, w: r.w, h: r.h });
export const recorderStop = (): Promise<void> => invoke<void>("recorder_stop");
export const recorderCancel = (): Promise<void> => invoke<void>("recorder_cancel");
export const recorderStatus = (): Promise<RecorderStatus | null> =>
  invoke<RecorderStatus | null>("recorder_status");
```

- [ ] **Step 2: Control bar component**

Create `glint/src/recorder/ControlBar.tsx`:

```tsx
/** ControlBar.tsx — the floating REC indicator (route #/rec-bar). */
import { useEffect, useState } from "react";
import { recorderStop } from "../lib/recorder";
import { Square } from "lucide-react";
import "./recorder.css";

function mmss(total: number): string {
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ControlBar() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="rec-bar">
      <span className="rec-dot" aria-hidden />
      <span className="rec-time">{mmss(secs)}</span>
      <button className="rec-stop" onClick={() => recorderStop()} title="Stop recording" aria-label="Stop">
        <Square size={13} strokeWidth={2.5} fill="currentColor" />
      </button>
    </div>
  );
}
```

> The timer counts from mount (the bar is created right when recording starts). A small unit test for `mmss` can live in `glint/src/recorder/ControlBar.test.ts`.

- [ ] **Step 3: Countdown component**

Create `glint/src/recorder/Countdown.tsx`:

```tsx
/** Countdown.tsx — centered 3·2·1 before recording (route #/rec-countdown). */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./recorder.css";

export function Countdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    if (n <= 0) { getCurrentWindow().close(); return; }
    const id = window.setTimeout(() => setN((v) => v - 1), 1000);
    return () => window.clearTimeout(id);
  }, [n]);
  return <div className="rec-countdown">{n > 0 ? n : ""}</div>;
}
```

- [ ] **Step 4: Styles**

Create `glint/src/recorder/recorder.css`:

```css
.rec-bar {
  display: inline-flex; align-items: center; gap: 10px;
  background: rgba(20,20,24,0.92); color: #fff;
  padding: 6px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  font-size: 13px; user-select: none; -webkit-user-select: none;
}
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #ff3b30; animation: rec-pulse 1.2s infinite; }
@keyframes rec-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
.rec-time { font-variant-numeric: tabular-nums; min-width: 44px; }
.rec-stop { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; border-radius: 6px; background: #ff3b30; color: #fff; cursor: pointer; }
.rec-countdown {
  width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center;
  font-size: 120px; font-weight: 700; color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,0.6);
  background: transparent; user-select: none;
}
```

- [ ] **Step 5: Routes + transparent bg**

In `glint/src/router.tsx`: import `ControlBar` and `Countdown`, add chrome-free routes after `/pin`:

```tsx
  { path: "/rec-bar", element: <ControlBar /> },
  { path: "/rec-countdown", element: <Countdown /> },
```

In `glint/src/main.tsx`, extend the transparent-route check to include `#/rec-bar` and `#/rec-countdown` (same block that handles `#/pin`).

- [ ] **Step 6: Off-thread window builders (Rust)**

Create `glint/src-tauri/src/recorder/windows.rs` modeled on `hud.rs`/`pin.rs` (decorations false, transparent true, always_on_top true, skip_taskbar true, shadow false, focused false, visible false → position → show). Build OFF the main thread.

```rust
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const BAR_LABEL: &str = "rec-bar";
pub const COUNTDOWN_LABEL: &str = "rec-countdown";

/// Bottom-center floating control bar. Interactive but focus-less (pin pattern).
pub fn build_control_bar(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(BAR_LABEL).is_some() { return Ok(()); }
    let win = WebviewWindowBuilder::new(app, BAR_LABEL, WebviewUrl::App("index.html#/rec-bar".into()))
        .title("Glint Recording").decorations(false).transparent(true)
        .always_on_top(true).skip_taskbar(true).resizable(false).shadow(false)
        .focused(false).inner_size(180.0, 44.0).visible(false).build()?;
    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor(); let pos = m.position(); let size = m.size();
        let bar_w = (180.0 * s) as i32; let bar_h = (44.0 * s) as i32;
        let x = pos.x + (size.width as i32 - bar_w) / 2;
        let y = pos.y + size.height as i32 - bar_h - (60.0 * s) as i32;
        win.set_position(tauri::PhysicalPosition { x, y })?;
    }
    win.show()?;
    Ok(())
}

pub fn close_control_bar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(BAR_LABEL) { let _ = w.close(); }
}

/// Fullscreen, centered, click-through countdown. Closes itself at 0.
pub fn build_countdown(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(COUNTDOWN_LABEL).is_some() { return Ok(()); }
    let win = WebviewWindowBuilder::new(app, COUNTDOWN_LABEL, WebviewUrl::App("index.html#/rec-countdown".into()))
        .title("Glint").decorations(false).transparent(true).always_on_top(true)
        .skip_taskbar(true).resizable(false).shadow(false).focused(false).visible(false).build()?;
    if let Some(m) = win.primary_monitor()? {
        let pos = m.position(); let size = m.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    win.set_ignore_cursor_events(true)?; // click-through
    win.show()?;
    Ok(())
}
```

In `glint/src-tauri/src/recorder/mod.rs`: add `pub mod windows;`. In `recorder_start`, AFTER the child is stored, call `let _ = windows::build_control_bar(&app);`. In `recorder_stop` and `recorder_cancel`, call `windows::close_control_bar(&app);` near the top. (Countdown is wired in Task 6 where start is user-initiated; the tray test path can skip it.)

- [ ] **Step 7: Capability for `rec-*` windows**

Create `glint/src-tauri/capabilities/recorder.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "recorder",
  "description": "Capability for the recorder control bar / countdown / region selector windows.",
  "windows": ["rec-*"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-start-dragging",
    "core:window:allow-current-monitor",
    "core:window:allow-set-position",
    "core:window:allow-set-size"
  ]
}
```

- [ ] **Step 8: Build (forced recompile for the capability) + verify**

Run: `cd glint/src-tauri && touch src/lib.rs && cargo build` then `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`.
At-screen: tray Start Fullscreen → the control bar appears bottom-center with a ticking timer; clicking Stop ends the recording and the bar disappears.

- [ ] **Step 9: Commit**

```bash
git add glint/src/recorder/ glint/src/lib/recorder.ts glint/src/router.tsx glint/src/main.tsx glint/src-tauri/src/recorder/ glint/src-tauri/capabilities/recorder.json
git commit -m "feat(p8): recorder control bar + countdown windows"
```

---

### Task 5: Live region selector window

A transparent, live (non-frozen) full-screen overlay to drag the record rectangle, then start a region recording.

**Files:**
- Create: `glint/src/recorder/RegionSelect.tsx`
- Modify: `glint/src/recorder/recorder.css` (selector styles)
- Modify: `glint/src/router.tsx` (`/rec-select` route)
- Modify: `glint/src/main.tsx` (transparent bg for `#/rec-select`)
- Modify: `glint/src-tauri/src/recorder/windows.rs` (`build_region_selector`, `close_region_selector`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`recorder_open_region_selector` command; selector confirms → countdown → start)

**Interfaces:**
- Consumes: `recorderStartRegion`, `recorderCancel`; `getCurrentWindow().scaleFactor()`.
- Produces: `recorder_open_region_selector(app)` command; `RegionSelect` component that, on confirm, converts the drawn CSS rect to PHYSICAL px and calls `recorderStartRegion`.

- [ ] **Step 1: Region selector component**

Create `glint/src/recorder/RegionSelect.tsx`:

```tsx
/** RegionSelect.tsx — live (non-frozen) drag-to-pick record region (#/rec-select). */
import { useRef, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recorderStartRegion } from "../lib/recorder";
import "./recorder.css";

type Pt = { x: number; y: number };

export function RegionSelect() {
  const [start, setStart] = useState<Pt | null>(null);
  const [cur, setCur] = useState<Pt | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") getCurrentWindow().close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rect = start && cur
    ? { left: Math.min(start.x, cur.x), top: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) }
    : null;

  const onDown = (e: React.PointerEvent) => { dragging.current = true; setStart({ x: e.clientX, y: e.clientY }); setCur({ x: e.clientX, y: e.clientY }); };
  const onMove = (e: React.PointerEvent) => { if (dragging.current) setCur({ x: e.clientX, y: e.clientY }); };
  const onUp = async () => {
    dragging.current = false;
    if (!rect || rect.w < 8 || rect.h < 8) { getCurrentWindow().close(); return; }
    const scale = await getCurrentWindow().scaleFactor();
    const mon = (await getCurrentWindow().outerPosition()); // window covers the monitor at its origin
    // CSS px → physical px, offset by the monitor's physical origin.
    const x = Math.round(mon.x + rect.left * scale);
    const y = Math.round(mon.y + rect.top * scale);
    const w = Math.round(rect.w * scale);
    const h = Math.round(rect.h * scale);
    await getCurrentWindow().close();
    await recorderStartRegion({ x, y, w, h });
  };

  return (
    <div className="rec-select" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {rect && (
        <div className="rec-select-rect" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
          <span className="rec-select-dim">{rect.w}×{rect.h}</span>
        </div>
      )}
      {!rect && <div className="rec-select-hint">Drag to select a region · Esc to cancel</div>}
    </div>
  );
}
```

- [ ] **Step 2: Selector styles** (append to `recorder.css`)

```css
.rec-select { position: fixed; inset: 0; background: rgba(0,0,0,0.35); cursor: crosshair; user-select: none; }
.rec-select-rect { position: absolute; border: 2px solid #5b7cfa; background: rgba(91,124,250,0.12); box-shadow: 0 0 0 9999px rgba(0,0,0,0.35); }
.rec-select-dim { position: absolute; top: -22px; left: 0; background: #5b7cfa; color: #fff; font-size: 12px; padding: 1px 6px; border-radius: 4px; }
.rec-select-hint { position: absolute; top: 24px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; }
```

> NOTE: `box-shadow: 0 0 0 9999px` on the rect creates the "clear hole, dim everything else" effect; the `.rec-select` background dim can then be lowered/removed. Verify visually; adjust during at-screen.

- [ ] **Step 3: Route + transparent bg**

`glint/src/router.tsx`: import `RegionSelect`, add `{ path: "/rec-select", element: <RegionSelect /> }`. `glint/src/main.tsx`: include `#/rec-select` in the transparent-bg routes.

- [ ] **Step 4: Selector window builder (Rust)** — append to `windows.rs`:

```rust
pub const SELECT_LABEL: &str = "rec-select";

/// Full-screen, transparent, LIVE (non-frozen) region selector. Takes focus so it
/// gets pointer + Esc. Covers the primary monitor.
pub fn build_region_selector(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(SELECT_LABEL).is_some() { return Ok(()); }
    let win = WebviewWindowBuilder::new(app, SELECT_LABEL, WebviewUrl::App("index.html#/rec-select".into()))
        .title("Glint Select Region").decorations(false).transparent(true)
        .always_on_top(true).skip_taskbar(true).resizable(false).shadow(false)
        .focused(true).visible(false).build()?;
    if let Some(m) = win.primary_monitor()? {
        let pos = m.position(); let size = m.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    win.show()?; win.set_focus()?;
    Ok(())
}
```

In `recorder/mod.rs` add the command (built off the main thread via `(async)`):

```rust
#[tauri::command(async)]
pub async fn recorder_open_region_selector(app: tauri::AppHandle) -> Result<(), String> {
    windows::build_region_selector(&app).map_err(|e| e.to_string())
}
```

Register `recorder::recorder_open_region_selector` in `lib.rs` `invoke_handler!`.

- [ ] **Step 5: Build (forced recompile) + at-screen**

`cd glint/src-tauri && touch src/lib.rs && cargo build` then frontend `tsc`/`vitest`/`vite build`. At-screen: trigger `recorder_open_region_selector` (temporarily from devtools `invoke('recorder_open_region_selector')`), drag a box → region recording starts, control bar shows, Stop saves an MP4 cropped to the region.

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/ glint/src/router.tsx glint/src/main.tsx glint/src-tauri/src/recorder/
git commit -m "feat(p8): live region selector for recording"
```

---

### Task 6: Entry points — tray submenu, record hotkey, Home button, countdown wiring

Replace the temporary tray items with a real Capture/Record flow, wire the `record` hotkey to region recording, add a Home button, and run the 3-2-1 countdown before recording starts.

**Files:**
- Modify: `glint/src-tauri/src/tray.rs` (Record Region / Record Fullscreen / Stop Recording)
- Modify: `glint/src-tauri/src/shortcuts.rs` (`record` hotkey → open region selector)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (countdown before start: `recorder_start` shows countdown, waits ~3s, then spawns ffmpeg)
- Modify: `glint/src/views/HomeView.tsx` (a "Record" button)

**Interfaces:**
- Consumes: `recorder_open_region_selector`, `recorder_start("fullscreen")`, `recorder_stop` (Tasks 3–5); `windows::build_countdown` (Task 4).

- [ ] **Step 1: Countdown before recording**

In `recorder/mod.rs` `recorder_start`, BEFORE spawning ffmpeg, show the countdown and wait so the user can prepare:

```rust
    // 3-2-1 countdown (the window closes itself at 0).
    let _ = windows::build_countdown(&app);
    tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
```

(`tokio::time::sleep` is available because the command is `async`; the Tauri async runtime is tokio.)

- [ ] **Step 2: Tray submenu**

In `tray.rs`, replace the temporary `rec_full`/`rec_stop` items with a Record submenu:

```rust
let rec_region = MenuItem::with_id(app, "rec_region", "Record Region", true, None::<&str>)?;
let rec_full = MenuItem::with_id(app, "rec_full", "Record Fullscreen", true, None::<&str>)?;
let rec_stop = MenuItem::with_id(app, "rec_stop", "Stop Recording", true, None::<&str>)?;
let record = Submenu::with_id_and_items(app, "record_menu", "Record", true, &[&rec_region, &rec_full, &rec_stop])?;
```

Add `&record` to the menu items list (replace the old standalone `&record` recording stub if present). Handlers:

```rust
"rec_region" => { let a = app.clone(); tauri::async_runtime::spawn(async move { let _ = crate::recorder::recorder_open_region_selector(a).await; }); }
"rec_full"   => { let a = app.clone(); tauri::async_runtime::spawn(async move { let _ = crate::recorder::recorder_start(a, "fullscreen".into(), None, None, None, None).await; }); }
"rec_stop"   => { let a = app.clone(); tauri::async_runtime::spawn(async move { let _ = crate::recorder::recorder_stop(a).await; }); }
```

- [ ] **Step 3: Record hotkey**

In `shortcuts.rs`, replace the `"record"` stub branch (currently falls through to focus-main) with:

```rust
"record" => {
    let h = handle.clone();
    tauri::async_runtime::spawn(async move { let _ = crate::recorder::recorder_open_region_selector(h).await; });
}
```

- [ ] **Step 4: Home button**

In `glint/src/views/HomeView.tsx`, add a "Record" quick-start button that calls `recorder_open_region_selector` (import `invoke`), next to the existing capture buttons. Match the existing button markup.

- [ ] **Step 5: Build + verify**

`cd glint/src-tauri && cargo build && cargo test` then frontend gates. At-screen: tray → Record Region → countdown → control bar → Stop; the `record` hotkey opens the selector; Home "Record" works.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/tray.rs glint/src-tauri/src/shortcuts.rs glint/src-tauri/src/recorder/mod.rs glint/src/views/HomeView.tsx
git commit -m "feat(p8): recorder entry points (tray submenu, hotkey, Home) + countdown"
```

---

### Task 7: Library card — recording variant

Recordings list in the Library with a ▶ thumbnail and video-appropriate actions only (Open / Reveal / Delete).

**Files:**
- Modify: `glint/src/views/library/CaptureCard.tsx`

**Interfaces:**
- Consumes: `item.kind` from `CaptureItem` (already `kind: string`); existing `openCapture`, `revealCapture`, `deleteCapture`.

- [ ] **Step 1: Branch the card on kind**

In `CaptureCard.tsx`, compute `const isRecording = item.kind === "recording";`. When `isRecording`:
- overlay a ▶ badge on the thumbnail (a `Play` icon from lucide-react, absolutely positioned center).
- render only **Open · Reveal · Delete** (omit Copy/Edit/Pin). `Open` uses the existing `openCapture(item.id)` (the OS default player opens via file association).
- skip the `onPointerDown={() => dragOut(...)}` image-drag for recordings (dragging a video frame makes no sense).

Concrete: wrap the actions row so recordings get the reduced set:

```tsx
{isRecording ? (
  <>
    <button className="cap-btn" title="Open" aria-label="Open" onClick={() => act(() => openCapture(item.id))}><ExternalLink size={15} strokeWidth={1.75} /></button>
    <button className="cap-btn" title="Reveal" aria-label="Reveal" onClick={() => act(() => revealCapture(item.id))}><FolderOpen size={15} strokeWidth={1.75} /></button>
    <button className="cap-btn cap-btn--danger" title="Delete" aria-label="Delete" onClick={() => act(async () => { await deleteCapture(item.id); onChanged(); })}><Trash2 size={15} strokeWidth={1.75} /></button>
  </>
) : (
  /* existing image actions (Open/Reveal/Edit/Copy/Pin/Delete) */
)}
```

Add a `Play` import from `lucide-react` and a `.cap-thumb-play` badge style in `library.css`.

- [ ] **Step 2: Build + verify**

`cd glint && npx tsc --noEmit && npx vitest run && npx vite build`. At-screen: a recording shows the ▶ badge; Open launches the default player; Reveal opens Explorer; Delete removes it. Image captures are unchanged.

- [ ] **Step 3: Commit**

```bash
git add glint/src/views/library/CaptureCard.tsx glint/src/views/library.css
git commit -m "feat(p8): Library recording cards (play badge + Open/Reveal/Delete)"
```

---

### Task 8: Green gate + acceptance + roadmap

**Files:**
- Create: `docs/superpowers/PHASE-8-RECORDER-R1-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: Full green gate**

Run (Rust): `cd glint/src-tauri && cargo build && cargo test`
Run (frontend): `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`
Record exact counts.

- [ ] **Step 2: Acceptance doc**

Create `docs/superpowers/PHASE-8-RECORDER-R1-ACCEPTANCE.md` with: the green-gate checkboxes; the **ffmpeg binary prerequisite** (`binaries/ffmpeg-<triple>.exe` must be present); and an at-screen checklist:
- Record Fullscreen (tray) → countdown → control bar → Stop → MP4 in `Videos\Glint` plays → Library recording row + ▶ thumbnail.
- Record Region (tray / hotkey / Home) → drag → records just that region → cropped MP4.
- Esc cancels the selector; Stop saves; an instant stop discards ("Recording too short").
- ffmpeg-missing → "Couldn't start the recorder" toast, no orphan windows.
- Recorder isolation: screenshots/editor/pin still work; `grep -r "recorder" glint/src-tauri/src/capture glint/src-tauri/src/editor` finds nothing.

- [ ] **Step 3: Roadmap**

In `docs/superpowers/ROADMAP.md`, add Phase 8 R1 under Shipped (*Built — awaiting at-screen*), noting R2 (audio) and R3 (webcam) are the next layers.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-8-RECORDER-R1-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p8): recorder R1 acceptance checklist + roadmap"
```

---

## Self-Review notes (author)

- **Spec coverage:** isolation (Task 1 module + Task 8 grep check), ffmpeg bundling+spawn (T2), capture+encode+stop+thumbnail+Library row (T3), control bar + countdown (T4), live region selector (T5), entry points + countdown timing (T6), Library recording card (T7), green gate + acceptance + roadmap (T8). Fixed defaults (30fps/H.264/yuv420p/faststart/Videos\Glint) in T1/T3. All covered.
- **Isolation honored:** `recorder/` only uses shared infra (`db`, `paths`, `image` via ffmpeg, shell plugin). `capture/`/`editor/` import nothing from it; the Library card change reads `item.kind` (shared schema), not recorder code.
- **Testability:** pure helpers are TDD'd (T1); the risky ffmpeg path is validated standalone (T2) and made at-screen testable via the tray BEFORE the UI (T3). Windowing/capture have no unit seam (Tauri+ffmpeg runtime) → at-screen acceptance (T8), consistent with prior phases.
- **Risk notes:** confirm the `tauri-plugin-shell` v2 sidecar/`CommandChild` API in T2/T3 (flagged inline). `ddagrab` is deferred to a possible enhancement; R1 ships `gdigrab`. Region px conversion (CSS→physical) is the fiddly bit in T5 — verify at-screen.
- **Type consistency:** `RecordTarget`, `normalize_region`, `recording_filename`, `build_ffmpeg_args`, `RecorderState`, `ActiveRecording`, commands `recorder_start|stop|cancel|status|open_region_selector|ffmpeg_check`, wrappers `recorderStartFullscreen|recorderStartRegion|recorderStop|recorderCancel|recorderStatus` — consistent across tasks.
