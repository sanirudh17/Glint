# Recording Trim / Quick-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable multi-cut **trim window** that cuts dead air / sections out of a finished recording (split + delete keep-regions) and exports a frame-accurate MP4, openable from the post-recording HUD and the Library.

**Architecture:** A new recorder-owned `recorder/trim.rs` module exposes probe/open/export commands; a normal decorated `rec-trim` window hosts a React `TrimView` that plays the file via Tauri's asset protocol and edits a pure timeline model. Export runs one ffmpeg `filter_complex` pass (trim + concat, re-encode). Audio presence is detected with a newly-bundled **ffprobe** sidecar.

**Tech Stack:** Tauri v2, Rust, React 19 + TypeScript, Vite, Vitest, the bundled ffmpeg/ffprobe sidecars (`tauri-plugin-shell`).

## Global Constraints

- **Local-only:** no cloud, upload, accounts, auth, or network calls. (verbatim project rule)
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*.rs` import **nothing** from `capture/`, `editor/`, or `overlay/`. `trim.rs` may use recorder-owned `ffmpeg`/`thumb` + `crate::db` only.
- **Recording ffmpeg path UNTOUCHED:** do not change `build_ffmpeg_args` or the gdigrab/recording flow. Trim is a separate pass.
- **Windows must build off the main thread:** any command that calls `WebviewWindowBuilder::build()` MUST be `#[tauri::command(async)]` (a sync build deadlocks WebView2). Close transient recorder windows with `destroy()` where teardown must be guaranteed.
- **Target triple:** sidecar binaries are named `<name>-x86_64-pc-windows-msvc.exe` in `src-tauri/binaries/`.
- **After editing a capability file:** force a recompile so the embedded ACL refreshes — `touch src-tauri/src/lib.rs && cargo build`.
- **Tauri footgun:** never `invoke()` after `getCurrentWindow().close()/destroy()` — the JS context is gone. Order invokes BEFORE teardown.

---

### Task 1: Cut-engine filtergraph builder (pure, TDD)

**Files:**
- Create: `glint/src-tauri/src/recorder/trim.rs`
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `pub mod trim;` near the other `pub mod` lines, ~line 6)

**Interfaces:**
- Produces: `pub fn build_trim_args(input: &str, output: &str, keep: &[(f64, f64)], has_audio: bool) -> Vec<String>` — full ffmpeg arg list (after the program name) for a single-pass trim+concat re-encode.

- [ ] **Step 1: Add the module declaration**

In `glint/src-tauri/src/recorder/mod.rs`, alongside the existing `pub mod ffmpeg;` line, add:

```rust
pub mod trim;
```

- [ ] **Step 2: Write the failing tests**

Create `glint/src-tauri/src/recorder/trim.rs`:

```rust
//! Recording trim / quick-edit. ISOLATED (recorder-owned): uses recorder `ffmpeg`/
//! `thumb` + `crate::db` only — nothing from capture/editor/overlay. A SEPARATE
//! ffmpeg pass from recording; the gdigrab capture path is untouched.

/// Build the ffmpeg args for a frame-accurate trim: trim each keep-region and
/// concat them in one re-encode pass. `keep` is a list of (start, end) seconds in
/// the source timeline (already validated: sorted, non-overlapping, in-bounds).
/// `has_audio` picks the audio-bearing graph.
pub fn build_trim_args(input: &str, output: &str, keep: &[(f64, f64)], has_audio: bool) -> Vec<String> {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_only_two_regions_concat() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 1.5), (3.0, 4.0)], false);
        let fc = "[0:v]trim=0:1.5,setpts=PTS-STARTPTS[v0];\
                  [0:v]trim=3:4,setpts=PTS-STARTPTS[v1];\
                  [v0][v1]concat=n=2:v=1:a=0[outv]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(!a.iter().any(|s| s == "-c:a"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert!(a.windows(2).any(|w| w[0] == "-movflags" && w[1] == "+faststart"));
        assert_eq!(a.last().unwrap(), "out.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-i" && w[1] == "in.mp4"));
    }

    #[test]
    fn video_audio_interleaves_streams() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 2.0), (5.0, 6.5)], true);
        let fc = "[0:v]trim=0:2,setpts=PTS-STARTPTS[v0];\
                  [0:a]atrim=0:2,asetpts=PTS-STARTPTS[a0];\
                  [0:v]trim=5:6.5,setpts=PTS-STARTPTS[v1];\
                  [0:a]atrim=5:6.5,asetpts=PTS-STARTPTS[a1];\
                  [v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outa]"));
        assert!(a.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(a.windows(2).any(|w| w[0] == "-b:a" && w[1] == "192k"));
    }

    #[test]
    fn single_region_uses_concat_n1() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(2.0, 8.0)], false);
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex"
            && w[1] == "[0:v]trim=2:8,setpts=PTS-STARTPTS[v0];[v0]concat=n=1:v=1:a=0[outv]"), "got {a:?}");
    }

    #[test]
    fn args_silence_stderr_and_progress() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 1.0)], false);
        assert!(a.iter().any(|s| s == "-nostats"));
        assert!(a.windows(2).any(|w| w[0] == "-loglevel" && w[1] == "error"));
        assert!(a.windows(2).any(|w| w[0] == "-progress" && w[1] == "pipe:1"));
        assert!(a.iter().any(|s| s == "-y"));
    }
}
```

- [ ] **Step 3: Run the tests — verify they fail**

Run: `cd glint/src-tauri && cargo test --lib trim:: 2>&1 | tail -20`
Expected: FAIL (`unimplemented!`/panics).

- [ ] **Step 4: Implement `build_trim_args`**

Replace the `unimplemented!()` body:

