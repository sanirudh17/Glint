# Independent Webcam Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the webcam as its own video track alongside a clean screen recording, then let the user reposition/resize/remove it as a circular overlay in the trim editor, baked in at export.

**Architecture:** Opt-in per recording. The `rec-cam` bubble is marked capture-excluded so `gdigrab`/`ddagrab` produce a clean screen `.mp4`; the bubble webview records its own stream via `MediaRecorder` (VP8/WebM), streaming chunks to a sibling `<name>.cam.webm`. The trim editor detects the sibling, shows a draggable/resizable circular overlay, and the export ffmpeg pass composites it with the identical per-segment trim/speed as the screen. Everything stays inside the isolated `recorder/` module.

**Tech Stack:** Tauri v2 (Rust) · React 19 + TypeScript · `tauri-plugin-shell` (ffmpeg/ffprobe sidecars) · WebView2 `MediaRecorder` · Vitest · `cargo test`.

## Global Constraints

- **Base branch:** `master`. Work branch: `phase-21-independent-webcam` (already created).
- **Recorder isolation:** all new code lives in `recorder/` (`recorder/cam.rs`, `RecCam.tsx`, `trim.rs`, `windows.rs`, `mod.rs`). Import nothing from `capture/`, `editor/`, `overlay/`, `ocr/`. `trim.rs` may use only recorder-owned helpers + `crate::db`.
- **Never break recording:** the baked-in webcam path is the default and must stay byte-identical when the movable toggle is off.
- **Green gate (run before every commit):** from `glint/src-tauri`: `cargo clippy --all-targets` (0 warnings) + `cargo test`. From `glint`: `npx tsc --noEmit` + `npx vitest run`.
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```
- **ffmpeg progress invariant:** trim export keeps `-nostats -loglevel error -progress pipe:1` (the sidecar event channel is capacity-1).
- **Sidecar filename convention:** `cam_sidecar_path(<screen>.mp4) == <dir>/<stem>.cam.webm`.

---

## File Structure

- **Create** `glint/src-tauri/src/recorder/cam.rs` — sidecar path derivation, `recorder_cam_write_chunk` (append), and the per-recording cam-writer state. Pure path helper is unit-tested here.
- **Modify** `glint/src-tauri/src/recorder/mod.rs` — register `cam` module; emit cam lifecycle events (`rec-cam-record-start|pause|resume|stop`) from `recorder_start`/`_pause`/`_resume`/`_stop`; pass `webcam_movable` through; set sidecar path in state; pre-start fallback.
- **Modify** `glint/src-tauri/src/recorder/windows.rs` — make `exclude_from_capture` reusable (`pub(crate)`); add a `movable: bool` param to `build_cam_bubble` that excludes the bubble when true.
- **Modify** `glint/src-tauri/src/recorder/trim.rs` — `ProbeResult.has_cam`; `CamOverlay` struct + normalized→pixel math; extended filter builder with the overlay branch; `recorder_trim_export` gains cam params; new unit tests.
- **Modify** `glint/src-tauri/src/settings/mod.rs` — `record_webcam_movable: bool` setting.
- **Modify** `glint/src-tauri/src/lib.rs` — register `recorder::cam::recorder_cam_write_chunk`.
- **Modify** `glint/src/recorder/RecCam.tsx` — `MediaRecorder` lifecycle driven by backend events; chunk streaming.
- **Modify** `glint/src/recorder/RegionSelect.tsx` — "Movable (edit later)" sub-toggle under the Webcam chip; pass `webcam_movable` to `recorder_start`.
- **Modify** `glint/src/lib/recorder.ts` — thread `webcam_movable` through `recorderStart`.
- **Create** `glint/src/recorder/camOverlay.ts` — pure coordinate/clamp/default helpers (vitest).
- **Create** `glint/src/recorder/camOverlay.test.ts` — tests for the above.
- **Create** `glint/src/recorder/TrimCamOverlay.tsx` — the draggable/resizable circular overlay component.
- **Modify** `glint/src/recorder/TrimView.tsx` — load `cam.webm`, render `TrimCamOverlay`, sync playback, pass placement to export.
- **Modify** `glint/src/lib/trim.ts` — `ProbeResult.has_cam`; `trimExport` cam params.
- **Modify** `glint/src/recorder/trim.css` — overlay + handle + toggle styles.

---

## Milestone A — Capture side (independent webcam track)

### Task A1: `record_webcam_movable` setting

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (struct field ~42, Default ~80, `apply_update` match ~131)
- Modify: `glint/src/lib/recorder.ts`
- Modify: `glint/src/recorder/RegionSelect.tsx:90`

**Interfaces:**
- Produces: settings key `record_webcam_movable: bool` (default `false`); `recorderStart(opts)` gains `webcamMovable?: boolean` → passed to `recorder_start` as `webcam_movable`.

- [ ] **Step 1: Add the Rust setting field + default + updater.** In `settings/mod.rs`, beside `record_webcam`:
  - struct: `pub record_webcam_movable: bool,`
  - `Default`: `record_webcam_movable: false,`
  - `apply_update` match arm:
    ```rust
    "record_webcam_movable" => {
        s.record_webcam_movable = value.as_bool().ok_or("record_webcam_movable must be boolean")?;
    }
    ```

- [ ] **Step 2: Run the existing settings test to confirm nothing broke.**
  Run: `cd glint/src-tauri && cargo test settings`
  Expected: PASS (existing settings tests still green; new field compiles).

- [ ] **Step 3: Thread the flag through the frontend recorder lib.** In `glint/src/lib/recorder.ts`, add `webcamMovable?: boolean` to the `recorderStart` options type and include `webcam_movable: opts.webcamMovable ?? false` in the `invoke("recorder_start", { ... })` payload. (Match the existing `webcam:` field's style.)

- [ ] **Step 4: Add the UI sub-toggle.** In `RegionSelect.tsx`, near the webcam chip state (`setCam(settings.record_webcam ...)` at line 90), add `const [camMovable, setCamMovable] = useState(settings.record_webcam_movable ?? false);`. Render a small secondary toggle labelled **"Movable (edit later)"** that is **only visible when the webcam chip is on**, and persists via the existing settings-save path (`persistSetting`/`saveSetting`) used by the other chips. Pass `webcamMovable: camMovable` into the `recorderStart(...)` call in this file.

- [ ] **Step 5: Typecheck + commit.**
  Run: `cd glint && npx tsc --noEmit`  Expected: clean.
  ```bash
  git add glint/src-tauri/src/settings/mod.rs glint/src/lib/recorder.ts glint/src/recorder/RegionSelect.tsx
  git commit -m "feat(p21): record_webcam_movable setting + selector sub-toggle"
  ```

---

### Task A2: `recorder/cam.rs` — sidecar path + chunk-append command

**Files:**
- Create: `glint/src-tauri/src/recorder/cam.rs`
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `pub mod cam;` with the other `mod` lines)
- Modify: `glint/src-tauri/src/lib.rs:298` (register the command near `recorder_set_webcam`)

**Interfaces:**
- Produces:
  - `pub fn cam_sidecar_path(screen_mp4: &str) -> std::path::PathBuf` → `<dir>/<stem>.cam.webm`.
  - `#[tauri::command(async)] pub async fn recorder_cam_write_chunk(app, path: String, bytes: Vec<u8>, first: bool) -> Result<(), String>` — `first=true` truncates/creates, else appends.

