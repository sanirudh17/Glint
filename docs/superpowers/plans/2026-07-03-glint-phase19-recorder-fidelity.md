# Phase 19 — Recorder Fidelity Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three reliability-first recorder quality wins — a webcam device picker, true 60 fps capture via `ddagrab`, and a fuller/less-muffled microphone — each with a safety net so recording never breaks.

**Architecture:** §1 is a new persisted `webcam_device_id` setting consumed by the `getUserMedia` bubble. §2 swaps the video capture engine from `gdigrab` (GDI/CPU) to `ddagrab` (D3D11/GPU) inside the pure `build_ffmpeg_args`, gated by a cached pre-flight probe that falls back to `gdigrab` on unsupported setups. §3 re-voices the mic EQ chain (a constant + tests in `ffmpeg.rs`). All three sub-features are independent and independently committable.

**Tech Stack:** Rust (Tauri v2, `tauri-plugin-sql`, `tokio`, `wasapi`), TypeScript/React 19 + Zustand, bundled `ffmpeg` sidecar (confirmed to include `ddagrab`).

## Global Constraints

- Base branch is `master`; work on `phase-19-recorder-fidelity` (already created; spec already committed there).
- Settings persist via the dual path: `saveSetting(key,val)` (Rust in-memory `settings_set` → `apply_update`) **and** `persistSetting(key,val)` (SQLite). Hydration is generic/per-key (`hydrate_from_db` → `apply_update`); a new field is hydrated automatically once it has an `apply_update` arm. No schema/migration change (the `settings` table is `key/value`).
- Never break the pause/resume concat invariant: every segment must produce byte-identical output stream params. The capture engine is therefore chosen **once** per recording and reused for every segment.
- The ffmpeg sidecar's event channel is capacity-1: do not add reads of it. `-nostats -loglevel error` must remain in every args build.
- Green gate before each merge/commit of a completed sub-feature: from `glint/src-tauri` run `cargo clippy --all-targets` (0 warnings) and `cargo test`; from `glint` run `npx tsc --noEmit` and `npx vitest run`.
- Commit message trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```

---

## File Structure

- `glint/src-tauri/src/settings/mod.rs` — add `webcam_device_id: String` field, default, `apply_update` arm, tests (§1).
- `glint/src/store/useAppStore.ts` — add `webcam_device_id` to `Settings` + `setWebcamDevice` setter (§1).
- `glint/src/views/settings/Recording.tsx` — add the **Camera** dropdown that enumerates devices (§1).
- `glint/src/recorder/RecCam.tsx` — read persisted `deviceId`, pass to `getUserMedia`, fall back on failure (§1).
- `glint/src-tauri/src/recorder/ffmpeg.rs` — re-voiced `MIC_FX` (§3); `CaptureEngine` enum + engine-aware `build_ffmpeg_args` with the `ddagrab` path + tests (§2).
- `glint/src-tauri/src/recorder/mod.rs` — cached `ddagrab` probe; thread `engine` through `recorder_start` → `spawn_segment` → `build_ffmpeg_args`; store `engine` on `ActiveRecording` so resume matches (§2).

---

## Task 1: Settings field `webcam_device_id` (Rust, §1)

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (struct field ~line 64, default ~line 91, `apply_update` arm ~line 183, tests)

**Interfaces:**
- Produces: `Settings.webcam_device_id: String` (default `""` = system default camera); `apply_update(s, "webcam_device_id", <string>)`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `glint/src-tauri/src/settings/mod.rs`:

```rust
    #[test]
    fn default_webcam_device_is_empty() {
        assert_eq!(Settings::default().webcam_device_id, "");
    }

    #[test]
    fn apply_update_sets_webcam_device_id() {
        let mut s = Settings::default();
        apply_update(&mut s, "webcam_device_id", json!("abc123")).unwrap();
        assert_eq!(s.webcam_device_id, "abc123");
    }

    #[test]
    fn apply_update_rejects_non_string_webcam_device_id() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "webcam_device_id", json!(5)).is_err());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `glint/src-tauri`): `cargo test webcam_device`
Expected: FAIL — `no field webcam_device_id` / unknown key.

- [ ] **Step 3: Add the field, default, and apply_update arm**

