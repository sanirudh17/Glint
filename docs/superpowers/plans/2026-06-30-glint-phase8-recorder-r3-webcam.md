# Phase 8 R3 — Webcam Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, draggable, circular webcam bubble (on-screen window) that gdigrab records as part of the screen — no change to the ffmpeg/gdigrab pipeline.

**Architecture:** A recorder-owned `rec-cam` window renders the default camera via the browser `getUserMedia` (video-only, local device, no network). Because it sits on screen and is NOT excluded from capture, gdigrab BitBlt-captures the circle wherever the user drags it. The recorder's video/audio pipelines are untouched; R3 only adds a sibling window + a toggle.

**Tech Stack:** Tauri v2 (Rust) + React 19 + TypeScript, `@tauri-apps/api/window` (`startDragging`, `setSize`, `setPosition`), browser `MediaDevices.getUserMedia`. ffmpeg/WASAPI unchanged.

## Global Constraints
- **Local-only:** no cloud, no upload, no accounts, no network calls. The camera is a local device via the browser media API.
- **Single-user:** no login/auth.
- **SACRED recorder isolation:** `glint/src-tauri/src/recorder/*.rs` imports NOTHING from `capture/`, `editor/`, or `overlay/`. R3 adds a recorder-owned window + toggle only.
- **ffmpeg/gdigrab path UNTOUCHED:** no `dshow`, no `overlay` filter, no change to `build_ffmpeg_args`, `spawn_segment`, pause/resume, or concat.
- **Spec:** `docs/superpowers/specs/2026-06-30-glint-phase8-recorder-r3-webcam-design.md`.
- **Branch:** `phase-8-recorder-r3` → merges to `master`.
- Camera is **video-only** (`audio: false`); audio stays on the R2 WASAPI path.
- Bubble is **un-mirrored** (no CSS flip), **circular**, **default camera** (no picker).

---

## Task 1: Spike — prove `getUserMedia` works in a Tauri window (de-risk gate)

This is the gate: confirm a Tauri WebView2 window can open the default camera and render it. Builds the real `rec-cam` window + a minimal `RecCam` (kept and extended in Task 3), opened via a TEMPORARY tray item (removed in Task 4).

**Files:**
- Modify: `glint/src-tauri/src/recorder/windows.rs` (add `CAM_LABEL`, `build_cam_bubble`, `close_cam_bubble`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `recorder_cam_spike` temp command)
- Modify: `glint/src-tauri/src/lib.rs` (register `recorder_cam_spike`)
- Modify: `glint/src-tauri/src/tray.rs` (TEMP "Test Webcam" item)
- Create: `glint/src/recorder/RecCam.tsx` (minimal: getUserMedia + circular video)
- Modify: `glint/src/router.tsx` (route `/rec-cam`), `glint/src/main.tsx` (transparent route)
- Create: `glint/src/recorder/reccam.css` (or append to `recorder.css`)

**Interfaces:**
- Produces: `windows::build_cam_bubble(app: &AppHandle, target: RecordTarget, diameter: f64) -> tauri::Result<()>`, `windows::close_cam_bubble(app: &AppHandle)`, `CAM_LABEL: &str = "rec-cam"`.

- [ ] **Step 1: Add the window builder + closer (windows.rs)**

Add near the other builders (mirrors `build_control_bar`; note it is NOT capture-excluded):