- [ ] **Step 1: Write the failing test for the path helper.** Create `cam.rs` with a `#[cfg(test)]` module:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      #[test]
      fn sidecar_is_stem_dot_cam_webm() {
          let p = cam_sidecar_path(r"C:\v\Glint 2026 at 10.00.00.mp4");
          assert_eq!(p.file_name().unwrap().to_string_lossy(), "Glint 2026 at 10.00.00.cam.webm");
          assert_eq!(p.parent().unwrap().to_string_lossy(), r"C:\v");
      }
  }
  ```

- [ ] **Step 2: Run it — expect a compile/failure because `cam_sidecar_path` doesn't exist.**
  Run: `cd glint/src-tauri && cargo test -p glint cam::tests::sidecar 2>&1 | tail -5`
  Expected: FAIL (unresolved `cam_sidecar_path`).

- [ ] **Step 3: Implement the module.** Top of `cam.rs`:
  ```rust
  //! Independent-webcam sidecar I/O. ISOLATED (recorder-owned): the rec-cam webview
  //! streams MediaRecorder chunks here; we append them to `<stem>.cam.webm` next to the
  //! screen recording. Nothing from capture/editor/overlay/ocr.
  use std::io::Write;
  use std::path::{Path, PathBuf};

  /// `<dir>/<stem>.cam.webm` beside the screen recording.
  pub fn cam_sidecar_path(screen_mp4: &str) -> PathBuf {
      let p = Path::new(screen_mp4);
      let dir = p.parent().unwrap_or_else(|| Path::new("."));
      let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Glint".into());
      dir.join(format!("{stem}.cam.webm"))
  }

  /// Append (or, when `first`, create/truncate) one MediaRecorder chunk to `path`.
  #[tauri::command(async)]
  pub async fn recorder_cam_write_chunk(
      _app: tauri::AppHandle,
      path: String,
      bytes: Vec<u8>,
      first: bool,
  ) -> Result<(), String> {
      let mut f = std::fs::OpenOptions::new()
          .create(true)
          .write(true)
          .truncate(first)
          .append(!first)
          .open(&path)
          .map_err(|e| format!("cam open: {e}"))?;
      f.write_all(&bytes).map_err(|e| format!("cam write: {e}"))?;
      Ok(())
  }
  ```

- [ ] **Step 4: Register the module + command.**
  - `mod.rs`: add `pub mod cam;` alongside the other `pub mod` lines.
  - `lib.rs`: add `recorder::cam::recorder_cam_write_chunk,` to the `invoke_handler!` list (near `recorder::recorder_set_webcam,`).

- [ ] **Step 5: Run the test — expect PASS.**
  Run: `cd glint/src-tauri && cargo test cam::tests::sidecar 2>&1 | tail -5`  Expected: PASS.

- [ ] **Step 6: Clippy + commit.**
  Run: `cargo clippy --all-targets 2>&1 | tail -3`  Expected: 0 warnings.
  ```bash
  git add glint/src-tauri/src/recorder/cam.rs glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs
  git commit -m "feat(p21): recorder/cam.rs sidecar path + chunk-append command"
  ```

---

### Task A3: capture-exclude the bubble in movable mode

**Files:**
- Modify: `glint/src-tauri/src/recorder/windows.rs:58` (`exclude_from_capture`), `:214` (`build_cam_bubble`)
- Modify: `glint/src-tauri/src/recorder/mod.rs:662`

**Interfaces:**
- Produces: `build_cam_bubble(app, target, diameter, movable: bool)` — when `movable`, calls `exclude_from_capture(&win)` before `win.show()`.

- [ ] **Step 1: Make the helper reusable.** In `windows.rs`, change `fn exclude_from_capture` to `pub(crate) fn exclude_from_capture` (signature unchanged).

- [ ] **Step 2: Add the `movable` param.** Change `build_cam_bubble`'s signature to `pub fn build_cam_bubble(app: &AppHandle, target: ..., diameter: f64, movable: bool) -> tauri::Result<()>`. Immediately before `win.show()?;` add:
  ```rust
  // Independent mode: hide the bubble from gdigrab/ddagrab so the screen video is
  // clean — the webcam is recorded separately and composited later.
  if movable {
      exclude_from_capture(&win);
  }
  ```

- [ ] **Step 3: Update the call site.** In `mod.rs` `recorder_start`, the line `let _ = windows::build_cam_bubble(&app, target, 170.0);` becomes:
  ```rust
  let _ = windows::build_cam_bubble(&app, target, 170.0, want_cam_movable);
  ```
  where `want_cam_movable` is read from the new `webcam_movable` command param (add `webcam_movable: Option<bool>` to `recorder_start`'s signature and `let want_cam_movable = want_cam && webcam_movable.unwrap_or(false);` next to `let want_cam = ...`).
  Also update the live re-enable path in `recorder_set_webcam` (search `build_cam_bubble` there): pass the recording's stored movable flag — add a `pub webcam_movable: bool` field to `ActiveRecording` (set from `want_cam_movable` in the preliminary-state constructor) and pass `rec.webcam_movable`.

- [ ] **Step 4: Build + clippy.**
  Run: `cd glint/src-tauri && cargo clippy --all-targets 2>&1 | tail -3`  Expected: 0 warnings (all call sites updated).

- [ ] **Step 5: Commit.**
  ```bash
  git add glint/src-tauri/src/recorder/windows.rs glint/src-tauri/src/recorder/mod.rs
  git commit -m "feat(p21): exclude the webcam bubble from capture in movable mode"
  ```

---

### Task A4: MediaRecorder lifecycle + backend event emits

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` — store `cam_path`; emit lifecycle events
- Modify: `glint/src/recorder/RecCam.tsx`