In `struct Settings` (after `record_fps: u32,`):
```rust
    /// Preferred webcam deviceId (browser MediaDevices id). Empty = system default camera.
    pub webcam_device_id: String,
```

In `impl Default for Settings` (after `record_fps: 60,`):
```rust
            webcam_device_id: String::new(),
```

In `apply_update`, before the `other =>` arm:
```rust
        "webcam_device_id" => {
            s.webcam_device_id =
                value.as_str().ok_or("webcam_device_id must be string")?.to_string();
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run (in `glint/src-tauri`): `cargo test webcam_device`
Expected: PASS (3 tests). Also run `cargo test roundtrips_through_json` — PASS (the new field serializes).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs
git commit -m "feat(p19): webcam_device_id setting (Rust field + validation)"
```

---

## Task 2: Camera dropdown in Settings (frontend, §1)

**Files:**
- Modify: `glint/src/store/useAppStore.ts` (`Settings` interface ~line 37, `AppState` setter decl ~line 67, setter impl ~line 255)
- Modify: `glint/src/views/settings/Recording.tsx`

**Interfaces:**
- Consumes: `saveSetting("webcam_device_id", string)`, `persistSetting(...)` (existing helpers in `lib/ipc.ts`).
- Produces: store `settings.webcam_device_id: string`; `setWebcamDevice(id: string): Promise<void>`.

- [ ] **Step 1: Add the store field + setter**