```rust
pub const CAM_LABEL: &str = "rec-cam";

/// Live webcam bubble — a focus-less, transparent, always-on-top circular window
/// rendering the default camera. Unlike the control bar it is NOT excluded from
/// capture: gdigrab records it as part of the screen. Positioned bottom-right of
/// the recording area so it starts inside a region recording.
pub fn build_cam_bubble(app: &AppHandle, target: crate::recorder::RecordTarget, diameter: f64) -> tauri::Result<()> {
    if app.get_webview_window(CAM_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, CAM_LABEL, WebviewUrl::App("index.html#/rec-cam".into()))
        .title("Glint Camera")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(diameter, diameter)
        .visible(false)
        .build()?;

    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor();
        // Recording area in PHYSICAL px (region coords are physical; fullscreen = monitor).
        let (rx, ry, rw, rh) = match target {
            crate::recorder::RecordTarget::Region { x, y, w, h } => (x, y, w as i32, h as i32),
            crate::recorder::RecordTarget::Fullscreen => {
                let pos = m.position();
                let size = m.size();
                (pos.x, pos.y, size.width as i32, size.height as i32)
            }
        };
        let d = (diameter * s) as i32;
        let margin = (24.0 * s) as i32;
        win.set_position(tauri::PhysicalPosition { x: rx + rw - d - margin, y: ry + rh - d - margin })?;
    } else {
        log::warn!("rec-cam: no primary monitor; default position");
    }

    win.show()?;
    Ok(())
}

/// Close the webcam bubble if open. Safe when none exists.
pub fn close_cam_bubble(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CAM_LABEL) {
        let _ = w.close();
    }
}
```

Verify `RecordTarget`'s field types in `recorder/mod.rs` and adjust the `as i32`/`as` casts to match (region `x,y` and `w,h`). If `RecordTarget` isn't already public/importable here, reference it as it is used by `build_control_bar`'s neighbors.

- [ ] **Step 2: Add a TEMP spike command (mod.rs)**

```rust
/// TEMP (Task 1 spike): open the webcam bubble to prove getUserMedia works in
/// WebView2. Removed in Task 4. Uses a fullscreen target + medium diameter.
#[tauri::command(async)]
pub async fn recorder_cam_spike(app: tauri::AppHandle) -> Result<(), String> {
    windows::build_cam_bubble(&app, RecordTarget::Fullscreen, 170.0).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register it (lib.rs)**

Add `recorder::recorder_cam_spike,` to the `invoke_handler!` list.

- [ ] **Step 4: TEMP tray item (tray.rs)**

In `build`, add to the Record submenu a temporary item and handler:

```rust
let rec_cam_test = MenuItem::with_id(app, "rec_cam_test", "Test Webcam (spike)", true, None::<&str>)?;
// add &rec_cam_test to the record submenu items array
```
```rust
"rec_cam_test" => {
    let a = app.clone();
    tauri::async_runtime::spawn(async move { let _ = crate::recorder::recorder_cam_spike(a).await; });
}
```

- [ ] **Step 5: Minimal RecCam component (RecCam.tsx)**

```tsx
/** RecCam.tsx — webcam bubble (route #/rec-cam). Task 1: minimal camera render. */
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import "./reccam.css";

export function RecCam() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => {
        // No camera / permission denied — tell the main window, then close.
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().close().catch(() => {});
      });
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="reccam">
      <video ref={videoRef} className="reccam-video" autoPlay muted playsInline />
    </div>
  );
}
```

- [ ] **Step 6: Route + transparent route + CSS**

`router.tsx`: import `RecCam` and add `{ path: "/rec-cam", element: <RecCam /> }` (chrome-free, outside AppShell).
`main.tsx`: add `hash.startsWith("#/rec-cam")` to the transparent-route check.
`reccam.css`:

```css
.reccam { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: transparent; }
.reccam-video {
  width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.85);
  box-shadow: 0 6px 22px rgba(0,0,0,0.45);
  background: #0c0c10;
}
```

- [ ] **Step 7: Build + AT-SCREEN VERIFY (gate)**

Run: `cd glint/src-tauri && cargo build` and `cd glint && npm run build`. Expected: clean.
**At-screen (user):** `npm run tauri dev` → tray → Record → **Test Webcam (spike)** → a circular live camera bubble appears bottom-right.
- If it shows → **gate passed**, proceed.
- If the camera is black / permission denied → investigate WebView2 media permission for wry/Tauri v2 (check Windows Settings → Privacy → Camera allows desktop apps; check whether wry auto-grants `PermissionRequested`; if not, a Rust-side webview permission handler is needed). Resolve before Task 3.

- [ ] **Step 8: Commit**

```bash
git add glint/src-tauri/src/recorder/windows.rs glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs glint/src-tauri/src/tray.rs glint/src/recorder/RecCam.tsx glint/src/recorder/reccam.css glint/src/router.tsx glint/src/main.tsx
git commit -m "spike(p8 r3): webcam bubble window + getUserMedia in WebView2"
```

---

## Task 2: `record_webcam` setting (TDD) + store + Settings UI

Mechanical — mirrors the R2 `record_microphone` setting exactly (`f700a6d`).

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (field + default + `apply_update` + tests)
- Modify: `glint/src/store/useAppStore.ts` (field, load, setter)
- Modify: `glint/src/views/settings/Recording.tsx` (toggle)

- [ ] **Step 1: Failing tests (settings/mod.rs)**

```rust
#[test]
fn defaults_webcam_off() {
    assert!(!Settings::default().record_webcam);
}