**Interfaces:**
- Consumes: `recorder_cam_write_chunk` (A2), `cam_sidecar_path` (A2), `ActiveRecording.webcam_movable` (A3).
- Produces: backend events to `CAM_LABEL`: `rec-cam-record-start` (payload: `{ path: String }`), `rec-cam-record-pause`, `rec-cam-record-resume`, `rec-cam-record-stop`; frontend signal `rec-cam-record-saved` awaited by stop.

- [ ] **Step 1: Add `cam_path` to state + compute the sidecar path.** Add `pub cam_path: Option<String>` to `ActiveRecording` (set `None` in the preliminary constructor). In `recorder_start`, after the active slot is filled and `let _ = app.emit("recorder-started", ())`, add — only when `want_cam_movable`:
  ```rust
  if want_cam_movable {
      let cam_path = crate::recorder::cam::cam_sidecar_path(&out_str).to_string_lossy().to_string();
      if let Some(rec) = app.state::<RecorderState>().0.lock().unwrap().as_mut() {
          rec.cam_path = Some(cam_path.clone());
      }
      // Tell the bubble to start MediaRecorder at the true capture t=0.
      let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-start", serde_json::json!({ "path": cam_path }));
  }
  ```

- [ ] **Step 2: Mirror pause/resume/stop.**
  - `recorder_pause`: before `Ok(())`, add `let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-pause", ());`
  - `recorder_resume`: before `Ok(())`, add `let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-resume", ());`
  - `recorder_stop`: **before** `windows::close_cam_bubble(&app);` (the bubble must still exist to flush), if the recording had `cam_path.is_some()`, emit `rec-cam-record-stop` and await the webview's finalize with a bounded wait:
    ```rust
    // Movable webcam: flush + finalize the .cam.webm before we destroy the bubble.
    let had_cam = rec_cam_path.is_some(); // captured from `rec` before it's moved
    if had_cam {
        let done = app.once("rec-cam-record-saved", |_| {});
        let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-stop", ());
        // bounded: don't hang stop if the webview is gone
        let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            // poll: once() handler fires -> we just sleep-poll a flag, or use a channel.
        }).await;
        let _ = done; // (see note)
    }
    ```
    **Implementation note for the worker:** use the same one-shot channel pattern already in `wait_for_cam_ready` (`mod.rs:540`) — create a `tokio::sync::oneshot`, fire it from an `app.once("rec-cam-record-saved", …)` handler, and `tokio::time::timeout(3s, rx)`. Mirror that helper as `wait_for_cam_saved(&app)`.