In `useAppStore.ts` `interface Settings`, after `record_fps: 30 | 60;`:
```ts
  webcam_device_id: string;
```
In `interface AppState`, after `setRecordFps: (v: 30 | 60) => Promise<void>;`:
```ts
  setWebcamDevice: (id: string) => Promise<void>;
```
After the `setRecordFps` implementation (the block ending at line ~255), add:
```ts
  setWebcamDevice: async (id: string) => {
    const updated = await saveSetting("webcam_device_id", id);
    await persistSetting("webcam_device_id", id);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 2: Verify types compile**

Run (in `glint`): `npx tsc --noEmit`
Expected: PASS (no errors). If `saveSetting`'s key union complains, it's keyed on `keyof Settings` — the new field makes `"webcam_device_id"` valid.

- [ ] **Step 3: Add the Camera dropdown to Recording.tsx**

At the top of `glint/src/views/settings/Recording.tsx`, add imports and a small hook that enumerates cameras. Replace the import line and add `useEffect/useState`:

```tsx
import { useEffect, useState } from "react";
import { Section, Field, Select, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
```

Inside `export function Recording() {`, after the existing `const set... = useAppStore(...)` lines, add:

```tsx
  const setWebcamDevice = useAppStore((s) => s.setWebcamDevice);

  // Enumerate cameras. Browsers only reveal device LABELS after camera permission
  // has been granted once; until then we show generic names + a hint.
  const [cams, setCams] = useState<{ deviceId: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => {
        if (!alive) return;
        const vids = list.filter((d) => d.kind === "videoinput");
        setCams(vids.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const cameraOptions = [
    { value: "", label: "System default" },
    ...cams.filter((c) => c.deviceId).map((c) => ({ value: c.deviceId, label: c.label })),
  ];
  const camsHaveLabels = cams.some((c) => c.label && !c.label.startsWith("Camera "));
```

Then add a **Camera** `Field` inside the `<Section>` — place it just above the "Record webcam" field:

```tsx
      <Field
        label="Camera"
        hint={
          camsHaveLabels
            ? "Which webcam the bubble uses."
            : "Which webcam the bubble uses. Names appear after the camera is used once."
        }
      >
        <Select
          value={settings?.webcam_device_id ?? ""}
          options={cameraOptions}
          onChange={(v) => void setWebcamDevice(v)}
        />
      </Field>
```

- [ ] **Step 4: Verify types + build compile**

Run (in `glint`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke (documented, not automated)**

Launch `npm run tauri dev`, open Settings › Recording. Confirm: the Camera dropdown lists "System default" (+ any cameras), selecting persists (reopen Settings — selection sticks). Real names may only appear after the first webcam session (expected).

- [ ] **Step 6: Commit**

```bash
git add glint/src/store/useAppStore.ts glint/src/views/settings/Recording.tsx
git commit -m "feat(p19): camera device picker in Settings (enumerate + persist)"
```

---

## Task 3: RecCam consumes the chosen camera (frontend, §1)

**Files:**
- Modify: `glint/src/recorder/RecCam.tsx`

**Interfaces:**
- Consumes: `invoke("settings_get_all")` → returns full `Settings` incl. `webcam_device_id`. (RecCam is a separate window with no Zustand hydration; read the backend directly.)

- [ ] **Step 1: Read the saved deviceId and use it, with fallback**

In `RecCam.tsx`, replace the `useEffect` body's `getUserMedia` call so it first resolves the saved id, requests it with `exact`, and retries with the default camera if that specific device is gone. Replace the effect (lines ~16-39) with:

```tsx
  useEffect(() => {
    // See note below: do NOT register onCloseRequested here.
    let cancelled = false;

    const attach = (s: MediaStream) => {
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
      emit("rec-cam-ready").catch(() => {});
    };

    const openDefault = () =>
      navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(attach);

    (async () => {
      let deviceId = "";
      try {
        const s = await invoke<{ webcam_device_id?: string }>("settings_get_all");
        deviceId = s?.webcam_device_id ?? "";
      } catch {
        deviceId = "";
      }
      try {
        if (deviceId) {
          await navigator.mediaDevices
            .getUserMedia({ video: { deviceId: { exact: deviceId } }, audio: false })
            .then(attach)
            .catch(async () => {
              // Saved camera unplugged/unavailable — fall back to the default.
              emit("glint-toast", "Saved camera unavailable — using default").catch(() => {});
              await openDefault();
            });
        } else {
          await openDefault();
        }
      } catch {
        emit("rec-cam-failed").catch(() => {});
        emit("glint-toast", "Camera unavailable").catch(() => {});
        getCurrentWindow().destroy().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);
```

(`invoke` is already imported in this file. Keep the surrounding component, `cycleSize`, `close`, and JSX unchanged.)

- [ ] **Step 2: Verify types compile**

Run (in `glint`): `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke (documented)**

With two cameras available: pick the non-default in Settings, start a webcam recording, confirm the bubble shows the chosen camera. Then unplug/disable it, record again → bubble falls back to default + a toast (never black).

- [ ] **Step 4: Commit**

```bash
git add glint/src/recorder/RecCam.tsx
git commit -m "feat(p19): webcam bubble uses the chosen camera (exact deviceId + fallback)"
```

---

## Task 4: Re-voice the mic EQ for fuller, less-muffled voice (Rust, §3)

**Files:**
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (`MIC_FX` const ~line 102; the `mic_gets_voice_eq_system_does_not` test ~line 249)

**Interfaces:**
- Produces: new `MIC_FX` constant string (mic-only voice chain). Signature of `build_ffmpeg_args` unchanged in this task.

**Rationale (keep in a code comment):** the old chain cut −2 dB @ 400 Hz (thins the voice) and made a fixed +3 dB bell @ 3.5 kHz (sounds processed). The new chain keeps the 80 Hz high-pass (rumble), adds a gentle +1.5 dB warmth shelf around 200 Hz (body → "fuller"), and a gentle +3 dB high shelf at 7.5 kHz (air/clarity → fixes "muffled"). Mono-safe downmix retained (`c0=c0|c1=c0`) — referencing `c1` would error on truly-mono mics and would one-side a mono-on-left mic.

- [ ] **Step 1: Update the test to assert the new chain (write it first)**

In `ffmpeg.rs`, replace the `mic_gets_voice_eq_system_does_not` test's `FX` constant and assertions with the new chain:

```rust
    #[test]
    fn mic_gets_voice_eq_system_does_not() {
        const FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=200:width_type=o:width=1.2:g=1.5,treble=g=3:f=7500:width_type=q:width=0.7";
        // Single mic source: cleanup inline before the format normalize.
        let m = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai_mic(48000)], true, true);
        assert!(m.iter().any(|s| *s == format!("[1:a]aresample=async=1,{FX},aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
        // System (input 1) passes through; mic (input 2) is pre-filtered then mixed.
        let both = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai_mic(48000)], true, true);
        assert!(both.iter().any(|s| *s == format!("[2:a]{FX}[m2];[1:a][m2]amix=inputs=2:duration=longest:normalize=0,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
    }

    #[test]
    fn mic_fx_has_no_body_cut() {
        // Regression guard: the -2 dB @ 400 Hz cut (which thinned the voice) is gone.
        let m = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai_mic(48000)], true, true);
        assert!(!m.iter().any(|s| s.contains("f=400") && s.contains("g=-2")));
        // Air shelf present (fixes "muffled").
        assert!(m.iter().any(|s| s.contains("treble=g=3:f=7500")));
    }
```

- [ ] **Step 2: Run to verify failure**

Run (in `glint/src-tauri`): `cargo test mic_`
Expected: FAIL (old `MIC_FX` still has `f=400 g=-2` and `f=3500`).

- [ ] **Step 3: Replace the MIC_FX constant**

In `ffmpeg.rs`, replace the `MIC_FX` constant (and update its doc comment):
```rust
    // Voice cleanup applied to the MIC only (system audio passes through clean):
    //  • pan=stereo|c0=c0|c1=c0 — mono-safe dual-mono from c0 (works for mono OR
    //    stereo-presented mics; referencing c1 would error on a truly-mono input).
    //  • highpass 80 Hz — de-rumble.
    //  • +1.5 dB shelf ~200 Hz — restore body/warmth ("fuller").
    //  • +3 dB high shelf @ 7.5 kHz — air/clarity (fixes "muffled") without a
    //    fixed presence bell that sounded processed.
    const MIC_FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=200:width_type=o:width=1.2:g=1.5,treble=g=3:f=7500:width_type=q:width=0.7";
```

- [ ] **Step 4: Run to verify pass**

Run (in `glint/src-tauri`): `cargo test mic_`
Expected: PASS. Then run the whole ffmpeg test module: `cargo test --lib recorder::ffmpeg` — PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs
git commit -m "feat(p19): re-voice mic EQ — warmth + air, drop the thinning body cut"
```

---

## Task 5: Engine-aware `build_ffmpeg_args` with the ddagrab path (Rust, §2a)

**Files:**
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (`build_ffmpeg_args` signature + body; all existing tests gain the engine arg; new ddagrab tests)

**Interfaces:**
- Produces:
  ```rust
  #[derive(Clone, Copy, Debug, PartialEq, Eq)]
  pub enum CaptureEngine { Gdigrab, Ddagrab }
  pub fn build_ffmpeg_args(engine: CaptureEngine, target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput], want_audio: bool, draw_mouse: bool) -> Vec<String>
  ```
- Consumes: `MIC_FX` (Task 4).

**Note on the audio-input index shift:** gdigrab makes video input 0 and audio inputs start at 1 (`[1:a]`). ddagrab is a *source filter* (no `-i` for video), so audio inputs start at 0 (`[0:a]`). The audio graph is built against a `base` index (1 for gdigrab, 0 for ddagrab). The ddagrab video chain and the audio graph are combined into one `-filter_complex` (separated by `;`).

- [ ] **Step 1: Write the new ddagrab tests (and update existing gdigrab tests to pass the engine)**

First, update EVERY existing call to `build_ffmpeg_args` in the `tests` module to pass `CaptureEngine::Gdigrab` as the new first argument (they assert the gdigrab path is unchanged). For example `build_ffmpeg_args(&RecordTarget::Fullscreen, 30, ...)` becomes `build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, ...)`. Add `use super::CaptureEngine;` is not needed (same module via `use super::*`).

Then add new ddagrab tests:

```rust
    #[test]
    fn ddagrab_fullscreen_uses_filter_source_no_gdigrab() {
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 60, "C:/o.mp4", &[], false, true);
        // No gdigrab, no "-i desktop"; a d3d11 device is initialized.
        assert!(!a.iter().any(|s| s == "gdigrab"));
        assert!(!a.iter().any(|s| s == "desktop"));
        assert!(a.windows(2).any(|w| w[0] == "-init_hw_device" && w[1] == "d3d11va"));
        // The filter_complex carries a ddagrab source at 60 fps + hwdownload to bgra, labelled [v].
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("ddagrab=output_idx=0"));
        assert!(fc.contains("framerate=60"));
        assert!(fc.contains("hwdownload,format=bgra[v]"));
        // Video is mapped from the filter output.
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        // Same encode tail as gdigrab (concat-copy homogeneity).
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert_eq!(a.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn ddagrab_region_puts_crop_in_the_source() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &t, 30, "C:/r.mp4", &[], false, true);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("video_size=640x480"));
        assert!(fc.contains("offset_x=100"));
        assert!(fc.contains("offset_y=50"));
    }

    #[test]
    fn ddagrab_draw_mouse_flag_maps_to_source_option() {
        let on = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, true);
        let off = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, false);
        let fc = |a: &[String]| a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc(&on).contains("draw_mouse=1"));
        assert!(fc(&off).contains("draw_mouse=0"));
    }

    #[test]
    fn ddagrab_with_audio_combines_v_and_aout_and_shifts_index() {
        // ddagrab has no video input, so the single audio pipe is input 0 → [0:a].
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 60, "C:/o.mp4", &[ai(48000)], true, true);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("hwdownload,format=bgra[v]"));
        assert!(fc.contains("[0:a]aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
        assert!(a.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
    }

    #[test]
    fn ddagrab_no_audio_still_maps_video() {
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        assert!(!a.iter().any(|s| s == "-c:a"));
    }
```

- [ ] **Step 2: Run to verify failure**

Run (in `glint/src-tauri`): `cargo test --lib recorder::ffmpeg`
Expected: FAIL to COMPILE first (existing calls miss the `engine` arg until updated in Step 1; the new `CaptureEngine` type doesn't exist yet). After adding the arg to existing calls, the new tests FAIL (function still has old signature).

- [ ] **Step 3: Implement the engine-aware builder**

In `ffmpeg.rs`, add the enum above `build_ffmpeg_args`:
```rust
/// Which desktop-capture engine ffmpeg uses. `Ddagrab` (D3D11/GPU, true 60 fps) is
/// preferred; `Gdigrab` (GDI/CPU) is the fallback for setups where DDA can't init.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureEngine {
    Gdigrab,
    Ddagrab,
}
```

Replace the whole `build_ffmpeg_args` function with the engine-aware version. Keep `AFMT`, `MIC_FX`, and the `audio_tail` intent, but route audio input indices through a `base` and combine filter graphs:

```rust
pub fn build_ffmpeg_args(
    engine: CaptureEngine,
    target: &RecordTarget,
    fps: u32,
    out: &str,
    audio: &[AudioInput],
    want_audio: bool,
    draw_mouse: bool,
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
    ];

    // Video input flags + the index of the first audio input. gdigrab is a real
    // input (0) → audio starts at 1. ddagrab is a filter SOURCE (no -i) → audio
    // starts at 0.
    let audio_base: usize = match engine {
        CaptureEngine::Gdigrab => {
            a.extend(["-f".into(), "gdigrab".into(), "-framerate".into(), fps.to_string()]);
            if !draw_mouse {
                a.extend(["-draw_mouse".into(), "0".into()]);
            }
            if let RecordTarget::Region { x, y, w, h } = target {
                a.extend([
                    "-offset_x".into(), x.to_string(),
                    "-offset_y".into(), y.to_string(),
                    "-video_size".into(), format!("{w}x{h}"),
                ]);
            }
            a.extend(["-i".into(), "desktop".into()]);
            1
        }
        CaptureEngine::Ddagrab => {
            a.extend(["-init_hw_device".into(), "d3d11va".into()]);
            0
        }
    };

    // Audio pipe inputs (input `audio_base`..).
    for ai in audio {
        a.extend([
            "-thread_queue_size".into(), "1024".into(),
            "-f".into(), "f32le".into(),
            "-ar".into(), ai.sample_rate.to_string(),
            "-ac".into(), ai.channels.to_string(),
            "-i".into(), ai.pipe_path.clone(),
        ]);
    }
    let silent_pad = audio.is_empty() && want_audio;
    if silent_pad {
        a.extend([
            "-f".into(), "lavfi".into(),
            "-i".into(), "anullsrc=channel_layout=stereo:sample_rate=48000".into(),
        ]);
    }

    // ddagrab video chain (source filter → system-memory bgra → [v]).
    let ddagrab_vchain = match engine {
        CaptureEngine::Ddagrab => {
            let mut src = format!(
                "ddagrab=output_idx=0:draw_mouse={}:framerate={}",
                if draw_mouse { 1 } else { 0 },
                fps
            );
            if let RecordTarget::Region { x, y, w, h } = target {
                src.push_str(&format!(":video_size={w}x{h}:offset_x={x}:offset_y={y}"));
            }
            Some(format!("{src},hwdownload,format=bgra[v]"))
        }
        CaptureEngine::Gdigrab => None,
    };

    // Video codec (unchanged; identical across engines → concat-copy safe).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio filter graph producing [aout], or None. Input indices use `audio_base`.
    let audio_fc = audio_graph(audio, silent_pad, audio_base);
    let has_audio = audio_fc.is_some();

    // Combine video (ddagrab) + audio graphs into one -filter_complex, and map.
    match (ddagrab_vchain, audio_fc) {
        (Some(v), Some(af)) => a.extend([
            "-filter_complex".into(), format!("{v};{af}"),
            "-map".into(), "[v]".into(),
            "-map".into(), "[aout]".into(),
        ]),
        (Some(v), None) => a.extend([
            "-filter_complex".into(), v,
            "-map".into(), "[v]".into(),
        ]),
        (None, Some(af)) => a.extend([
            "-filter_complex".into(), af,
            "-map".into(), "0:v".into(),
            "-map".into(), "[aout]".into(),
        ]),
        (None, None) => {
            // gdigrab, no audio: single video stream auto-maps; no filter, no map.
        }
    }
    if has_audio {
        a.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    }

    a.extend(["-movflags".into(), "+faststart".into(), out.into()]);
    a
}