#[test]
fn apply_update_sets_webcam() {
    let mut s = Settings::default();
    apply_update(&mut s, "record_webcam", serde_json::json!(true)).unwrap();
    assert!(s.record_webcam);
}
```

- [ ] **Step 2: Run → FAIL** — `cargo test -p glint --lib settings` (unknown field/key).

- [ ] **Step 3: Add field + default + arm**

`struct Settings`: add `pub record_webcam: bool,`. `Default`: `record_webcam: false,`. `apply_update`:
```rust
"record_webcam" => {
    s.record_webcam = value.as_bool().ok_or("record_webcam must be boolean")?;
}
```

- [ ] **Step 4: Run → PASS** — `cargo test -p glint --lib settings`.

- [ ] **Step 5: Store (useAppStore.ts)**

Add `record_webcam: boolean;` to `interface Settings`; in `loadSettings` add a `let record_webcam = rustSettings.record_webcam;`, a `readSetting<boolean>("record_webcam")` override, include it in the merged object; add `setRecordWebcam` to the interface + an implementation mirroring `setRecordMicrophone` (saveSetting/persistSetting `record_webcam`).

- [ ] **Step 6: Settings toggle (Recording.tsx)**

Add a `Switch` row "Record webcam" wired to `settings?.record_webcam ?? false` / `setRecordWebcam`, mirroring the existing mic row.

- [ ] **Step 7: Verify + commit**

Run: `cargo test -p glint --lib settings`, `npm run build`. Expected: pass/clean.
```bash
git add glint/src-tauri/src/settings/mod.rs glint/src/store/useAppStore.ts glint/src/views/settings/Recording.tsx
git commit -m "feat(p8 r3): record_webcam setting (default off)"
```

---

## Task 3: Full RecCam bubble — drag, sizes, hover controls, error handling

Extends the Task-1 minimal RecCam into the real bubble. No new Rust (drag/resize use the window API already granted by the `rec-*` capability: `allow-start-dragging`, `allow-set-size`, `allow-set-position`).

**Files:**
- Modify: `glint/src/recorder/RecCam.tsx`
- Modify: `glint/src/recorder/reccam.css`

**Interfaces:**
- Consumes: `getCurrentWindow()` (`startDragging`, `setSize`, `innerPosition`/`setPosition`).
- Produces: a self-contained bubble; no exports beyond `RecCam`.

- [ ] **Step 1: Sizes + drag + hover controls (RecCam.tsx)**

Replace the component body with:

```tsx
/** RecCam.tsx — webcam bubble (route #/rec-cam): draggable, S/M/L, un-mirrored. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { Maximize2, X } from "lucide-react";
import "./reccam.css";

const SIZES = [120, 170, 230]; // S / M / L diameter (logical px); index 1 = default

export function RecCam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sizeIdx, setSizeIdx] = useState(1);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => {
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().close().catch(() => {});
      });
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Cycle S→M→L: resize the window, keeping the bottom-right corner anchored so
  // the bubble doesn't drift off the recording area as it grows.
  async function cycleSize() {
    const next = (sizeIdx + 1) % SIZES.length;
    const win = getCurrentWindow();
    const cur = SIZES[sizeIdx];
    const dim = SIZES[next];
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition(); // physical
    const delta = Math.round((dim - cur) * scale);
    await win.setSize(new LogicalSize(dim, dim));
    await win.setPosition({ type: "Physical", x: pos.x - delta, y: pos.y - delta } as never);
    setSizeIdx(next);
  }

  function close() { getCurrentWindow().close().catch(() => {}); }

  // Press-drag anywhere on the bubble (but not the buttons) moves the window.
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".reccam-btn")) return;
    getCurrentWindow().startDragging().catch(() => {});
  }

  return (
    <div className="reccam" onPointerDown={onPointerDown}>
      <video ref={videoRef} className="reccam-video" autoPlay muted playsInline />
      <div className="reccam-controls">
        <button className="reccam-btn" title="Resize" aria-label="Resize" onClick={cycleSize}>
          <Maximize2 size={13} strokeWidth={2} />
        </button>
        <button className="reccam-btn" title="Turn off webcam" aria-label="Turn off webcam" onClick={close}>
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CSS — hover controls hidden at rest (reccam.css)**

```css
.reccam { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: transparent; cursor: grab; }
.reccam:active { cursor: grabbing; }
.reccam-video {
  width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.85); box-shadow: 0 6px 22px rgba(0,0,0,0.45);
  background: #0c0c10; pointer-events: none;
}
/* Hidden at rest so they never appear in the recorded frame; shown on hover. */
.reccam-controls {
  position: absolute; bottom: 10%; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; opacity: 0; transition: opacity 140ms ease;
}
.reccam:hover .reccam-controls { opacity: 1; }
.reccam-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: none; border-radius: 50%;
  background: rgba(8,9,13,0.72); color: #fff; cursor: pointer;
}
.reccam-btn:hover { background: rgba(8,9,13,0.95); }
```

- [ ] **Step 3: Build + verify**

Run: `cd glint && npm run build`. Expected: clean.
**At-screen (user):** open the bubble (Test Webcam spike) → hover shows resize/✕; resize cycles S→M→L staying bottom-right; press-drag moves it; ✕ closes it.

- [ ] **Step 4: Commit**

```bash
git add glint/src/recorder/RecCam.tsx glint/src/recorder/reccam.css
git commit -m "feat(p8 r3): webcam bubble — drag, S/M/L sizes, hover controls"
```

---

## Task 4: Enable + live toggle plumbing + lifecycle (remove spike trigger)

Wires the bubble into the real recorder flow: a `webcam` start param + lifecycle open/close, a live control-bar toggle, the selector chip, and status. Removes the temp tray spike item.

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`recorder_start` webcam param + lifecycle; `recorder_set_webcam`; `ActiveRecording.webcam_on`; `RecorderStatusDto.webcam`)
- Modify: `glint/src-tauri/src/lib.rs` (register `recorder_set_webcam`; remove `recorder_cam_spike`)
- Modify: `glint/src-tauri/src/tray.rs` (remove Test-Webcam item; pass `webcam` to `recorder_start` for rec_full)
- Modify: `glint/src/lib/recorder.ts` (`webcam` arg; `recorderSetWebcam`; status type)
- Modify: `glint/src/recorder/RegionSelect.tsx` (Webcam chip)
- Modify: `glint/src/recorder/ControlBar.tsx` (webcam toggle)
- Modify: `glint/src/recorder/recorder.css` (no new styles needed if reusing `rec-atog`/`rec-sel-chip`)

**Interfaces:**
- Produces: `recorder_set_webcam(app, on: bool) -> Result<(), String>`; `recorder_start(app, mode, x, y, w, h, system: Option<bool>, mic: Option<bool>, webcam: Option<bool>)`; `RecorderStatusDto.webcam: bool`.
- Consumes: `windows::build_cam_bubble` / `close_cam_bubble` (Task 1), the `record_webcam` setting (Task 2).

- [ ] **Step 1: ActiveRecording + DTO fields (mod.rs)**

Add `pub webcam_on: bool,` to `ActiveRecording`. Add `pub webcam: bool,` to `RecorderStatusDto`. In `recorder_status`, set `webcam: r.webcam_on`.

- [ ] **Step 2: `recorder_start` gains `webcam` + opens the bubble**

Change the signature to add `webcam: Option<bool>` (last param). After the preliminary `ActiveRecording` is created, set `webcam_on` from `webcam.unwrap_or(false)`; when true, open the bubble during the countdown window so the user can frame:

```rust
let want_cam = webcam.unwrap_or(false);
// ... in the preliminary ActiveRecording literal:
webcam_on: want_cam,
// ... right after build_control_bar (still inside the init, before/with the bar):
if want_cam {
    let _ = windows::build_cam_bubble(&app, target, 170.0);
}
```
Open it ideally at the countdown so framing is possible during 3-2-1; building it right after `close_countdown` (just before/with the control bar) is acceptable and simplest. Pick one and keep it consistent.

- [ ] **Step 3: `recorder_set_webcam` command (mod.rs)**

```rust
/// Toggle the webcam bubble live. Independent of ffmpeg (just a sibling on-screen
/// window gdigrab records), so this is instant — no segment restart. No-op-erroring
/// if not recording.
#[tauri::command]
pub fn recorder_set_webcam(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let target = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        let rec = guard.as_mut().ok_or("not recording")?;
        rec.webcam_on = on;
        rec.target
    };
    if on { let _ = windows::build_cam_bubble(&app, target, 170.0); }
    else { windows::close_cam_bubble(&app); }
    Ok(())
}
```
(`RecordTarget` must be `Copy`; it already is.)

- [ ] **Step 4: Close the bubble on stop/cancel (mod.rs)**

In `recorder_stop` and `recorder_cancel`, after `windows::close_control_bar(&app);` add `windows::close_cam_bubble(&app);`. Also call it on the `recorder_start` spawn-failure teardown path.

- [ ] **Step 5: Register + remove spike (lib.rs, tray.rs)**

`lib.rs`: add `recorder::recorder_set_webcam,`; remove `recorder::recorder_cam_spike,`. Delete `recorder_cam_spike` from `mod.rs`. `tray.rs`: remove the `rec_cam_test` item + handler; update the `rec_full` call to `recorder_start(a, "fullscreen".into(), None, None, None, None, None, None, None)` (9 args).

- [ ] **Step 6: Frontend IPC (recorder.ts)**

```ts
export interface RecorderStatus {
  recording: boolean; elapsed_secs: number;
  system: boolean; mic: boolean; system_muted: boolean; mic_muted: boolean;
  webcam: boolean;
}
export const recorderStartFullscreen = (audio?: { system: boolean; mic: boolean; webcam: boolean }): Promise<void> =>
  invoke<void>("recorder_start", { mode: "fullscreen", system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false });