```rust
pub fn build_trim_args(input: &str, output: &str, keep: &[(f64, f64)], has_audio: bool) -> Vec<String> {
    // Format a number without a trailing ".0" (so 1.5 -> "1.5", 3.0 -> "3").
    fn num(n: f64) -> String {
        if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
    }
    let mut fc = String::new();
    for (i, (s, e)) in keep.iter().enumerate() {
        fc.push_str(&format!("[0:v]trim={}:{},setpts=PTS-STARTPTS[v{i}];", num(*s), num(*e)));
        if has_audio {
            fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS[a{i}];", num(*s), num(*e)));
        }
    }
    let n = keep.len();
    for i in 0..n {
        fc.push_str(&format!("[v{i}]"));
        if has_audio { fc.push_str(&format!("[a{i}]")); }
    }
    if has_audio {
        fc.push_str(&format!("concat=n={n}:v=1:a=1[outv][outa]"));
    } else {
        fc.push_str(&format!("concat=n={n}:v=1:a=0[outv]"));
    }

    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-progress".into(), "pipe:1".into(),
        "-i".into(), input.into(),
        "-filter_complex".into(), fc,
        "-map".into(), "[outv]".into(),
    ];
    if has_audio {
        a.extend(["-map".into(), "[outa]".into()]);
    }
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
    if has_audio {
        a.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    }
    a.extend(["-movflags".into(), "+faststart".into(), output.into()]);
    a
}
```

- [ ] **Step 5: Run the tests — verify they pass**

Run: `cd glint/src-tauri && cargo test --lib trim:: 2>&1 | tail -20`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p9): trim filtergraph builder (trim+concat single-pass)"
```

---

### Task 2: Probe parse, keep-region validation, output naming, no-op (pure, TDD)

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs`
- Test: same file's `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `#[derive(serde::Serialize, Clone)] pub struct ProbeResult { pub duration_secs: f64, pub has_audio: bool, pub fps: f64, pub width: u32, pub height: u32 }`
  - `pub fn parse_ffprobe_json(json: &str) -> Result<ProbeResult, String>`
  - `pub fn validate_keep(keep: &[(f64, f64)], duration: f64) -> Result<Vec<(f64, f64)>, String>`
  - `pub fn is_noop(keep: &[(f64, f64)], duration: f64) -> bool`
  - `pub fn trimmed_output_path(src: &std::path::Path) -> std::path::PathBuf`

- [ ] **Step 1: Write the failing tests**

Append inside `mod tests` in `trim.rs`:

```rust
    #[test]
    fn parses_ffprobe_streams_and_format() {
        let json = r#"{
          "streams": [
            {"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"30/1"},
            {"codec_type":"audio","sample_rate":"48000"}
          ],
          "format": {"duration":"12.500000"}
        }"#;
        let p = parse_ffprobe_json(json).unwrap();
        assert_eq!(p.width, 1920);
        assert_eq!(p.height, 1080);
        assert_eq!(p.has_audio, true);
        assert!((p.duration_secs - 12.5).abs() < 1e-6);
        assert!((p.fps - 30.0).abs() < 1e-6);
    }

    #[test]
    fn parses_video_only_no_audio() {
        let json = r#"{"streams":[{"codec_type":"video","width":1280,"height":720,"avg_frame_rate":"60/1"}],"format":{"duration":"3.0"}}"#;
        let p = parse_ffprobe_json(json).unwrap();
        assert_eq!(p.has_audio, false);
        assert!((p.fps - 60.0).abs() < 1e-6);
    }

    #[test]
    fn validate_sorts_and_rejects_overlap_and_oob() {
        // sorted + in-bounds OK
        assert_eq!(validate_keep(&[(3.0, 4.0), (0.0, 1.0)], 10.0).unwrap(), vec![(0.0, 1.0), (3.0, 4.0)]);
        // overlap rejected
        assert!(validate_keep(&[(0.0, 2.0), (1.0, 3.0)], 10.0).is_err());
        // out of bounds rejected
        assert!(validate_keep(&[(0.0, 11.0)], 10.0).is_err());
        // zero/negative length rejected
        assert!(validate_keep(&[(2.0, 2.0)], 10.0).is_err());
        // empty rejected
        assert!(validate_keep(&[], 10.0).is_err());
    }

    #[test]
    fn noop_when_single_full_span() {
        assert!(is_noop(&[(0.0, 10.0)], 10.0));
        assert!(is_noop(&[(0.0, 9.98)], 10.0)); // within tolerance of full
        assert!(!is_noop(&[(0.0, 5.0)], 10.0));
        assert!(!is_noop(&[(0.0, 4.0), (6.0, 10.0)], 10.0)); // a gap exists
    }

    #[test]
    fn trimmed_name_appends_suffix_and_counter() {
        use std::path::Path;
        // Base case appends " (trimmed)" before the extension.
        let p = trimmed_output_path(Path::new("C:/x/Glint 2026 at 10.00.00.mp4"));
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "Glint 2026 at 10.00.00 (trimmed).mp4");
    }
```

- [ ] **Step 2: Run — verify fail**

Run: `cd glint/src-tauri && cargo test --lib trim:: 2>&1 | tail -20`
Expected: FAIL (undefined functions).

- [ ] **Step 3: Implement the functions**

Add to `trim.rs` (above the tests module):

```rust
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, Clone)]
pub struct ProbeResult {
    pub duration_secs: f64,
    pub has_audio: bool,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
}

/// Parse `ffprobe -show_streams -show_format -of json` output.
pub fn parse_ffprobe_json(json: &str) -> Result<ProbeResult, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let streams = v.get("streams").and_then(|s| s.as_array()).ok_or("no streams")?;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 0.0f64;
    let mut has_audio = false;
    for s in streams {
        match s.get("codec_type").and_then(|c| c.as_str()) {
            Some("video") => {
                width = s.get("width").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                height = s.get("height").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                if let Some(r) = s.get("avg_frame_rate").and_then(|x| x.as_str()) {
                    if let Some((n, d)) = r.split_once('/') {
                        let n: f64 = n.parse().unwrap_or(0.0);
                        let d: f64 = d.parse().unwrap_or(0.0);
                        if d > 0.0 { fps = n / d; }
                    }
                }
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    let duration_secs = v.get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    Ok(ProbeResult { duration_secs, has_audio, fps, width, height })
}

/// Validate + sort keep-regions: non-empty, each (start < end), all within
/// [0, duration], and non-overlapping after sorting by start.
pub fn validate_keep(keep: &[(f64, f64)], duration: f64) -> Result<Vec<(f64, f64)>, String> {
    if keep.is_empty() {
        return Err("nothing to keep".into());
    }
    let mut v = keep.to_vec();
    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut prev_end = 0.0;
    for (i, (s, e)) in v.iter().enumerate() {
        if !(e > s) {
            return Err("empty keep-region".into());
        }
        if *s < -1e-6 || *e > duration + 1e-3 {
            return Err("keep-region out of bounds".into());
        }
        if i > 0 && *s < prev_end - 1e-6 {
            return Err("overlapping keep-regions".into());
        }
        prev_end = *e;
    }
    Ok(v)
}

/// True when the edit changes nothing: a single region spanning ~the whole file.
pub fn is_noop(keep: &[(f64, f64)], duration: f64) -> bool {
    keep.len() == 1 && keep[0].0 <= 1e-3 && keep[0].1 >= duration - 0.05
}

/// Derive `<name> (trimmed).mp4` next to the source; append a counter on collision.
pub fn trimmed_output_path(src: &Path) -> PathBuf {
    let dir = src.parent().unwrap_or_else(|| Path::new("."));
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = src.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "mp4".into());
    let mut candidate = dir.join(format!("{stem} (trimmed).{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} (trimmed {n}).{ext}"));
        n += 1;
    }
    candidate
}
```