/// Build the mic/system audio filter graph producing `[aout]`, or `None` when there is
/// no audio. Input labels start at `base` (1 for gdigrab, 0 for ddagrab). Every output
/// is normalized to stereo/48 kHz so aac params are byte-identical across segments.
fn audio_graph(audio: &[AudioInput], silent_pad: bool, base: usize) -> Option<String> {
    const AFMT: &str = "aformat=sample_rates=48000:channel_layouts=stereo";
    const MIC_FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=200:width_type=o:width=1.2:g=1.5,treble=g=3:f=7500:width_type=q:width=0.7";

    if silent_pad {
        return Some(format!("[{base}:a]{AFMT}[aout]"));
    }
    match audio.len() {
        0 => None,
        1 => {
            let fx = if audio[0].is_mic { format!(",{MIC_FX}") } else { String::new() };
            Some(format!("[{base}:a]aresample=async=1{fx},{AFMT}[aout]"))
        }
        n => {
            let mut chains = String::new();
            let mut labels = String::new();
            for (idx, ai) in audio.iter().enumerate() {
                let i = idx + base;
                if ai.is_mic {
                    chains.push_str(&format!("[{i}:a]{MIC_FX}[m{i}];"));
                    labels.push_str(&format!("[m{i}]"));
                } else {
                    labels.push_str(&format!("[{i}:a]"));
                }
            }
            Some(format!("{chains}{labels}amix=inputs={n}:duration=longest:normalize=0,aresample=async=1,{AFMT}[aout]"))
        }
    }
}
```

Delete the now-unused old inline `AFMT`/`MIC_FX`/`audio_tail`/`silent_pad`-branch code that this replaces (the whole previous audio section). `even()` and `AudioInput` stay.

- [ ] **Step 4: Run to verify pass**

Run (in `glint/src-tauri`): `cargo test --lib recorder::ffmpeg`
Expected: PASS — all existing gdigrab tests (now with the engine arg) AND the new ddagrab tests. The gdigrab assertions prove that path is byte-identical to before.

- [ ] **Step 5: Fix the one non-test caller so the crate compiles**

`recorder/mod.rs:189` calls `build_ffmpeg_args(&target, fps, ...)`. Temporarily pass `CaptureEngine::Gdigrab` to keep behavior identical until Task 6 wires the real engine:
```rust
    let args = ffmpeg::build_ffmpeg_args(ffmpeg::CaptureEngine::Gdigrab, &target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse);