export const recorderStartRegion = (r, audio?) =>
  invoke<void>("recorder_start", { mode: "region", x: r.x, y: r.y, w: r.w, h: r.h, system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false });
export const recorderSetWebcam = (on: boolean): Promise<void> => invoke<void>("recorder_set_webcam", { on });
```
(Match the existing `recorderStartRegion` signature/body; only add the `webcam` key.)

- [ ] **Step 7: Selector Webcam chip (RegionSelect.tsx)**

Add a `cam` state seeded from `settings.record_webcam`; render a `Webcam`/`VideoOff` chip (lucide `Video`/`VideoOff`) next to the System/Mic chips (same `rec-sel-chip` class, `onPointerDown` stop-propagation); pass `webcam: cam` into both `recorderStartRegion(..., { system: sys, mic, webcam: cam })` and `recorderStartFullscreen({ system: sys, mic, webcam: cam })`.

- [ ] **Step 8: Control-bar webcam toggle (ControlBar.tsx)**

Add a webcam toggle that is ALWAYS shown (webcam can be enabled live even if off at start). Seed `camOn` from `recorderStatus().webcam`; render a `Video`/`VideoOff` button (reuse `rec-atog` styling); clicking calls `recorderSetWebcam(next)` and flips local state on success (mirror `toggleMute`).

- [ ] **Step 9: Build + green gate + at-screen**

Run: `cd glint/src-tauri && cargo test --lib`, `cd glint && npm run build && npm run test`. Expected: all pass.
**At-screen (user):** Webcam chip default off; toggle it on in the selector → record → bubble appears bottom-right during countdown, is in the saved MP4 (un-mirrored). Control-bar webcam toggle turns it on/off mid-recording (even if started off). Stop/cancel closes the bubble. No-camera path toasts and records without the bubble.

- [ ] **Step 10: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs glint/src-tauri/src/tray.rs glint/src/lib/recorder.ts glint/src/recorder/RegionSelect.tsx glint/src/recorder/ControlBar.tsx
git commit -m "feat(p8 r3): webcam enable chip + live control-bar toggle + lifecycle"
```