- [ ] **Step 3: Add the MediaRecorder lifecycle to RecCam.** In `RecCam.tsx`, after the stream is attached (`streamRef.current = s`), set up a recorder that listens for the backend events. Add refs `mrRef`, `camPathRef`, `firstChunkRef`. Wire:
  ```tsx
  // Independent-webcam recording: driven entirely by backend events so the .cam.webm
  // shares the screen capture's timeline. Chunks stream to disk as they arrive.
  const startCamRecording = (path: string, stream: MediaStream) => {
    camPathRef.current = path;
    firstChunkRef.current = true;
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    } catch {
      emit("rec-cam-record-failed").catch(() => {}); // pre-start fallback (Task A5)
      return;
    }
    mr.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      const buf = new Uint8Array(await e.data.arrayBuffer());
      const first = firstChunkRef.current;
      firstChunkRef.current = false;
      invoke("recorder_cam_write_chunk", { path, bytes: Array.from(buf), first }).catch(() => {
        emit("glint-toast", "Webcam recording error").catch(() => {});
      });
    };
    mr.onstop = () => emit("rec-cam-record-saved").catch(() => {});
    mrRef.current = mr;
    mr.start(1000); // 1s timeslice → periodic flushes
  };
  ```
  Register listeners (inside the mount effect, cleaned up on unmount):
  ```tsx
  const offs: Array<() => void> = [];
  listen<{ path: string }>("rec-cam-record-start", (e) => {
    if (streamRef.current) startCamRecording(e.payload.path, streamRef.current);
  }).then((f) => offs.push(f));
  listen("rec-cam-record-pause", () => mrRef.current?.state === "recording" && mrRef.current.pause()).then((f) => offs.push(f));
  listen("rec-cam-record-resume", () => mrRef.current?.state === "paused" && mrRef.current.resume()).then((f) => offs.push(f));
  listen("rec-cam-record-stop", () => { const mr = mrRef.current; if (mr && mr.state !== "inactive") mr.stop(); else emit("rec-cam-record-saved").catch(() => {}); }).then((f) => offs.push(f));
  ```
  In the effect cleanup, call `offs.forEach((f) => f())` and stop any live recorder.
  **Note:** `Array.from(buf)` is simplest but heavy for large chunks; if the worker prefers, use Tauri's raw-bytes IPC (`invoke` accepts `ArrayBuffer` via `Channel`/`tauri::ipc::Request`) — acceptable either way for v1, 1s VP8 chunks are small.

- [ ] **Step 4: Manual verification (no automated test — webview + real camera).**
  Build & run (`cd glint && npm run tauri dev`). Record with Webcam + **Movable** on. After stop, confirm `Videos\Glint\<name>.cam.webm` exists and is non-trivial (> 50 KB), and the screen `.mp4` has **no bubble** baked in. Pause/resume mid-recording and confirm the `.cam.webm` still plays and lines up.

- [ ] **Step 5: Green gate + commit.**
  Run: `cargo clippy --all-targets` + `cargo test` (src-tauri); `npx tsc --noEmit` (glint). Expected: all clean.
  ```bash
  git add glint/src-tauri/src/recorder/mod.rs glint/src/recorder/RecCam.tsx
  git commit -m "feat(p21): webcam MediaRecorder lifecycle driven by backend events"
  ```

---

### Task A5: pre-start fallback to baked-in

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`recorder_start`), `glint/src/recorder/RecCam.tsx`