```

- [ ] **Step 6: Full Rust gate**

Run (in `glint/src-tauri`): `cargo clippy --all-targets` (0 warnings) then `cargo test`.
Expected: PASS. Behavior is unchanged at runtime (still gdigrab); only the arg-builder gained the tested ddagrab path.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p19): engine-aware ffmpeg args with tested ddagrab path (not yet active)"
```

---

## Task 6: Activate ddagrab with cached probe + gdigrab fallback (Rust, §2b)

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add probe fn; `ActiveRecording` gains `engine`; `recorder_start` chooses engine; `spawn_segment` takes + forwards engine; `recorder_resume` reuses stored engine)

**Interfaces:**
- Consumes: `ffmpeg::CaptureEngine`, `ffmpeg::build_ffmpeg_args` (Task 5).
- Produces: `fn probe_capture_engine(app: &AppHandle) -> ffmpeg::CaptureEngine` (cached per session); `ActiveRecording.engine: ffmpeg::CaptureEngine`.

**Design:** A one-shot cached probe runs ffmpeg with a ddagrab source rendering a single frame to the null muxer; success → `Ddagrab`, else `Gdigrab`. The result is cached in a process-wide `OnceLock` so only the first recording of a session pays the ~1–2 s probe. The engine is stored on `ActiveRecording` and reused for every pause/resume segment (concat-copy invariant).