---

## Task 5: Acceptance doc + roadmap

**Files:**
- Create: `docs/superpowers/PHASE-8-RECORDER-R3-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md` (R3 Planned → Shipped)

- [ ] **Step 1: Green gate** — `cargo build`, `cargo test` (src-tauri); `npm run build`, `npm run test` (glint). Record counts.

- [ ] **Step 2: Acceptance doc** — mirror the R2 acceptance doc: green-gate counts, the on-screen-bubble model + isolation note, the at-screen checklist (chip default off; bubble appears bottom-right during countdown; draggable; S/M/L; un-mirrored in MP4; live toggle on/off mid-recording incl. starting-off; region recording captures it only when inside the region; no-camera toast + records without bubble; stop/cancel closes it), and the getUserMedia/WebView2 prerequisite. Deferred: device picker, rectangle shape, mirror toggle, effects/blur.

- [ ] **Step 3: Roadmap** — move "Phase 8 R3 — Webcam overlay" into Shipped with a one-line summary (on-screen getUserMedia bubble captured by gdigrab; circular, draggable, S/M/L; chip + live toggle; recorder pipeline untouched).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-8-RECORDER-R3-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p8 r3): webcam acceptance checklist + roadmap update"
```

---

## Self-Review

**Spec coverage:** on-screen bubble + gdigrab-captures-it (Tasks 1,3,4 — ffmpeg untouched ✓); circular/un-mirrored/default-camera (Task 1,3 ✓); S/M/L + drag (Task 3 ✓); Webcam chip + `record_webcam` setting (Tasks 2,4 ✓); live control-bar toggle (Task 4 ✓); lifecycle open-at-countdown/close-on-stop (Task 4 ✓); getUserMedia spike-first (Task 1 ✓); isolation (all tasks — recorder-owned window, no capture/editor/overlay imports ✓); error handling no-camera (Tasks 1,3 ✓); unit tests for `record_webcam` (Task 2 ✓); acceptance + roadmap (Task 5 ✓).

**Placeholder scan:** the spike's permission-fix branch (Task 1 Step 7) is intentionally exploratory (its purpose); all other steps carry concrete code. Default-position math casts flagged to verify against `RecordTarget`'s actual field types.

**Type consistency:** `build_cam_bubble(app, target, diameter)` / `close_cam_bubble(app)` / `CAM_LABEL` used identically across Tasks 1,4; `recorder_set_webcam(app, on)`, `recorder_start(..., webcam: Option<bool>)`, `RecorderStatusDto.webcam`, `ActiveRecording.webcam_on` consistent across Task 4; TS `recorderSetWebcam(on)` + `RecorderStatus.webcam` + the `{ system, mic, webcam }` audio object consistent across Task 4's frontend steps.