Confirm `serde_json` is available: it is already a dependency (used elsewhere); if `cargo build` complains, add `serde_json = "1"` to `glint/src-tauri/Cargo.toml` `[dependencies]`.

- [ ] **Step 4: Run — verify pass**

Run: `cd glint/src-tauri && cargo test --lib trim:: 2>&1 | tail -20`
Expected: PASS (all trim tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs
git commit -m "feat(p9): trim probe-parse, keep validation, naming, no-op (TDD)"
```

---

### Task 3: ffprobe sidecar + asset protocol config + `recorder_trim_probe` command

**Files:**
- Modify: `glint/src-tauri/tauri.conf.json` (externalBin + `app.security.assetProtocol`)
- Create: `glint/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe` (copied binary)
- Modify: `glint/src-tauri/src/recorder/trim.rs` (add `recorder_trim_probe` command)
- Modify: `glint/src-tauri/src/lib.rs` (register the command in the invoke handler)

**Interfaces:**
- Consumes: `parse_ffprobe_json` (Task 2).
- Produces: `#[tauri::command(async)] pub async fn recorder_trim_probe(app: tauri::AppHandle, path: String) -> Result<ProbeResult, String>`

- [ ] **Step 1: Place the ffprobe sidecar binary**

Run (copies the user's ffprobe to the sidecar name/location):

```bash
cp "/c/tools/ffmpeg/ffmpeg-8.1.1-essentials_build/bin/ffprobe.exe" \
   "C:/Users/sanir/Claude Code/glint/src-tauri/binaries/ffprobe-x86_64-pc-windows-msvc.exe"
ls -la "C:/Users/sanir/Claude Code/glint/src-tauri/binaries/"
```
Expected: both `ffmpeg-…msvc.exe` and `ffprobe-…msvc.exe` present.

- [ ] **Step 2: Register the sidecar + asset protocol in `tauri.conf.json`**

Change `externalBin`:

```json
    "externalBin": ["binaries/ffmpeg", "binaries/ffprobe"]
```

Replace the `app.security` block (enable the asset protocol scoped to the recordings folder; `$VIDEO` is Tauri's Videos dir token):

```json
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["$VIDEO/Glint/**"]
      }
    }
```

- [ ] **Step 3: Add the probe command in `trim.rs`**

Add (uses the shell sidecar like `recorder/mod.rs` does):

```rust
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command(async)]
pub async fn recorder_trim_probe(app: tauri::AppHandle, path: String) -> Result<ProbeResult, String> {
    let sidecar = app.shell().sidecar("ffprobe").map_err(|e| format!("ffprobe resolve: {e}"))?;
    let out = sidecar
        .args([
            "-v", "error",
            "-show_streams", "-show_format",
            "-of", "json",
            &path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe run: {e}"))?;
    if !out.status.success() {
        return Err(format!("ffprobe exited {:?}", out.status.code()));
    }
    let json = String::from_utf8_lossy(&out.stdout);
    parse_ffprobe_json(&json)
}
```

(The unused `Manager` import is for later tasks in this file; if `cargo` warns now, omit it until Task 4.)

- [ ] **Step 4: Register the command**

In `glint/src-tauri/src/lib.rs`, find the `tauri::generate_handler![` macro list and add to it:

```rust
            crate::recorder::trim::recorder_trim_probe,
```

- [ ] **Step 5: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -15`
Expected: clean compile (the sidecar + new command resolve).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/tauri.conf.json glint/src-tauri/src/recorder/trim.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p9): ffprobe sidecar + asset protocol + recorder_trim_probe"
```

(The binary in `binaries/` is git-ignored like the ffmpeg sidecar — confirm with `git status`; do not force-add it.)

---

### Task 4: Trim window + target state + open/target commands + route + minimal player (at-screen gate)

**Files:**
- Modify: `glint/src-tauri/src/recorder/windows.rs` (add `TRIM_LABEL`, `build_trim_window`, `close_trim_window`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `RecorderTrimState`, `TrimTarget`, `recorder_open_trim`, `recorder_trim_target`)
- Modify: `glint/src-tauri/src/lib.rs` (`.manage(RecorderTrimState(...))` + register two commands)
- Modify: `glint/src-tauri/capabilities/recorder.json` (add `core:window:allow-set-focus`)
- Create: `glint/src/lib/trim.ts`
- Create: `glint/src/recorder/TrimView.tsx`
- Create: `glint/src/recorder/trim.css`
- Modify: `glint/src/router.tsx` (add `#/rec-trim` route)

**Interfaces:**
- Consumes: `recorder_trim_probe` (Task 3).
- Produces:
  - Rust: `pub const TRIM_LABEL: &str = "rec-trim";`, `pub fn build_trim_window(app: &AppHandle) -> tauri::Result<()>`, `pub fn close_trim_window(app: &AppHandle)`; `#[tauri::command(async)] pub async fn recorder_open_trim(app, id: i64, path: String) -> Result<(), String>`; `#[tauri::command] pub fn recorder_trim_target(app) -> Option<TrimTargetDto>` where `TrimTargetDto { id: i64, path: String }`.
  - TS: `lib/trim.ts` exporting `type ProbeResult`, `type TrimTarget`, `trimProbe(path)`, `trimTarget()`, `openTrim(id, path)`.

- [ ] **Step 1: Window builders in `windows.rs`**

Append:

```rust
pub const TRIM_LABEL: &str = "rec-trim";

/// The trim / quick-edit window: a NORMAL decorated, focused, resizable app window
/// (unlike the transparent recorder overlays). Built off the main thread (async
/// command) per the window-build rule. Single instance — focus if already open.
pub fn build_trim_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(TRIM_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, TRIM_LABEL, WebviewUrl::App("index.html#/rec-trim".into()))
        .title("Glint — Trim Recording")
        .decorations(true)
        .resizable(true)
        .inner_size(900.0, 600.0)
        .min_inner_size(640.0, 460.0)
        .center()
        .visible(true)
        .build()?;
    let _ = win.set_focus();
    Ok(())
}

/// Close the trim window if open.
pub fn close_trim_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(TRIM_LABEL) {
        let _ = w.close();
    }
}
```

- [ ] **Step 2: State + commands in `mod.rs`**

Near the other state structs in `mod.rs`, add:

```rust
/// The recording the trim window is editing. Set by `recorder_open_trim` before the
/// window builds; the window reads it back via `recorder_trim_target`.
#[derive(Clone)]
pub struct TrimTarget { pub id: i64, pub path: String }

#[derive(Default)]
pub struct RecorderTrimState(pub std::sync::Mutex<Option<TrimTarget>>);

#[derive(serde::Serialize)]
pub struct TrimTargetDto { pub id: i64, pub path: String }
```

Add the commands (place near `recorder_open_region_selector`):

```rust
/// Open the trim window for a recording (from the HUD or Library). Single instance:
/// if one is already open, focus it and toast rather than retargeting.
#[tauri::command(async)]
pub async fn recorder_open_trim(app: tauri::AppHandle, id: i64, path: String) -> Result<(), String> {
    if app.get_webview_window(windows::TRIM_LABEL).is_some() {
        let _ = windows::build_trim_window(&app); // focuses existing
        let _ = app.emit("glint-toast", "Close the current trim first");
        return Ok(());
    }
    *app.state::<RecorderTrimState>().0.lock().unwrap() = Some(TrimTarget { id, path });
    windows::build_trim_window(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recorder_trim_target(app: tauri::AppHandle) -> Option<TrimTargetDto> {
    app.state::<RecorderTrimState>().0.lock().unwrap()
        .as_ref()
        .map(|t| TrimTargetDto { id: t.id, path: t.path.clone() })
}
```

- [ ] **Step 3: Register state + commands in `lib.rs`**

Add `.manage(crate::recorder::RecorderTrimState::default())` alongside the other `.manage(...)` calls, and add to `generate_handler!`:

```rust
            crate::recorder::recorder_open_trim,
            crate::recorder::recorder_trim_target,
```

- [ ] **Step 4: Capability — allow set-focus for recorder windows**

In `glint/src-tauri/capabilities/recorder.json`, add `"core:window:allow-set-focus"` to the `permissions` array. Then force the ACL recompile:

```bash
touch "C:/Users/sanir/Claude Code/glint/src-tauri/src/lib.rs"
cd "C:/Users/sanir/Claude Code/glint/src-tauri" && cargo build 2>&1 | tail -8
```
Expected: clean build.

- [ ] **Step 5: Frontend lib `glint/src/lib/trim.ts`**

```ts
/** trim.ts — typed wrappers for the recording-trim Rust commands. */
import { invoke } from "@tauri-apps/api/core";

export interface ProbeResult {
  duration_secs: number;
  has_audio: boolean;
  fps: number;
  width: number;
  height: number;
}
export interface TrimTarget { id: number; path: string }

export const trimTarget = (): Promise<TrimTarget | null> =>
  invoke<TrimTarget | null>("recorder_trim_target");
export const trimProbe = (path: string): Promise<ProbeResult> =>
  invoke<ProbeResult>("recorder_trim_probe", { path });
export const openTrim = (id: number, path: string): Promise<void> =>
  invoke<void>("recorder_open_trim", { id, path });
```

- [ ] **Step 6: Minimal `TrimView.tsx` (proves asset protocol + probe)**

Create `glint/src/recorder/TrimView.tsx`:

```tsx
/** TrimView.tsx — recording trim window (#/rec-trim). Minimal player first. */
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { trimTarget, trimProbe, type ProbeResult } from "../lib/trim";
import "./trim.css";

export function TrimView() {
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    trimTarget()
      .then(async (t) => {
        if (!t) { setErr("No recording to trim."); return; }
        setSrc(convertFileSrc(t.path));
        try { setProbe(await trimProbe(t.path)); }
        catch { setErr("Couldn't read the recording."); }
      })
      .catch(() => setErr("Couldn't open the recording."));
  }, []);

  return (
    <div className="trim-root">
      {err && <div className="trim-error">{err}</div>}
      {src && <video className="trim-video" src={src} controls autoPlay />}
      {probe && (
        <div className="trim-meta">
          {probe.width}×{probe.height} · {probe.duration_secs.toFixed(2)}s ·
          {probe.has_audio ? " audio" : " no audio"} · {probe.fps.toFixed(0)} fps
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Styles `glint/src/recorder/trim.css`**

```css
.trim-root { display: flex; flex-direction: column; height: 100vh; background: #0c0c10; color: #e8e8ee; font: 13px system-ui, sans-serif; }
.trim-video { flex: 1; min-height: 0; width: 100%; background: #000; object-fit: contain; }
.trim-meta { padding: 8px 12px; opacity: 0.8; }
.trim-error { padding: 16px; color: #ff8585; }
```

- [ ] **Step 8: Route in `glint/src/router.tsx`**

Add the import and route entry (mirror the existing `#/rec-hud` entry):

```tsx
import { TrimView } from "./recorder/TrimView";
// …in the createHashRouter array:
  { path: "/rec-trim", element: <TrimView /> },
```

- [ ] **Step 9: Build + typecheck**

Run: `cd glint && npx tsc --noEmit 2>&1 | tail -8 && cd src-tauri && cargo build 2>&1 | tail -8`
Expected: both clean.

- [ ] **Step 10: AT-SCREEN GATE (manual)**

Run `npm run tauri dev`. Record a short clip (or use an existing one), then from a dev trigger call `openTrim(id, path)` — simplest: temporarily add a button in `RecHud` or call via the Library in Task 8. For now verify by invoking from the devtools console of any window: `window.__TAURI__.core.invoke('recorder_open_trim', { id: <a real recording id>, path: '<full mp4 path>' })`.
Expected: the **rec-trim window opens and the video plays with seeking** (asset protocol works), and the meta line shows correct dimensions/duration/audio/fps. If the video is black or blocked, fix the asset-protocol scope / capability before continuing (this is the runtime gate for the whole feature).

- [ ] **Step 11: Commit**

```bash
git add glint/src-tauri/src/recorder/windows.rs glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs glint/src-tauri/capabilities/recorder.json glint/src/lib/trim.ts glint/src/recorder/TrimView.tsx glint/src/recorder/trim.css glint/src/router.tsx
git commit -m "feat(p9): trim window + target state + minimal asset-protocol player"
```

---

### Task 5: Timeline model (pure, Vitest TDD)

**Files:**
- Create: `glint/src/recorder/trimModel.ts`
- Test: `glint/src/recorder/trimModel.test.ts`

**Interfaces:**
- Produces:
  - `export type Clip = { id: number; start: number; end: number; kept: boolean }`
  - `export function initClips(duration: number): Clip[]`
  - `export function splitClips(clips: Clip[], t: number): Clip[]`
  - `export function setKept(clips: Clip[], id: number, kept: boolean): Clip[]`
  - `export function keepRanges(clips: Clip[]): [number, number][]`
  - `export function keptCount(clips: Clip[]): number`

- [ ] **Step 1: Write the failing tests**

Create `glint/src/recorder/trimModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initClips, splitClips, setKept, keepRanges, keptCount } from "./trimModel";

describe("trimModel", () => {
  it("starts as one kept clip spanning the whole duration", () => {
    const c = initClips(10);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ start: 0, end: 10, kept: true });
    expect(keepRanges(c)).toEqual([[0, 10]]);
  });

  it("splits the clip under the playhead in two", () => {
    const c = splitClips(initClips(10), 4);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ start: 0, end: 4 });
    expect(c[1]).toMatchObject({ start: 4, end: 10 });
    expect(c.every((x) => x.kept)).toBe(true);
  });

  it("ignores a split exactly on a boundary (no zero-width clips)", () => {
    const once = splitClips(initClips(10), 4);
    expect(splitClips(once, 4)).toHaveLength(2);
    expect(splitClips(once, 0)).toHaveLength(2);
    expect(splitClips(once, 10)).toHaveLength(2);
  });

  it("delete (setKept false) drops a clip from the keep-ranges, merging neighbours", () => {
    let c = splitClips(initClips(10), 3); // [0-3][3-10]
    c = splitClips(c, 6);                 // [0-3][3-6][6-10]
    const mid = c[1].id;
    c = setKept(c, mid, false);
    expect(keepRanges(c)).toEqual([[0, 3], [6, 10]]);
    expect(keptCount(c)).toBe(2);
  });

  it("merges adjacent kept clips into one range", () => {
    let c = splitClips(initClips(10), 5); // [0-5][5-10], both kept
    expect(keepRanges(c)).toEqual([[0, 10]]);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts 2>&1 | tail -15`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `trimModel.ts`**

```ts
/** trimModel.ts — pure timeline model for the trim window. Clips partition the
 *  original [0, duration]; kept clips (in order) form the output. */
export type Clip = { id: number; start: number; end: number; kept: boolean };

let nextId = 1;
const mk = (start: number, end: number, kept: boolean): Clip => ({ id: nextId++, start, end, kept });

const EPS = 1e-4;

export function initClips(duration: number): Clip[] {
  return [mk(0, Math.max(0, duration), true)];
}

/** Split the clip containing time `t` into two at `t`. No-op on a boundary/outside. */
export function splitClips(clips: Clip[], t: number): Clip[] {
  const out: Clip[] = [];
  let didSplit = false;
  for (const c of clips) {
    if (!didSplit && t > c.start + EPS && t < c.end - EPS) {
      out.push(mk(c.start, t, c.kept));
      out.push(mk(t, c.end, c.kept));
      didSplit = true;
    } else {
      out.push(c);
    }
  }
  return out;
}

/** Set a clip's kept flag (delete = false, restore = true). */
export function setKept(clips: Clip[], id: number, kept: boolean): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, kept } : c));
}

/** Ordered kept spans, with adjacent kept clips merged into one range. */
export function keepRanges(clips: Clip[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const c of clips) {
    if (!c.kept) continue;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last[1] - c.start) < EPS) last[1] = c.end;
    else ranges.push([c.start, c.end]);
  }
  return ranges;
}

export function keptCount(clips: Clip[]): number {
  return clips.filter((c) => c.kept).length;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd glint && npx vitest run src/recorder/trimModel.test.ts 2>&1 | tail -15`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/trimModel.ts glint/src/recorder/trimModel.test.ts
git commit -m "feat(p9): pure timeline model (split/delete/keep-ranges) TDD"
```

---

### Task 6: Export command — `recorder_trim_export` (filtergraph + sidecar + progress + save modes)

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs` (add `recorder_trim_export`)
- Modify: `glint/src-tauri/src/lib.rs` (register command)
- Modify: `glint/src/lib/trim.ts` (add `trimExport`)

**Interfaces:**
- Consumes: `build_trim_args`, `validate_keep`, `trimmed_output_path` (Tasks 1–2); `recorder::thumb::extract_thumb`; `crate::db::{NewCapture, insert_capture}` + a row-update helper.
- Produces: `#[tauri::command(async)] pub async fn recorder_trim_export(app, id: i64, src_path: String, keep: Vec<(f64, f64)>, has_audio: bool, duration: f64, mode: String) -> Result<(), String>`; TS `trimExport(...)`.

- [ ] **Step 1: Confirm DB shape (already verified)**

The schema is `captures(id, kind, path, thumb_path, width, height, bytes, created_at)` in
`glint/src-tauri/src/db/mod.rs`; `NewCapture` + `insert_capture` are there (used at
`recorder/mod.rs:763`). No change needed here — proceed to add the update helper.

- [ ] **Step 2: Add the row-update helper in `glint/src-tauri/src/db/mod.rs`**

Append (column names match the verified schema):

```rust
/// Update a capture row's file-derived fields after an in-place edit (trim overwrite).
pub fn update_capture_file(conn: &rusqlite::Connection, id: i64, bytes: i64, thumb_path: Option<&str>, width: Option<i64>, height: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE captures SET bytes = ?1, thumb_path = ?2, width = ?3, height = ?4 WHERE id = ?5",
        rusqlite::params![bytes, thumb_path, width, height, id],
    )?;
    Ok(())
}
```

- [ ] **Step 3: Implement `recorder_trim_export` in `trim.rs`**

```rust
use tauri::Emitter;
use tauri_plugin_shell::process::CommandEvent;

#[tauri::command(async)]
pub async fn recorder_trim_export(
    app: tauri::AppHandle,
    id: i64,
    src_path: String,
    keep: Vec<(f64, f64)>,
    has_audio: bool,
    duration: f64,
    mode: String,
) -> Result<(), String> {
    let keep = validate_keep(&keep, duration)?;
    if is_noop(&keep, duration) {
        return Err("no changes to save".into());
    }
    let total_kept: f64 = keep.iter().map(|(s, e)| e - s).sum();

    let src = std::path::PathBuf::from(&src_path);
    let final_path = if mode == "overwrite" {
        src.clone()
    } else {
        trimmed_output_path(&src)
    };
    // Always encode to a temp file first; commit only on success.
    let tmp = src.with_extension("trimtmp.mp4");
    let tmp_str = tmp.to_string_lossy().to_string();

    let args = build_trim_args(&src_path, &tmp_str, &keep, has_audio);
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("ffmpeg resolve: {e}"))?;
    let (mut rx, _child) = sidecar.args(args).spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;

    // Drain progress events (the capacity-1 channel must be read continuously here).
    while let Some(ev) = rx.recv().await {
        if let CommandEvent::Stdout(line) = ev {
            let line = String::from_utf8_lossy(&line);
            for kv in line.split_whitespace() {
                if let Some(us) = kv.strip_prefix("out_time_us=") {
                    if let Ok(us) = us.parse::<f64>() {
                        let pct = ((us / 1_000_000.0) / total_kept.max(0.001) * 100.0).clamp(0.0, 100.0);
                        let _ = app.emit_to(windows::TRIM_LABEL, "rec-trim-progress", pct);
                    }
                }
            }
        }
    }

    let ok = std::fs::metadata(&tmp).map(|m| m.len() > 1024).unwrap_or(false);
    if !ok {
        let _ = std::fs::remove_file(&tmp);
        let _ = app.emit("glint-toast", "Trim failed");
        return Err("trim produced no output".into());
    }

    // Commit: move temp into place (overwrite replaces the original).
    if final_path.exists() && mode == "overwrite" {
        let _ = std::fs::remove_file(&final_path);
    }
    std::fs::rename(&tmp, &final_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        let _ = app.emit("glint-toast", "Trim failed");
        e.to_string()
    })?;

    let final_str = final_path.to_string_lossy().to_string();
    let thumb = crate::recorder::thumb::extract_thumb(&app, &final_str).await;
    let bytes = std::fs::metadata(&final_str).map(|m| m.len() as i64).unwrap_or(0);

    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        if mode == "overwrite" {
            let _ = crate::db::update_capture_file(&conn, id, bytes, thumb.as_deref(), None, None);
        } else {
            let row = crate::db::NewCapture {
                kind: "recording".into(),
                path: final_str.clone(),
                thumb_path: thumb.clone(),
                width: None,
                height: None,
                bytes: Some(bytes),
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64).unwrap_or(0),
            };
            let _ = crate::db::insert_capture(&conn, &row);
        }
    }
    let _ = app.emit("capture-saved", ());
    let _ = app.emit("glint-toast", if mode == "overwrite" { "Recording trimmed" } else { "Trimmed copy saved" });
    windows::close_trim_window(&app);
    Ok(())
}
```

Add `use crate::recorder::windows;` at the top of `trim.rs` if not already imported (or reference `crate::recorder::windows::TRIM_LABEL` inline).

- [ ] **Step 4: Register the command in `lib.rs`**

```rust
            crate::recorder::trim::recorder_trim_export,
```

- [ ] **Step 5: Add `trimExport` to `glint/src/lib/trim.ts`**

```ts
export const trimExport = (
  id: number, srcPath: string, keep: [number, number][], hasAudio: boolean, duration: number, mode: "copy" | "overwrite",
): Promise<void> =>
  invoke<void>("recorder_trim_export", { id, srcPath, keep, hasAudio, duration, mode });
```

- [ ] **Step 6: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -15 && cargo test --lib trim:: 2>&1 | tail -5`
Expected: clean build; trim unit tests still pass.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs glint/src-tauri/src/db/mod.rs glint/src-tauri/src/lib.rs glint/src/lib/trim.ts
git commit -m "feat(p9): recorder_trim_export (single-pass cut, temp-then-commit, copy/overwrite)"
```

---

### Task 7: Full TrimView + TrimTimeline UI (model + transport + gap-skip + save) (at-screen)

**Files:**
- Create: `glint/src/recorder/TrimTimeline.tsx`
- Modify: `glint/src/recorder/TrimView.tsx` (replace minimal player with the full editor)
- Modify: `glint/src/recorder/trim.css` (timeline styles)

**Interfaces:**
- Consumes: `trimModel.ts` (Task 5); `lib/trim.ts` `trimExport` (Task 6); `rec-trim-progress` event (Task 6).

- [ ] **Step 1: TrimTimeline component**

Create `glint/src/recorder/TrimTimeline.tsx`:

```tsx
/** TrimTimeline.tsx — the track of keep/gap clips + playhead. Pure presentational;
 *  state lives in TrimView. Click a clip to select; click the ruler to seek. */
import type { Clip } from "./trimModel";

export function TrimTimeline({
  clips, duration, playhead, selectedId, onSelect, onSeek,
}: {
  clips: Clip[]; duration: number; playhead: number;
  selectedId: number | null; onSelect: (id: number) => void; onSeek: (t: number) => void;
}) {
  const pct = (t: number) => `${(t / Math.max(duration, 0.001)) * 100}%`;
  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };
  return (
    <div className="trim-track" onPointerDown={seekFromEvent}>
      {clips.map((c) => (
        <div
          key={c.id}
          className={`trim-clip${c.kept ? "" : " trim-clip--gap"}${c.id === selectedId ? " trim-clip--sel" : ""}`}
          style={{ left: pct(c.start), width: pct(c.end - c.start) }}
          onPointerDown={(e) => { e.stopPropagation(); if (c.kept) onSelect(c.id); }}
          title={c.kept ? "Click to select · Del to remove" : "Removed"}
        />
      ))}
      <div className="trim-playhead" style={{ left: pct(playhead) }} />
    </div>
  );
}
```

- [ ] **Step 2: Full TrimView**

Replace `glint/src/recorder/TrimView.tsx` with:

```tsx
/** TrimView.tsx — recording trim window (#/rec-trim): player + multi-cut timeline. */
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Scissors, Trash2, Undo2, Play, Pause } from "lucide-react";
import { trimTarget, trimProbe, trimExport, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, keepRanges, keptCount, type Clip } from "./trimModel";
import { TrimTimeline } from "./TrimTimeline";
import "./trim.css";

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export function TrimView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [target, setTarget] = useState<{ id: number; path: string } | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [history, setHistory] = useState<Clip[][]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null); // percent or null

  const duration = probe?.duration_secs ?? 0;
  const fps = probe?.fps && probe.fps > 0 ? probe.fps : 30;
  const ranges = keepRanges(clips);
  const outDur = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05;
  const canSave = clips.length > 0 && keptCount(clips) > 0 && !noop && exporting === null;

  useEffect(() => {
    trimTarget().then(async (t) => {
      if (!t) { setErr("No recording to trim."); return; }
      setTarget(t);
      setSrc(convertFileSrc(t.path));
      try {
        const p = await trimProbe(t.path);
        setProbe(p);
        setClips(initClips(p.duration_secs));
      } catch { setErr("Couldn't read the recording."); }
    }).catch(() => setErr("Couldn't open the recording."));
  }, []);

  useEffect(() => {
    const un = listen<number>("rec-trim-progress", (e) => setExporting(Math.round(e.payload)));
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  const pushHistory = useCallback(() => setHistory((h) => [...h, clips]), [clips]);
  const doSplit = useCallback(() => { pushHistory(); setClips((c) => splitClips(c, playhead)); }, [pushHistory, playhead]);
  const doDelete = useCallback(() => {
    if (selectedId == null) return;
    if (keptCount(clips) <= 1) return; // can't delete the last block
    pushHistory(); setClips((c) => setKept(c, selectedId, false)); setSelectedId(null);
  }, [selectedId, clips, pushHistory]);
  const doUndo = useCallback(() => {
    setHistory((h) => { if (!h.length) return h; setClips(h[h.length - 1]); return h.slice(0, -1); });
  }, []);

  // Gap-skipping playback: while playing, jump the playhead past removed regions.
  const onTimeUpdate = () => {
    const v = videoRef.current; if (!v) return;
    let t = v.currentTime;
    if (playing) {
      const inKept = ranges.some(([s, e]) => t >= s - 0.02 && t < e);
      if (!inKept) {
        const next = ranges.find(([s]) => s > t);
        if (next) { v.currentTime = next[0]; t = next[0]; }
        else { v.pause(); }
      }
    }
    setPlayhead(t);
  };

  const seek = (t: number) => { const v = videoRef.current; if (v) { v.currentTime = Math.max(0, Math.min(t, duration)); setPlayhead(v.currentTime); } };
  const togglePlay = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === "s") { e.preventDefault(); doSplit(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(playhead - 1 / fps); }
      else if (e.key === "ArrowRight") { e.preventDefault(); seek(playhead + 1 / fps); }
      else if (e.key === "Escape") { getCurrentWindow().close().catch(() => {}); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSplit, doDelete, doUndo, playhead, fps]);

  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0);
    trimExport(target.id, target.path, ranges, probe.has_audio, duration, mode)
      .catch(() => setExporting(null)); // a toast already surfaced; window stays open
  };

  if (err) return <div className="trim-root"><div className="trim-error">{err}</div></div>;

  return (
    <div className="trim-root">
      {src && (
        <video
          ref={videoRef}
          className="trim-video"
          src={src}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}

      <div className="trim-transport">
        <button className="trim-iconbtn" onClick={togglePlay} title="Play/Pause (Space)">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="trim-time">{fmt(playhead)} / {fmt(duration)}</span>
        <span className="trim-spacer" />
        <button className="trim-iconbtn" onClick={doSplit} title="Split at playhead (S)"><Scissors size={16} /></button>
        <button className="trim-iconbtn" onClick={doDelete} disabled={selectedId == null || keptCount(clips) <= 1} title="Remove selected (Del)"><Trash2 size={16} /></button>
        <button className="trim-iconbtn" onClick={doUndo} disabled={!history.length} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
      </div>

      {probe && (
        <TrimTimeline
          clips={clips} duration={duration} playhead={playhead}
          selectedId={selectedId} onSelect={setSelectedId} onSeek={seek}
        />
      )}

      <div className="trim-actions">
        <span className="trim-out">Output: {fmt(outDur)} / {fmt(duration)}</span>
        <span className="trim-spacer" />
        {exporting !== null ? (
          <div className="trim-progress"><div className="trim-progress-fill" style={{ width: `${exporting}%` }} /><span>Exporting… {exporting}%</span></div>
        ) : (
          <>
            <button className="trim-btn" onClick={() => getCurrentWindow().close()}>Cancel</button>
            <button className="trim-btn" disabled={!canSave} onClick={() => save("overwrite")}>Overwrite</button>
            <button className="trim-btn trim-btn--primary" disabled={!canSave} onClick={() => save("copy")}>Save copy</button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Timeline styles — append to `trim.css`**

```css
.trim-transport, .trim-actions { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.trim-spacer { flex: 1; }
.trim-time, .trim-out { opacity: 0.85; font-variant-numeric: tabular-nums; }
.trim-iconbtn, .trim-btn { background: #1b1d27; color: #e8e8ee; border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; padding: 6px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.trim-iconbtn:disabled, .trim-btn:disabled { opacity: 0.4; cursor: default; }
.trim-btn--primary { background: #5b7cfa; border-color: #5b7cfa; }
.trim-track { position: relative; height: 56px; margin: 0 12px 4px; background: #14151c; border-radius: 8px; overflow: hidden; cursor: pointer; }
.trim-clip { position: absolute; top: 6px; bottom: 6px; background: #2f3a6b; border: 1px solid #5b7cfa; border-radius: 5px; box-sizing: border-box; }
.trim-clip--gap { background: repeating-linear-gradient(45deg, #1a1b22, #1a1b22 6px, #15161c 6px, #15161c 12px); border-color: rgba(255,255,255,0.08); }
.trim-clip--sel { outline: 2px solid #9db2ff; }
.trim-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ff5d5d; pointer-events: none; }
.trim-progress { position: relative; flex: 1; height: 26px; background: #14151c; border-radius: 7px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.trim-progress-fill { position: absolute; left: 0; top: 0; bottom: 0; background: #5b7cfa55; }
.trim-progress span { position: relative; font-size: 12px; }
```

- [ ] **Step 4: Typecheck + build**

Run: `cd glint && npx tsc --noEmit 2>&1 | tail -10 && npx vitest run 2>&1 | tail -5`
Expected: tsc clean; all vitest pass.

- [ ] **Step 5: AT-SCREEN GATE (manual)**

`npm run tauri dev`, open a recording in the trim window (Task 8 wires the entry points; until then trigger via console as in Task 4 Step 10). Verify: play/pause, scrub by clicking the track, **S splits** at the playhead, selecting a block + **Del removes** it (becomes a hatched gap), **playback skips the gap**, **Ctrl+Z undoes**, the Output readout updates, Save buttons disable on a no-op. Then **Save copy** → progress bar → window closes → a new `(trimmed)` clip appears in the Library; redo with **Overwrite** on a throwaway clip.

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/TrimView.tsx glint/src/recorder/TrimTimeline.tsx glint/src/recorder/trim.css
git commit -m "feat(p9): full trim UI — timeline, gap-skip playback, save copy/overwrite"
```

---

### Task 8: Entry points — HUD Trim button + Library Trim action

**Files:**
- Modify: `glint/src/recorder/RecHud.tsx` (add a Trim action)
- Modify: `glint/src/views/library/CaptureCard.tsx` (add a Trim action on recording rows)

**Interfaces:**
- Consumes: `openTrim(id, path)` from `lib/trim.ts` (Task 4).

- [ ] **Step 1: HUD Trim button**

In `glint/src/recorder/RecHud.tsx`, import the helper and add a toolbar button. At the top:

```tsx
import { openTrim } from "../lib/trim";
import { Scissors } from "lucide-react";
```
In the `.hud-toolbar` block (next to Open/Reveal/Copy), add as the first button:

```tsx
          <button className="hud-btn" title="Trim" aria-label="Trim" onPointerDown={(e) => e.stopPropagation()} onClick={() => data && openTrim(data.id, data.path)}>
            <Scissors size={16} strokeWidth={1.75} />
          </button>
```

- [ ] **Step 2: Library Trim action**

`CaptureCard.tsx` already has an `isRecording` branch rendering `cap-btn` actions
(Open/Reveal/Copy/Delete) and an `act(fn)` error-surfacing helper; `item.id` and
`item.path` are on the `CaptureItem`. Add the imports at the top:

```tsx
import { Scissors } from "lucide-react";
import { openTrim } from "../../lib/trim";
```

In the `isRecording` branch, add a Trim button right after the **Reveal** button (before
Copy):

```tsx
            <button className="cap-btn" aria-label="Trim" title="Trim" onClick={() => act(() => openTrim(item.id, item.path))}>
              <Scissors size={15} strokeWidth={1.75} />
            </button>
```

(Add `Scissors` to the existing `lucide-react` import line rather than a duplicate import
if you prefer.) The screenshot branch is left unchanged, so only recordings get Trim.

- [ ] **Step 3: Typecheck + build**

Run: `cd glint && npx tsc --noEmit 2>&1 | tail -8`
Expected: clean.

- [ ] **Step 4: AT-SCREEN GATE (manual)**

`npm run tauri dev`: after a recording, click **Trim** on the HUD → trim window opens for that clip. In the Library, a recording row's **Trim** action opens the same window. A screenshot row shows **no** Trim action.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/RecHud.tsx glint/src/views/library/CaptureCard.tsx
git commit -m "feat(p9): Trim entry points on the HUD and Library recording rows"
```

---

### Task 9: Acceptance doc + roadmap

**Files:**
- Create: `docs/superpowers/PHASE-9-RECORDING-TRIM-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md` (add Phase 9 under Shipped, clear the Planned "TBD")

- [ ] **Step 1: Write the acceptance checklist**

Create `docs/superpowers/PHASE-9-RECORDING-TRIM-ACCEPTANCE.md` with: automated gate (cargo test count, vitest count, tsc/vite clean), the hard gates (recorder isolation grep clean; `build_ffmpeg_args`/gdigrab unchanged in `git diff`), and the at-screen checklist (open from HUD + Library; play/scrub; split/delete/undo; gap-skip playback; frame-step; no-op disables Save; Save copy → new Library row, un-corrupted playback; Overwrite → in-place + refreshed thumb; failure leaves original intact; single-instance focus; video-only AND video+audio recordings both trim correctly).

- [ ] **Step 2: Update the roadmap**

In `docs/superpowers/ROADMAP.md`, add under `## Shipped` a `Phase 9 — Recording Trim / Quick-Edit` bullet summarizing the feature, and replace the `## Planned` `_(Next phase TBD.)_` line appropriately.

- [ ] **Step 3: Full green gate**

Run:
```bash
cd glint/src-tauri && cargo test --lib 2>&1 | tail -3
cd ../ && npx tsc --noEmit 2>&1 | tail -3 && npx vitest run 2>&1 | tail -3 && npx vite build 2>&1 | tail -3
grep -rnE "crate::(capture|editor|overlay)" src-tauri/src/recorder || echo "isolation clean"
```
Expected: cargo green, vitest green, tsc/vite clean, isolation clean.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-9-RECORDING-TRIM-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p9): recording-trim acceptance checklist + roadmap"
```

---

## Self-Review notes (for the implementer)

- **Isolation:** `trim.rs` must import only `crate::recorder::{ffmpeg, thumb, windows}` + `crate::db` + `crate::Db` + tauri/shell/serde. If you reach for anything in `capture/`/`editor/`/`overlay/`, stop — re-route through an event or a recorder-owned helper.
- **Window-build threading:** `recorder_open_trim` is `#[tauri::command(async)]` because it builds a window. Do not make it sync.
- **Probe before export:** the UI passes `has_audio`/`duration` from the probe into `trimExport`; the backend re-`validate_keep`s defensively.
- **DB column names:** verified — `captures(id, kind, path, thumb_path, width, height, bytes, created_at)` in `src-tauri/src/db/mod.rs`; Task 6's `update_capture_file` SQL matches.