- [ ] **Step 1: Add the cached probe function**

Near the top of `mod.rs` (after imports), add:

```rust
/// Cached, session-wide result of the ddagrab support probe.
static DDAGRAB_OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Decide the capture engine once per session. Runs ffmpeg with a ddagrab source
/// producing a single frame to the null muxer; if that exits 0, DDA works on this
/// machine/session (GPU present, not an RDP/headless surface) → use ddagrab. Any
/// failure/timeout → gdigrab. Cached so only the first recording pays the cost.
fn probe_capture_engine(app: &AppHandle) -> ffmpeg::CaptureEngine {
    let ok = *DDAGRAB_OK.get_or_init(|| {
        let sidecar = match app.shell().sidecar("ffmpeg") {
            Ok(s) => s,
            Err(_) => return false,
        };
        let args = [
            "-nostats", "-loglevel", "error",
            "-init_hw_device", "d3d11va",
            "-filter_complex", "ddagrab=output_idx=0:framerate=30,hwdownload,format=bgra",
            "-frames:v", "1", "-f", "null", "-",
        ];
        // Blocking, bounded: this runs off the main thread (recorder_start is async and
        // we call it before the countdown). Use the std Command from the resolved
        // sidecar path to keep it simple and synchronous.
        match sidecar.args(args).output() {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    });
    if ok { ffmpeg::CaptureEngine::Ddagrab } else { ffmpeg::CaptureEngine::Gdigrab }
}
```