**Interfaces:**
- Consumes: `rec-cam-record-failed` (emitted by RecCam when `MediaRecorder` can't construct, Task A4 Step 3).

- [ ] **Step 1: Re-include the bubble on failure.** The `MediaRecorder` constructor runs when `rec-cam-record-start` fires — but that is *after* capture begins, so a construction failure means the screen is already recording clean with no webcam. To fall back *before* capture, probe `MediaRecorder` support during the pre-countdown `wait_for_cam_ready` window: in `RecCam.tsx`, right after the stream attaches, test `MediaRecorder.isTypeSupported("video/webm;codecs=vp8")`; if false, `emit("rec-cam-record-failed")`. In `recorder_start`, when `want_cam_movable`, listen once for `rec-cam-record-failed` during the same wait; if it fires, set a local `movable_ok = false`, and:
  ```rust
  if want_cam_movable && !movable_ok {
      // Un-exclude so gdigrab bakes the bubble in — the user still gets a webcam.
      if let Some(w) = app.get_webview_window(windows::CAM_LABEL) {
          // (Best-effort: there is no un-exclude helper; simplest is to rebuild the
          //  bubble without exclusion. Destroy + rebuild non-movable before countdown.)
          let _ = w.destroy();
      }
      let _ = windows::build_cam_bubble(&app, target, 170.0, false);
      let _ = app.emit("glint-toast", "Movable webcam unavailable — recorded in place");
      want_cam_movable = false; // treat the rest of the recording as baked-in
  }
  ```
  (Make `want_cam_movable` a `let mut`.)

- [ ] **Step 2: Manual verification.** Temporarily force `isTypeSupported` to return false in `RecCam.tsx`; start a movable recording; confirm the toast appears, the bubble is baked into the screen video, and no `.cam.webm` is written. Revert the force.

- [ ] **Step 3: Green gate + commit.**
  ```bash
  git add glint/src-tauri/src/recorder/mod.rs glint/src/recorder/RecCam.tsx
  git commit -m "feat(p21): pre-start fallback to baked-in webcam when MediaRecorder unsupported"
  ```

---

## Milestone B — `has_cam` probe

### Task B1: expose whether a recording has a webcam sidecar

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs` (`ProbeResult` ~10, `recorder_trim_probe` ~236, tests)
- Modify: `glint/src/lib/trim.ts` (`ProbeResult`)

**Interfaces:**
- Produces: `ProbeResult.has_cam: bool` (Rust `serde` → TS `has_cam: boolean`).

- [ ] **Step 1: Failing test.** In `trim.rs` tests, add:
  ```rust
  #[test]
  fn probe_result_carries_has_cam() {
      // Compile-level guard: ProbeResult must expose has_cam.
      let p = ProbeResult { duration_secs: 1.0, has_audio: false, fps: 30.0, width: 2, height: 2, has_cam: true };
      assert!(p.has_cam);
  }
  ```

- [ ] **Step 2: Run it — expect compile failure (missing field).**
  Run: `cd glint/src-tauri && cargo test probe_result_carries_has_cam 2>&1 | tail -5`  Expected: FAIL.

- [ ] **Step 3: Add the field + populate it.**
  - Add `pub has_cam: bool,` to `ProbeResult`.
  - In `recorder_trim_probe`, after `parse_ffprobe_json` succeeds, set `has_cam`:
    ```rust
    let mut result = parse_ffprobe_json(&json)?;
    result.has_cam = crate::recorder::cam::cam_sidecar_path(&path).exists();
    Ok(result)
    ```
  - Update `parse_ffprobe_json` to default `has_cam: false` in the `Ok(ProbeResult { … })` it returns (the probe command overrides it). Update the two existing `parse_ffprobe_json` tests' expected structs to include `has_cam: false` **only if they construct the struct literally** — they call `.unwrap()` on the parser, so just ensure the parser sets `has_cam: false`.

- [ ] **Step 4: Run tests — expect PASS.**
  Run: `cargo test -p glint recorder::trim 2>&1 | tail -8`  Expected: PASS (all trim tests).

- [ ] **Step 5: Frontend type.** In `glint/src/lib/trim.ts`, add `has_cam: boolean;` to the `ProbeResult` interface.

- [ ] **Step 6: Gate + commit.**
  Run: `cargo clippy --all-targets` (0 warnings); `cd glint && npx tsc --noEmit` (clean).
  ```bash
  git add glint/src-tauri/src/recorder/trim.rs glint/src/lib/trim.ts
  git commit -m "feat(p21): probe reports has_cam when a .cam.webm sibling exists"
  ```

---

## Milestone C — Editor overlay UI

### Task C1: pure coordinate/clamp/default helpers

**Files:**
- Create: `glint/src/recorder/camOverlay.ts`, `glint/src/recorder/camOverlay.test.ts`

**Interfaces:**
- Produces:
  - `type CamPlacement = { x: number; y: number; diameter: number; visible: boolean };` — `x,y` = **top-left** of the bubble, `diameter`, all **normalized 0..1 of the video frame** (`x,y` in `[0, 1-diameter]`, diameter in `[MIN_D, MAX_D]`).
  - `DEFAULT_PLACEMENT: CamPlacement` — bottom-right, `diameter = 0.18`.
  - `const MIN_D = 0.06, MAX_D = 0.6;`
  - `clampPlacement(p: CamPlacement): CamPlacement` — clamps diameter then x,y so the bubble stays fully inside the frame.
  - `videoRectInBox(box: {w:number;h:number}, videoAspect: number): {x:number;y:number;w:number;h:number}` — the letterboxed (object-fit: contain) video rect inside a container.
  - `toPixels(p: CamPlacement, srcW: number, srcH: number): {x:number;y:number;d:number}` — normalized → source pixels (rounded, even values for yuv420 safety).

- [ ] **Step 1: Write failing tests.** `camOverlay.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { clampPlacement, videoRectInBox, toPixels, DEFAULT_PLACEMENT, MIN_D, MAX_D } from "./camOverlay";

  describe("clampPlacement", () => {
    it("keeps the bubble inside the frame", () => {
      const p = clampPlacement({ x: 0.95, y: 0.95, diameter: 0.2, visible: true });
      expect(p.x).toBeCloseTo(0.8); expect(p.y).toBeCloseTo(0.8);
    });
    it("clamps diameter to [MIN_D, MAX_D]", () => {
      expect(clampPlacement({ x: 0, y: 0, diameter: 5, visible: true }).diameter).toBe(MAX_D);
      expect(clampPlacement({ x: 0, y: 0, diameter: 0.001, visible: true }).diameter).toBe(MIN_D);
    });
  });

  describe("videoRectInBox", () => {
    it("letterboxes a 16:9 video in a square box", () => {
      const r = videoRectInBox({ w: 100, h: 100 }, 16 / 9);
      expect(r.w).toBe(100); expect(Math.round(r.h)).toBe(56);
      expect(r.x).toBe(0); expect(Math.round(r.y)).toBe(22);
    });
    it("pillarboxes a tall video in a wide box", () => {
      const r = videoRectInBox({ w: 200, h: 100 }, 1); // square video
      expect(r.h).toBe(100); expect(r.w).toBe(100); expect(r.x).toBe(50);
    });
  });

  describe("toPixels", () => {
    it("maps normalized to even source pixels", () => {
      const px = toPixels({ x: 0.5, y: 0.25, diameter: 0.1, visible: true }, 1920, 1080);
      expect(px.x).toBe(960); expect(px.y).toBe(270); expect(px.d).toBe(192);
      expect(px.d % 2).toBe(0);
    });
  });

  it("default placement is valid and bottom-right", () => {
    const p = DEFAULT_PLACEMENT;
    expect(p.x + p.diameter).toBeCloseTo(1 - 0.03, 2);
    expect(clampPlacement(p)).toEqual(p);
  });
  ```

- [ ] **Step 2: Run — expect fail (module missing).**
  Run: `cd glint && npx vitest run src/recorder/camOverlay.test.ts`  Expected: FAIL.

- [ ] **Step 3: Implement `camOverlay.ts`.**
  ```ts
  /** camOverlay.ts — pure geometry for the trim-editor webcam overlay. Placement is
   *  normalized (0..1) to the video frame so it's resolution-independent. */
  export type CamPlacement = { x: number; y: number; diameter: number; visible: boolean };

  export const MIN_D = 0.06;
  export const MAX_D = 0.6;
  const MARGIN = 0.03;

  export const DEFAULT_PLACEMENT: CamPlacement = {
    diameter: 0.18,
    x: 1 - 0.18 - MARGIN,
    y: 1 - 0.18 - MARGIN,
    visible: true,
  };

  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  export function clampPlacement(p: CamPlacement): CamPlacement {
    const diameter = clamp(p.diameter, MIN_D, MAX_D);
    return {
      diameter,
      x: clamp(p.x, 0, 1 - diameter),
      y: clamp(p.y, 0, 1 - diameter),
      visible: p.visible,
    };
  }

  export function videoRectInBox(box: { w: number; h: number }, videoAspect: number) {
    const boxAspect = box.w / box.h;
    if (videoAspect > boxAspect) {
      const w = box.w, h = box.w / videoAspect;
      return { x: 0, y: (box.h - h) / 2, w, h };
    }
    const h = box.h, w = box.h * videoAspect;
    return { x: (box.w - w) / 2, y: 0, w, h };
  }

  export function toPixels(p: CamPlacement, srcW: number, srcH: number) {
    const even = (n: number) => Math.round(n / 2) * 2;
    return { x: even(p.x * srcW), y: even(p.y * srcH), d: even(p.diameter * srcW) };
  }
  ```

- [ ] **Step 4: Run — expect PASS.**
  Run: `npx vitest run src/recorder/camOverlay.test.ts`  Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add glint/src/recorder/camOverlay.ts glint/src/recorder/camOverlay.test.ts
  git commit -m "feat(p21): pure camOverlay geometry helpers + tests"
  ```

---

### Task C2: overlay component + TrimView wiring

**Files:**
- Create: `glint/src/recorder/TrimCamOverlay.tsx`
- Modify: `glint/src/recorder/TrimView.tsx`, `glint/src/recorder/trim.css`

**Interfaces:**
- Consumes: `CamPlacement`, `clampPlacement`, `videoRectInBox`, `DEFAULT_PLACEMENT` (C1); `ProbeResult.has_cam` (B1).
- Produces: `TrimCamOverlay` props `{ camSrc: string; placement: CamPlacement; videoAspect: number; onChange(p: CamPlacement): void }`; TrimView holds `const [cam, setCam] = useState<CamPlacement | null>(null)`.

- [ ] **Step 1: Build the overlay component.** `TrimCamOverlay.tsx` renders, over the preview area, an absolutely-positioned circular `<video>` (the cam feed, `muted playsInline`) at the letterboxed rect computed from the container size + `videoAspect`. A pointer-drag on the body moves it (updates normalized x,y via `clampPlacement`); a corner handle resizes (updates diameter about the center then re-clamps). Expose a forwarded ref to the `<video>` so TrimView can sync `currentTime`/`playbackRate`. Use a `ResizeObserver` (or the preview's measured box passed in) to map px↔normalized. Keep all math via the C1 helpers.

- [ ] **Step 2: Wire into TrimView.** In `TrimView.tsx`:
  - After probe, if `p.has_cam`, set `setCam(DEFAULT_PLACEMENT)` and compute `camSrc = convertFileSrc(<derive .cam.webm sibling of t.path>)`. Derive the sibling in TS (replace the `.mp4`/ext suffix with `.cam.webm`) — add a tiny helper next to the probe call.
  - Render `{cam && camSrc && probe && <TrimCamOverlay camSrc={camSrc} placement={cam} videoAspect={probe.width/probe.height} onChange={setCam} ref={camVideoRef} />}` positioned over the `.trim-video`.
  - **Sync:** in the rAF playback loop and in `applyVideoSeek`/`onSeeked`, also set `camVideoRef.current.currentTime = mainVideo.currentTime` and `camVideoRef.current.playbackRate = mainVideo.playbackRate`. Play/pause the cam video alongside the main video in `togglePlay`.
  - **Controls:** add a small control cluster (near the zoom control) — **✕** sets `cam.visible = false`, **Add webcam** sets `visible = true`, **Reset** sets `DEFAULT_PLACEMENT`. Only show when `has_cam`.

- [ ] **Step 3: Styles.** In `trim.css`, add `.trim-cam` (absolute, `border-radius: 50%`, `overflow: hidden`, `object-fit: cover`, subtle ring + shadow, `cursor: move`), `.trim-cam-handle` (corner resize dot, `cursor: nwse-resize`), and the control-cluster styles.

- [ ] **Step 4: Typecheck + at-screen.**
  Run: `npx tsc --noEmit` (clean). Then `npm run tauri dev`: open a movable recording in the trim editor → the webcam circle appears; drag it around, resize via the handle, ✕ to remove, Add to bring back; scrub/play and confirm the cam feed stays time-synced.

- [ ] **Step 5: Commit.**
  ```bash
  git add glint/src/recorder/TrimCamOverlay.tsx glint/src/recorder/TrimView.tsx glint/src/recorder/trim.css
  git commit -m "feat(p21): draggable/resizable webcam overlay in the trim editor"
  ```

---

## Milestone D — Export filter

### Task D1: extend the trim filter builder with the overlay branch

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs` (`build_trim_args`, `recorder_trim_export`, tests)

**Interfaces:**
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)] pub struct CamOverlay { pub x: f64, pub y: f64, pub d: f64 }` — **source-pixel** top-left + diameter (frontend converts via `toPixels`).
  - `build_trim_args(input, output, segments, has_audio, fade_in, fade_out, cam: Option<&str>, overlay: Option<CamOverlay>) -> Vec<String>` — when `cam`+`overlay` are `Some`, add `-i <cam>`, replicate the per-segment `trim`/`setpts` on `[1:v]`, concat to `[camcat]`, `crop`→`scale=d:d`→circular alpha via `geq`, `overlay=x:y` onto the screen concat, then fades. When `None`, the args are **byte-identical to today**.

- [ ] **Step 1: Failing test — no cam is byte-identical.** Add:
  ```rust
  #[test]
  fn no_cam_is_byte_identical_to_pre_overlay() {
      let with_none = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 2.0, 1.0)], true, 0.0, 0.0, None, None);
      // Compare against the known current filtergraph for this input:
      let fc = "[0:v]trim=0:2,setpts=PTS-STARTPTS[v0];\
                [0:a]atrim=0:2,asetpts=PTS-STARTPTS[a0];\
                [v0][a0]concat=n=1:v=1:a=1[outv][outa]";
      assert!(with_none.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {with_none:?}");
      assert!(!with_none.iter().any(|s| s == "-i" && false)); // single input
      assert_eq!(with_none.iter().filter(|s| *s == "-i").count(), 1);
  }
  ```

- [ ] **Step 2: Failing test — cam overlay graph.** Add a test asserting the filtergraph for `cam=Some("cam.webm")`, `overlay=Some(CamOverlay{ x: 100.0, y: 50.0, d: 200.0 })`, one full segment `seg(0,4,1)`, no fades, `has_audio=false`. Expected `filter_complex` (worker builds to match):
  ```
  [0:v]trim=0:4,setpts=PTS-STARTPTS[v0];
  [1:v]trim=0:4,setpts=PTS-STARTPTS[c0];
  [v0]concat=n=1:v=1:a=0[vbase];
  [c0]concat=n=1:v=1:a=0[camcat];
  [camcat]crop='min(iw\,ih)':'min(iw\,ih)',scale=200:200,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-100,Y-100),100),255,0)'[cammask];
  [vbase][cammask]overlay=x=100:y=50[outv]
  ```
  Assert `-i cam.webm` is present and appears **after** `-i in.mp4`, and `-map [outv]` is present. Also assert a fades-present variant routes `overlay=…[vov]` then `[vov]fade…[outv]`.

- [ ] **Step 3: Run — expect fail (signature/graph).**
  Run: `cargo test -p glint recorder::trim 2>&1 | tail -12`  Expected: FAIL.

- [ ] **Step 4: Implement.** Add `CamOverlay`; extend `build_trim_args` with the two new params. Construction rules:
  - Keep the existing screen `[v{i}]`/`[a{i}]` segment loop.
  - When cam: after each screen `[v{i}]`, append a cam segment `[1:v]trim=<s>:<e>,setpts=<same setpts as screen>[c{i}];` (same speed handling).
  - Screen concat → `[vbase]` (was `[outv]`/`[cv]`); cam concat (video only) → `[camcat]`.
  - Mask: `[camcat]crop='min(iw\,ih)':'min(iw\,ih)',scale={d}:{d},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-{d}/2\,Y-{d}/2)\,{d}/2)\,255\,0)'[cammask];` (escape commas inside `geq` with `\,`; use `num()` for `d`).
  - Overlay: `[vbase][cammask]overlay=x={x}:y={y}` → `[vov]` if fades else `[outv]`.
  - Fades: operate on `[vov]` when cam present (else on the screen concat as today). Audio path unchanged.
  - Add `-i cam` as a second input **after** `-i input`; the audio maps/`[outa]` logic is unchanged (audio still from `[0:a]`).
  - Reminder: `overlay` needs the cam stream fully available; since we trim/concat it to the same length, no `shortest`/`eof_action` tuning needed for v1 — but pass `overlay=…:eof_action=pass` to be safe if the cam is a hair short.

- [ ] **Step 5: Run — expect PASS (all trim tests, old + new).**
  Run: `cargo test -p glint recorder::trim 2>&1 | tail -12`  Expected: PASS.

- [ ] **Step 6: Thread cam params through the command.** Extend `recorder_trim_export` with `cam_path: Option<String>` and `cam_overlay: Option<CamOverlay>`; resolve the cam input only when `cam_overlay.is_some()` **and** the sibling exists and is > 1 KB (else drop to screen-only + toast — Milestone E). Pass into `build_trim_args`.

- [ ] **Step 7: Clippy + commit.**
  Run: `cargo clippy --all-targets` (0 warnings).
  ```bash
  git add glint/src-tauri/src/recorder/trim.rs
  git commit -m "feat(p21): trim export composites the webcam overlay (circular, trimmed in sync)"
  ```

---

### Task D2: pass placement from the editor to export

**Files:**
- Modify: `glint/src/lib/trim.ts` (`trimExport`), `glint/src/recorder/TrimView.tsx`

**Interfaces:**
- Consumes: `toPixels` (C1), `CamOverlay` shape `{ x, y, d }`.
- Produces: `trimExport(..., camPath, camOverlay)` → `recorder_trim_export` params `cam_path`, `cam_overlay`.

- [ ] **Step 1: Extend the wrapper.** In `trim.ts`, add `camPath: string | null` and `camOverlay: { x: number; y: number; d: number } | null` params to `trimExport`, forwarded as `cam_path` / `cam_overlay`.

- [ ] **Step 2: Wire the editor `save`.** In `TrimView.tsx` `save()`, when `cam?.visible` and `has_cam`, compute `const px = toPixels(cam, probe.width, probe.height)` and pass `camPath` (the derived sibling) + `px`. When the overlay is removed (`!cam?.visible`) or `!has_cam`, pass `null, null` (export is byte-identical to today).

- [ ] **Step 3: Typecheck + at-screen.**
  Run: `npx tsc --noEmit` (clean). `npm run tauri dev`: place the webcam, then **Save copy** → open the exported file and confirm the circle is baked at the chosen spot; repeat with a **cut**, a **2× section**, and a **fade** and confirm the webcam stays synced and fades with the video.

- [ ] **Step 4: Commit.**
  ```bash
  git add glint/src/lib/trim.ts glint/src/recorder/TrimView.tsx
  git commit -m "feat(p21): editor passes webcam placement to the export pass"
  ```

---

## Milestone E — Fallbacks & robustness

### Task E1: export degrades safely when the cam track is unusable

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs` (`recorder_trim_export`)

- [ ] **Step 1: Guard the cam input.** In `recorder_trim_export`, before building args: if `cam_overlay.is_some()` but `cam_path` is missing / `metadata.len() <= 1024`, set both to `None` and `let _ = app.emit("glint-toast", "Webcam track unavailable — exported without it");`. (No new test needed beyond D1's builder tests; this is an I/O guard.)

- [ ] **Step 2: Manual verification.** Rename a `.cam.webm` aside, export that recording with the overlay visible → confirm the toast and a valid screen-only output; the original is intact.

- [ ] **Step 3: Gate + commit.**
  Run: `cargo clippy --all-targets` + `cargo test`.
  ```bash
  git add glint/src-tauri/src/recorder/trim.rs
  git commit -m "feat(p21): export falls back to screen-only when the webcam track is unusable"
  ```

---

## Milestone F — Full green gate + at-screen acceptance

### Task F1: end-to-end verification

- [ ] **Step 1: Full green gate.**
  Run (src-tauri): `cargo clippy --all-targets` (0 warnings) + `cargo test`.
  Run (glint): `npx tsc --noEmit` + `npx vitest run`.
  Expected: all clean.

- [ ] **Step 2: At-screen acceptance checklist** (`npm run tauri dev`):
  - Record with **Webcam on, Movable off** → behaves exactly as today (bubble baked in, no `.cam.webm`).
  - Record with **Webcam on, Movable on** → clean screen video + `<name>.cam.webm` sibling.
  - Pause/resume during a movable recording → webcam stays in sync in the editor.
  - In the editor: drag / resize / ✕ remove / Add / Reset the webcam; playback stays synced.
  - Export (**Save copy** and **Overwrite**) with the overlay through a **cut**, a **2× segment**, and a **fade** → circle lands where placed, correct size, stays synced, fades with the video.
  - Remove the overlay and export → byte-identical to a normal trim (no webcam).
  - Pre-start fallback toast when `MediaRecorder` is unsupported; screen-only export toast when the `.cam.webm` is missing.

- [ ] **Step 3: ROADMAP + merge.** Add a Phase 21 entry to `docs/superpowers/ROADMAP.md` (move "Independent webcam layer" out of *Planned*), commit, then `git checkout master && git merge --no-ff phase-21-independent-webcam`.

---

## Self-Review notes

- **Spec coverage:** Section 1 → A1–A5; Section 2 → A2 + B1; Section 3 → C1–C2; Section 4 → D1–D2; Section 5 → A5 + E1 + A4(pause-mirror); Section 6 → tests across A2/B1/C1/D1 + F1 at-screen. All covered.
- **Type consistency:** `CamPlacement` (normalized, TS) vs `CamOverlay` (source-pixel, Rust+IPC) are deliberately distinct; `toPixels` is the single conversion boundary (C1 → D2). `cam_sidecar_path` is the one place the `.cam.webm` name is formed on the Rust side; the TS side derives the same suffix in C2/D2 — keep them in lockstep (`<stem>.cam.webm`).
- **Isolation:** every touched Rust file is under `recorder/`; `trim.rs` calls only `crate::recorder::cam` + existing recorder helpers + `crate::db`.