Note: `sidecar.args(...).output()` is `tauri_plugin_shell::process::Command::output()` (async). If the resolved sidecar type here is the async command, make `probe_capture_engine` `async` and `.await` the `output()`, then `.await` it from `recorder_start`. Match whichever `spawn`/`output` API `app.shell().sidecar(...)` exposes in this codebase (Task 5 left `spawn()` in use at line 191). If only `spawn()` is available, implement the probe by `spawn()` + awaiting the child's terminated event with a `tokio::time::timeout(2s, …)` and checking the exit code.

- [ ] **Step 2: Add `engine` to `ActiveRecording` and thread it through**

Find `struct ActiveRecording` (around line 60-90) and add a field:
```rust
    pub engine: ffmpeg::CaptureEngine,
```

In `recorder_start`, after `let fps = … .record_fps;` (line ~556), choose the engine once:
```rust
    let engine = probe_capture_engine(&app); // (await if you made it async)
```
Populate it in the `ActiveRecording { … }` initializer (line ~645) — add `engine,`.

Change `spawn_segment`'s signature to accept the engine and forward it to the builder:
```rust
async fn spawn_segment(
    app: &AppHandle,
    engine: ffmpeg::CaptureEngine,
    target: RecordTarget,
    fps: u32,
    path: &str,
    seg_index: usize,
    cfg: AudioConfig,
    controls: &AudioControls,
    draw_mouse: bool,
) -> Result<Segment, String> {
```
And at line ~189 use it:
```rust
    let args = ffmpeg::build_ffmpeg_args(engine, &target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse);
```

Update the seg0 call in `recorder_start` (line ~668):
```rust
    let seg0 = match spawn_segment(&app, engine, target, fps, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
```

- [ ] **Step 3: Make resume reuse the stored engine**

In `recorder_resume` (find where it calls `spawn_segment`), read the engine from the active recording and pass it, so a resumed segment matches segment 0 exactly. Locate the `spawn_segment(` call inside resume and add the stored `engine` argument (read it from the `ActiveRecording` under the lock before spawning, alongside how `target`/`fps` are already read there).

- [ ] **Step 4: Compile + full Rust gate**

Run (in `glint/src-tauri`): `cargo clippy --all-targets` (0 warnings), then `cargo test`.
Expected: PASS. Clippy must be clean (e.g. if the probe is sync-in-async, no `.await` warnings).

- [ ] **Step 5: Manual verification (documented, required for §2)**

Launch `npm run tauri dev`:
1. Record fullscreen at 60 fps → confirm the file plays smoothly and `ffprobe` reports ~60 fps (`ffprobe -v error -select_streams v -show_entries stream=avg_frame_rate <file>`).
2. Record a region → confirm correct crop offset/size.
3. Pause/resume mid-recording → confirm the final concatenated file is intact (proves segments share stream params).
4. Confirm the FX pointer/keystroke overlay still appears in the recording.
5. Fallback: temporarily force the probe to return `Gdigrab` (or run under an RDP session) → confirm recording still works.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p19): capture via ddagrab (true 60fps) with cached probe + gdigrab fallback"
```

---

## Final integration & merge

- [ ] Run the full green gate from a clean tree: `glint/src-tauri` → `cargo clippy --all-targets` (0 warnings) + `cargo test`; `glint` → `npx tsc --noEmit` + `npx vitest run`.
- [ ] Manual end-to-end pass covering all three sub-features (camera pick persists + used; 60 fps smooth; mic A/B sounds fuller/clearer; fallbacks work).
- [ ] Add a **Phase 19** entry to `docs/superpowers/ROADMAP.md` (move the three deferred recorder items from "Planned" into a shipped Phase 19 bullet).
- [ ] Merge `phase-19-recorder-fidelity` → `master` with `--no-ff` (present to the user for at-screen sign-off before merging, per the established cadence).

---

## Self-Review

**Spec coverage:**
- §1 webcam picker → Tasks 1 (Rust field), 2 (Settings dropdown + enumerate + labels-after-permission hint), 3 (RecCam exact-deviceId + unplugged fallback). ✔ Covers persistence, permission-gated labels, stale-device fallback.
- §2 ddagrab 60 fps → Tasks 5 (tested engine-aware builder incl. region crop, draw_mouse, hwdownload, audio-index shift, unchanged gdigrab) + 6 (cached probe, engine locked across segments, gdigrab fallback, FX-overlay/pause-resume verified). ✔
- §3 mic fidelity → Task 4 (re-voiced EQ: warmth + air, drop thinning cut, mono-safe). ✔ Note: spec §3.2 "preserve true stereo" was superseded by a mono-safe downmix — documented rationale (one-sided-audio + channel-count-error avoidance); §3.1 "best shared format" is already satisfied by existing `audio.rs` (captures device mix format) — no code change needed, called out here so it isn't mistaken for a gap.

**Placeholder scan:** No TBD/TODO. The one conditional ("if the sidecar exposes only `spawn()`, implement the probe via spawn+timeout") is an explicit either/or with both branches specified, not a placeholder.

**Type consistency:** `CaptureEngine` used identically in Tasks 5 and 6; `build_ffmpeg_args` first-arg `engine` consistent across builder, `spawn_segment`, and both `recorder_start`/`recorder_resume` call sites; `audio_graph(audio, silent_pad, base)` signature matches its one caller; `webcam_device_id` (snake_case) consistent across Rust field, `apply_update` key, TS `Settings`, `saveSetting`/`persistSetting` calls, and `settings_get_all` read in RecCam.
