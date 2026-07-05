# Phase 22 — GPU H.264 encode · webcam shapes · app-wide accent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move H.264 encoding onto the GPU during recording, add four webcam bubble shapes (circle/rounded/square/rect), and make the accent color reach every window.

**Architecture:** Three independent tracks. Track A adds a session-cached `VideoEncoder` probe (mirroring the existing ddagrab `CaptureEngine` probe) that picks NVENC/QSV/AMF once per session and locks it for the recording, with a libx264 fallback. Track B threads a `webcam_shape` through settings → live bubble → `.cam.json` → trim overlay → a single rounded-rect `geq` export mask. Track C replaces pure-hardcoded accent hexes with `var(--accent)` in three stylesheets.

**Tech Stack:** Rust (Tauri v2, `tauri-plugin-shell` ffmpeg sidecar), React 19 + TypeScript, Vitest, `cargo test`.

## Global Constraints

- **Recorder isolation:** all Rust changes live in `recorder/` (`ffmpeg.rs`, `mod.rs`, `cam.rs`, `trim.rs`) + `settings/`; import nothing from capture/editor/overlay/ocr into recorder. Track C touches only `.css`.
- **No new dependencies** (Cargo or npm).
- **Concat-copy invariant:** every recording segment must use the SAME video encoder and produce **H.264 / yuv420p**, so pause/resume `-c copy` concat stays valid. The encoder is chosen once per recording and locked.
- **Byte-identity guards:** the `libx264` encoder tail must stay byte-identical to today; the trim export must stay byte-identical when no webcam is present.
- **Green gate before merge:** from `glint/src-tauri` — `cargo clippy --all-targets` (0 warnings) + `cargo test`; from `glint` — `npx tsc --noEmit` + `npx vitest run`.
- **Commit trailer on every commit:**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```
- **Branch:** `phase-22-gpu-encode-cam-shapes-accent` (already created off `master`). Merge back with `--no-ff` after at-screen acceptance.

---

## File Structure

**Track A (encoder):**
- `glint/src-tauri/src/recorder/ffmpeg.rs` — add `VideoEncoder` enum + `encoder_args()`; `build_ffmpeg_args` takes `encoder`.
- `glint/src-tauri/src/recorder/mod.rs` — `VIDEO_ENCODER` OnceLock + `probe_video_encoder`; `ActiveRecording.encoder`; thread into `spawn_segment`; segment-0 fallback.
- `glint/src-tauri/src/tray.rs` — no signature change (calls `recorder_start`, not `build_ffmpeg_args`), verify only.

**Track B (shapes):**
- `glint/src-tauri/src/settings/mod.rs` — `webcam_shape` field + validation + tests.
- `glint/src/store/useAppStore.ts` — `webcamShape` in Settings + `setWebcamShape`.
- `glint/src/recorder/camOverlay.ts` — `CamShape`, aspect-aware `toPixels` returning `{x,y,w,h}`, `shapeAspect`.
- `glint/src/recorder/RecCam.tsx` + `glint/src/recorder/recorder.css` — live bubble shape.
- `glint/src/recorder/RegionSelect.tsx` — shape-cycle control.
- `glint/src-tauri/src/recorder/cam.rs` — persist/read `shape` in `.cam.json`.
- `glint/src-tauri/src/recorder/trim.rs` — `ProbeResult.cam_shape`; `CamOverlay{x,y,w,h,shape}`; rounded-rect mask helper.
- `glint/src/recorder/TrimCamOverlay.tsx` + `glint/src/recorder/TrimView.tsx` + `glint/src/lib/trim.ts` — render shape + shape control + pass overlay.

**Track C (accent):**
- `glint/src/ocr/ocr.css`, `glint/src/recorder/recorder.css`, `glint/src/recorder/trim.css`.

---

## Track A — Hardware H.264 encoder

### Task A1: `VideoEncoder` enum + pure `encoder_args()`

**Files:**
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs`
- Test: same file `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `pub enum VideoEncoder { Libx264, Nvenc, Qsv, Amf }` and `pub fn encoder_args(enc: VideoEncoder) -> Vec<String>` returning the `-c:v … -pix_fmt yuv420p` tail.

- [ ] **Step 1: Write the failing tests** — add to the `tests` module in `ffmpeg.rs`:

```rust
#[test]
fn encoder_args_libx264_is_unchanged_tail() {
    assert_eq!(
        encoder_args(VideoEncoder::Libx264),
        vec![
            "-c:v".to_string(), "libx264".into(),
            "-preset".into(), "ultrafast".into(),
            "-pix_fmt".into(), "yuv420p".into(),
        ]
    );
}

#[test]
fn encoder_args_hw_encoders_are_yuv420p_h264() {
    for (enc, name) in [
        (VideoEncoder::Nvenc, "h264_nvenc"),
        (VideoEncoder::Qsv, "h264_qsv"),
        (VideoEncoder::Amf, "h264_amf"),
    ] {
        let a = encoder_args(enc);
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == name), "{name} -c:v");
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"), "{name} pix_fmt");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test encoder_args`
Expected: FAIL — `cannot find function encoder_args` / `VideoEncoder`.

- [ ] **Step 3: Implement** — add near `CaptureEngine` in `ffmpeg.rs`:

```rust
/// Which H.264 encoder ffmpeg uses. Hardware encoders (`Nvenc`/`Qsv`/`Amf`) offload the
/// encode from the CPU so full-resolution 60 fps capture keeps up; `Libx264` is the
/// universal CPU fallback. Chosen once per session (see `probe_video_encoder`) and locked
/// for a whole recording so pause/resume segments stay concat-copy compatible.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VideoEncoder {
    Libx264,
    Nvenc,
    Qsv,
    Amf,
}

/// The `-c:v …` encode tail for `encoder`. Every variant outputs H.264 / yuv420p so the
/// downstream muxer, segment concat, trim editor, and players are all unchanged. The
/// `Libx264` tail is byte-identical to the historical inline tail.
pub fn encoder_args(enc: VideoEncoder) -> Vec<String> {
    let s = |x: &str| x.to_string();
    let mut a = match enc {
        VideoEncoder::Libx264 => vec![s("-c:v"), s("libx264"), s("-preset"), s("ultrafast")],
        // p4 = balanced NVENC preset; vbr+cq 21 targets visually-transparent quality with
        // the GPU picking bitrate. b:v 0 lets cq drive rate control.
        VideoEncoder::Nvenc => vec![
            s("-c:v"), s("h264_nvenc"), s("-preset"), s("p4"),
            s("-rc"), s("vbr"), s("-cq"), s("21"), s("-b:v"), s("0"),
        ],
        VideoEncoder::Qsv => vec![
            s("-c:v"), s("h264_qsv"), s("-preset"), s("veryfast"), s("-global_quality"), s("21"),
        ],
        VideoEncoder::Amf => vec![
            s("-c:v"), s("h264_amf"), s("-quality"), s("balanced"),
            s("-rc"), s("cqp"), s("-qp_i"), s("21"), s("-qp_p"), s("21"),
        ],
    };
    a.extend([s("-pix_fmt"), s("yuv420p")]);
    a
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test encoder_args`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs
git commit -m "feat(p22): VideoEncoder enum + pure encoder_args tail builder"
```

---

### Task A2: `build_ffmpeg_args` takes the encoder; probe + session wiring

**Files:**
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (signature + call to `encoder_args`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (probe, `ActiveRecording.encoder`, `spawn_segment`, `recorder_start`)
- Test: `ffmpeg.rs` tests updated for the new arg

**Interfaces:**
- Consumes: `VideoEncoder`, `encoder_args` (A1).
- Produces: `build_ffmpeg_args(engine, target, fps, out, audio, want_audio, draw_mouse, encoder: VideoEncoder)`; `async fn probe_video_encoder(app: &AppHandle) -> VideoEncoder`.

- [ ] **Step 1: Update `build_ffmpeg_args`** — add the parameter (last position) and replace the inline libx264 tail. In `ffmpeg.rs`:

Change the signature to add `encoder: VideoEncoder,` after `draw_mouse: bool,`. Replace the block:

```rust
    // Video codec (identical across engines → concat-copy safe).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
```

with:

```rust
    // Video codec: the chosen encoder's tail (H.264/yuv420p for every variant → concat-copy
    // safe; the encoder is fixed for the whole recording).
    a.extend(encoder_args(encoder));
```

- [ ] **Step 2: Fix the existing tests** — every `build_ffmpeg_args(...)` call in `ffmpeg.rs` tests needs a trailing `VideoEncoder::Libx264`. Update each call, and add:

```rust
#[test]
fn nvenc_encoder_swaps_only_the_codec_tail() {
    let base = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 60, "o.mp4", &[], false, true, VideoEncoder::Libx264);
    let nv = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 60, "o.mp4", &[], false, true, VideoEncoder::Nvenc);
    assert!(base.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
    assert!(nv.windows(2).any(|w| w[0] == "-c:v" && w[1] == "h264_nvenc"));
    // Everything up to -c:v is identical (same capture front-end).
    let cut = |v: &[String]| v.iter().position(|x| x == "-c:v").unwrap();
    assert_eq!(base[..cut(&base)], nv[..cut(&nv)]);
}
```

Run: `cd glint/src-tauri && cargo test -p glint recorder::ffmpeg`
Expected: FAIL first (arg count mismatch) until all call sites are updated, then PASS.

- [ ] **Step 3: Add the probe to `mod.rs`** — near `DDAGRAB_OK` / `probe_capture_engine`:

```rust
/// Cached, session-wide chosen video encoder.
static VIDEO_ENCODER: std::sync::OnceLock<ffmpeg::VideoEncoder> = std::sync::OnceLock::new();

/// Decide the H.264 encoder once per session. Tries the hardware encoders in priority order
/// (NVENC → QSV → AMF) by encoding a few synthetic frames to the null muxer; the first that
/// exits 0 is used. Any failure/timeout falls through, and if none work → libx264 (CPU).
/// Cached so only the first recording pays the probe cost.
async fn probe_video_encoder(app: &AppHandle) -> ffmpeg::VideoEncoder {
    use ffmpeg::VideoEncoder as VE;
    if let Some(&e) = VIDEO_ENCODER.get() {
        return e;
    }
    // (encoder, its rate-control probe args)
    let candidates: [(VE, &[&str]); 3] = [
        (VE::Nvenc, &["h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "21", "-b:v", "0"]),
        (VE::Qsv, &["h264_qsv", "-preset", "veryfast", "-global_quality", "21"]),
        (VE::Amf, &["h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "21", "-qp_p", "21"]),
    ];
    let mut chosen = VE::Libx264;
    for (enc, cargs) in candidates {
        let Ok(cmd) = app.shell().sidecar("ffmpeg") else { continue };
        let mut args: Vec<&str> = vec![
            "-nostats", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=black:s=256x256:r=30",
            "-frames:v", "5", "-c:v",
        ];
        args.push(cargs[0]);
        args.extend(&cargs[1..]);
        args.extend(["-pix_fmt", "yuv420p", "-f", "null", "-"]);
        let ok = matches!(
            tokio::time::timeout(std::time::Duration::from_secs(4), cmd.args(args).output()).await,
            Ok(Ok(out)) if out.status.success()
        );
        if ok {
            chosen = enc;
            break;
        }
    }
    let _ = VIDEO_ENCODER.set(chosen);
    log::info!("video encoder probe: chose {chosen:?}");
    chosen
}
```

- [ ] **Step 4: Add `encoder` to `ActiveRecording`, pick it in `recorder_start`, thread it through `spawn_segment`.**

In the `ActiveRecording` struct (near `pub engine: ffmpeg::CaptureEngine,`) add:

```rust
    /// H.264 encoder chosen once at start; reused for every segment (concat-copy invariant).
    pub encoder: ffmpeg::VideoEncoder,
```

In `recorder_start`, right after `let engine = probe_capture_engine(&app).await;` add:

```rust
    let encoder = probe_video_encoder(&app).await;
```

Set `encoder,` in the `ActiveRecording { … }` initializer.

Change `spawn_segment`'s signature to take `encoder: ffmpeg::VideoEncoder` (add after `engine`), and update its `build_ffmpeg_args(engine, &target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse)` call to pass `encoder` as the final argument. Update every `spawn_segment(...)` call site (in `recorder_start` seg0 and `recorder_resume`) to pass the recording's `encoder` (from the `ActiveRecording` snapshot in resume, and the local `encoder` in start).

- [ ] **Step 5: Build + test**

Run: `cd glint/src-tauri && cargo test && cargo clippy --all-targets`
Expected: PASS, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p22): probe + wire GPU H.264 encoder into recording (locked per session)"
```

---

### Task A3: Segment-0 hardware fallback to libx264

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`recorder_start` seg0 handling)

**Interfaces:**
- Consumes: `VIDEO_ENCODER`, `spawn_segment` (A2).

- [ ] **Step 1: Implement the one-shot demotion.** In `recorder_start`, the seg0 spawn currently looks like:

```rust
    let seg0 = match spawn_segment(&app, engine, encoder, target, fps, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
        Ok(s) => s,
        Err(e) => { /* existing cleanup + return Err */ }
    };
```

Wrap it so a hardware-encoder failure demotes to libx264 and retries once before giving up. Replace the `match` with:

```rust
    let mut encoder = encoder;
    let seg0 = match spawn_segment(&app, engine, encoder, target, fps, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
        Ok(s) => s,
        Err(e) if encoder != ffmpeg::VideoEncoder::Libx264 => {
            // Hardware encoder passed the probe but failed to start a real segment — demote
            // the whole session to libx264 (overwrite the cache so resume segments match) and
            // retry once. Keeps the "recording never breaks" guarantee.
            log::warn!("segment 0 failed on {encoder:?} ({e}); falling back to libx264");
            encoder = ffmpeg::VideoEncoder::Libx264;
            // OnceLock is already set; use a Mutex-free override by re-reading in resume via
            // ActiveRecording.encoder (set below), so just proceed with the local value.
            match spawn_segment(&app, engine, encoder, target, fps, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
                Ok(s) => s,
                Err(e2) => { return Err(format!("recording failed to start: {e2}")); }
            }
        }
        Err(e) => { return Err(format!("recording failed to start: {e}")); }
    };
```

Note: because `encoder` is now `mut` and may have been demoted, ensure the `ActiveRecording { encoder, … }` initializer (which runs after seg0) uses this possibly-updated local `encoder` — so pause/resume segments inherit libx264 too. (If the struct is built before seg0 in the current code, move the `encoder` field assignment to after seg0, or assign `rec.encoder = encoder` before storing.)

- [ ] **Step 2: Build + clippy**

Run: `cd glint/src-tauri && cargo clippy --all-targets && cargo test`
Expected: PASS, 0 warnings. (Match the exact existing seg0 error-cleanup code — reuse whatever cleanup the current `Err` arm does rather than the simplified `return Err` shown above if it differs.)

- [ ] **Step 3: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p22): demote to libx264 and retry if the GPU encoder fails segment 0"
```

---

## Track B — Webcam shapes

### Task B1: `webcam_shape` setting (Rust + store)

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (field, default, `apply_update`, tests)
- Modify: `glint/src/store/useAppStore.ts` (Settings type, `setWebcamShape`, hydrate)

**Interfaces:**
- Produces: settings key `"webcam_shape"` ∈ `{"circle","rounded","square","rect"}`, default `"circle"`; TS `setWebcamShape(shape)`.

- [ ] **Step 1: Failing Rust test** — add to `settings/mod.rs` tests:

```rust
#[test]
fn default_webcam_shape_is_circle() {
    assert_eq!(Settings::default().webcam_shape, "circle");
}

#[test]
fn apply_update_sets_and_validates_webcam_shape() {
    let mut s = Settings::default();
    apply_update(&mut s, "webcam_shape", serde_json::json!("rounded")).unwrap();
    assert_eq!(s.webcam_shape, "rounded");
    assert!(apply_update(&mut s, "webcam_shape", serde_json::json!("triangle")).is_err());
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test webcam_shape`
Expected: FAIL — no field `webcam_shape`.

- [ ] **Step 3: Implement.** Add the field to `Settings` (after `webcam_device_id`):

```rust
    /// Webcam bubble shape: "circle" | "rounded" | "square" | "rect".
    pub webcam_shape: String,
```

Add to `Default`: `webcam_shape: "circle".into(),`. Add an `apply_update` arm:

```rust
        "webcam_shape" => {
            let v = value.as_str().ok_or("webcam_shape must be string")?;
            if !matches!(v, "circle" | "rounded" | "square" | "rect") {
                return Err("webcam_shape must be circle|rounded|square|rect".into());
            }
            s.webcam_shape = v.to_string();
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test webcam_shape`
Expected: PASS.

- [ ] **Step 5: Frontend store.** In `useAppStore.ts`: add `webcam_shape: string;` to the `Settings` interface; add `setWebcamShape: (shape: string) => Promise<void>;` to the store interface; implement it mirroring `setAccent`:

```ts
  setWebcamShape: async (shape: string) => {
    const updated = await saveSetting("webcam_shape", shape);
    await persistSetting("webcam_shape", shape);
    set({ settings: { ...updated, webcam_shape: shape } });
  },
```

In `loadSettings`, add `webcam_shape` to the DB-override block (next to `record_webcam`):

```ts
      const dbWebcamShape = await readSetting<string>("webcam_shape");
      if (dbWebcamShape) rustSettings.webcam_shape = dbWebcamShape;
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src/store/useAppStore.ts
git commit -m "feat(p22): webcam_shape setting (circle|rounded|square|rect)"
```

---

### Task B2: aspect-aware `camOverlay.ts`

**Files:**
- Modify: `glint/src/recorder/camOverlay.ts`
- Test: `glint/src/recorder/camOverlay.test.ts`

**Interfaces:**
- Produces: `type CamShape = "circle"|"rounded"|"square"|"rect"`; `CamPlacement` gains `shape: CamShape`; `shapeAspect(shape, videoAspect): number`; `toPixels(p, srcW, srcH, videoAspect)` returns `{ x, y, w, h }` (even).

- [ ] **Step 1: Failing tests** — add to `camOverlay.test.ts`:

```ts
import { shapeAspect, toPixels, DEFAULT_PLACEMENT } from "./camOverlay";

describe("shape aspect", () => {
  it("circle and square are 1:1 regardless of video", () => {
    expect(shapeAspect("circle", 16 / 9)).toBe(1);
    expect(shapeAspect("square", 16 / 9)).toBe(1);
  });
  it("rounded and rect follow the video aspect", () => {
    expect(shapeAspect("rounded", 16 / 9)).toBeCloseTo(16 / 9);
    expect(shapeAspect("rect", 4 / 3)).toBeCloseTo(4 / 3);
  });
});

describe("toPixels", () => {
  it("square placement → square even box", () => {
    const p = { ...DEFAULT_PLACEMENT, shape: "circle" as const, x: 0, y: 0, diameter: 0.25 };
    const r = toPixels(p, 1920, 1080, 16 / 9);
    expect(r.w).toBe(r.h); // 1:1 for circle
    expect(r.w % 2).toBe(0);
    expect(r.h % 2).toBe(0);
  });
  it("rect placement → wider-than-tall box on a 16:9 cam", () => {
    const p = { ...DEFAULT_PLACEMENT, shape: "rect" as const, x: 0, y: 0, diameter: 0.25 };
    const r = toPixels(p, 1920, 1080, 16 / 9);
    expect(r.w).toBeGreaterThan(r.h);
    expect(r.w % 2).toBe(0);
    expect(r.h % 2).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint && npx vitest run src/recorder/camOverlay.test.ts`
Expected: FAIL — `shapeAspect` not exported; `toPixels` arity.

- [ ] **Step 3: Implement.** Rewrite `camOverlay.ts`:

```ts
/** camOverlay.ts — pure geometry for the trim-editor webcam overlay. Placement is stored
 *  normalized (0..1) to the video frame. `diameter` is the box WIDTH as a fraction of the
 *  video width; the box HEIGHT follows the shape's aspect. `x,y` are the top-left corner. */
export type CamShape = "circle" | "rounded" | "square" | "rect";
export type CamPlacement = { x: number; y: number; diameter: number; visible: boolean; shape: CamShape };

export const MIN_D = 0.06;
export const MAX_D = 0.6;
const MARGIN = 0.03;

export const DEFAULT_PLACEMENT: CamPlacement = {
  diameter: 0.18,
  x: 1 - 0.18 - MARGIN,
  y: 1 - 0.18 - MARGIN,
  visible: true,
  shape: "circle",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The box width:height aspect for a shape. Circle/square are 1:1; rounded/rect follow the
 *  camera's native aspect so the picture isn't distorted. */
export function shapeAspect(shape: CamShape, videoAspect: number): number {
  return shape === "circle" || shape === "square" ? 1 : videoAspect;
}

/** Clamp diameter (box width) to [MIN_D, MAX_D], then keep the box fully inside the frame.
 *  Height is derived from the shape aspect at render/export time, so clamping uses width. */
export function clampPlacement(p: CamPlacement): CamPlacement {
  const diameter = clamp(p.diameter, MIN_D, MAX_D);
  return {
    diameter,
    x: clamp(p.x, 0, 1 - diameter),
    y: clamp(p.y, 0, 1 - diameter),
    visible: p.visible,
    shape: p.shape,
  };
}

/** The letterboxed (object-fit: contain) video rect inside a container of size `box`. */
export function videoRectInBox(box: { w: number; h: number }, videoAspect: number) {
  const boxAspect = box.w / box.h;
  if (videoAspect > boxAspect) {
    const w = box.w;
    const h = box.w / videoAspect;
    return { x: 0, y: (box.h - h) / 2, w, h };
  }
  const h = box.h;
  const w = box.h * videoAspect;
  return { x: (box.w - w) / 2, y: 0, w, h };
}

/** Normalized placement → source pixels (even for yuv420 safety). Width from `diameter`;
 *  height from the shape aspect. */
export function toPixels(p: CamPlacement, srcW: number, srcH: number, videoAspect: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const w = even(p.diameter * srcW);
  const h = even(w / shapeAspect(p.shape, videoAspect));
  return { x: even(p.x * srcW), y: even(p.y * srcH), w, h };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint && npx vitest run src/recorder/camOverlay.test.ts`
Expected: PASS. (Existing tests referencing `toPixels(...).d` must be updated to `.w`; update them now.)

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/camOverlay.ts glint/src/recorder/camOverlay.test.ts
git commit -m "feat(p22): aspect-aware cam overlay geometry (shape + w/h)"
```

---

### Task B3: live bubble shape + selector control

**Files:**
- Modify: `glint/src/recorder/RecCam.tsx` (read `webcam_shape`, apply CSS)
- Modify: `glint/src/recorder/recorder.css` (shape classes)
- Modify: `glint/src/recorder/RegionSelect.tsx` (shape-cycle control)

**Interfaces:**
- Consumes: `settings_get_all().webcam_shape` (B1).

- [ ] **Step 1: RecCam reads the shape.** In `RecCam.tsx`, the existing `settings_get_all` fetch already returns the settings object; extend its type to include `webcam_shape?: string` and store it in state (default `"circle"`). Apply it as a class on the bubble container, e.g. `className={\`rec-cam rec-cam--${shape}\`}`. For `circle` keep the current 50% radius; for `square` a fixed radius; for `rounded`/`rect` set the container aspect to the video's natural ratio (drop the forced 1:1) and radius (rounded = ~16px, rect = 0).

- [ ] **Step 2: CSS.** In `recorder.css` add:

```css
.rec-cam--circle .rec-cam-video { border-radius: 50%; }
.rec-cam--square .rec-cam-video { border-radius: 14%; }
.rec-cam--rounded .rec-cam-video { border-radius: 16px; }
.rec-cam--rect   .rec-cam-video { border-radius: 0; }
/* circle & square force a square frame; rounded & rect keep the camera's native aspect */
.rec-cam--circle, .rec-cam--square { aspect-ratio: 1 / 1; }
.rec-cam--rounded, .rec-cam--rect { aspect-ratio: auto; }
```

(Adapt selectors to the actual RecCam markup; if the bubble sizes itself by width, ensure non-square shapes let height follow `aspect-ratio` from the video.)

- [ ] **Step 3: Selector shape control.** In `RegionSelect.tsx`, where the webcam chip + Movable sub-chip render (only when cam is on), add a small shape-cycle button that reads/writes the shape. Seed it from settings; cycle order `circle → rounded → square → rect`. Persist via `setWebcamShape` so the live bubble (which reads the setting) picks it up. Label each state with an icon or the shape name.

- [ ] **Step 4: Typecheck + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: clean / green.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/RecCam.tsx glint/src/recorder/recorder.css glint/src/recorder/RegionSelect.tsx
git commit -m "feat(p22): live webcam bubble shapes + selector shape control"
```

---

### Task B4: persist shape in `.cam.json`

**Files:**
- Modify: `glint/src-tauri/src/recorder/cam.rs` (read/write shape; tests)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (write shape at start)
- Modify: `glint/src-tauri/src/recorder/trim.rs` (`ProbeResult.cam_shape`; read it)

**Interfaces:**
- Produces: `write_cam_placement(screen_mp4, x, y, diameter, shape: &str)`; `read_cam_placement(screen_mp4) -> Option<(f64,f64,f64,String)>`.

- [ ] **Step 1: Failing test** — in `cam.rs` tests:

```rust
#[test]
fn placement_roundtrips_shape() {
    let dir = std::env::temp_dir().join("glint-cam-test");
    std::fs::create_dir_all(&dir).unwrap();
    let mp4 = dir.join("clip.mp4");
    let mp4s = mp4.to_string_lossy().to_string();
    write_cam_placement(&mp4s, 0.1, 0.2, 0.25, "rounded");
    let got = read_cam_placement(&mp4s).unwrap();
    assert_eq!(got.3, "rounded");
    assert!((got.0 - 0.1).abs() < 1e-9);
    let _ = std::fs::remove_file(cam_placement_path(&mp4s));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test placement_roundtrips_shape`
Expected: FAIL — arity of `write_cam_placement` / tuple shape.

- [ ] **Step 3: Implement.** Update `cam.rs`:

```rust
pub fn read_cam_placement(screen_mp4: &str) -> Option<(f64, f64, f64, String)> {
    let raw = std::fs::read_to_string(cam_placement_path(screen_mp4)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let x = v.get("x")?.as_f64()?;
    let y = v.get("y")?.as_f64()?;
    let d = v.get("diameter")?.as_f64()?;
    // Legacy files (Phase 21) have no shape → circle.
    let shape = v.get("shape").and_then(|s| s.as_str()).unwrap_or("circle").to_string();
    Some((x, y, d, shape))
}

pub fn write_cam_placement(screen_mp4: &str, x: f64, y: f64, diameter: f64, shape: &str) {
    let json = format!("{{\"x\":{x},\"y\":{y},\"diameter\":{diameter},\"shape\":\"{shape}\"}}");
    let _ = std::fs::write(cam_placement_path(screen_mp4), json);
}
```

- [ ] **Step 4: Update callers.**
  - In `mod.rs` `recorder_start`, the `write_cam_placement(&cam_path, x, y, d)` call gains the shape. Read the shape from settings alongside `record_webcam_movable` (add `record_webcam_shape` to the settings snapshot already taken there — read `s.webcam_shape.clone()`), and pass it.
  - In `trim.rs` `recorder_trim_probe`, the destructure `if let Some((x, y, d)) = read_cam_placement(&path)` becomes `if let Some((x, y, d, shape)) = …`; set `result.cam_shape = shape;`. Add `pub cam_shape: String` to `ProbeResult` (serde default `"circle"`) and initialize it in `parse_ffprobe_json` / the struct default.

- [ ] **Step 5: Build + test**

Run: `cd glint/src-tauri && cargo test && cargo clippy --all-targets`
Expected: PASS, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/cam.rs glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/recorder/trim.rs
git commit -m "feat(p22): persist webcam shape in .cam.json and surface it from probe"
```

---

### Task B5: trim overlay renders shape + shape control

**Files:**
- Modify: `glint/src/recorder/TrimCamOverlay.tsx` (shape aspect + border-radius)
- Modify: `glint/src/recorder/TrimView.tsx` (seed shape from probe; shape control in the cam cluster)
- Modify: `glint/src/lib/trim.ts` (`ProbeResult.cam_shape`)
- Modify: `glint/src/recorder/trim.css` (overlay shape radii)

**Interfaces:**
- Consumes: `CamShape`, `shapeAspect`, aspect-aware geometry (B2); `probe.cam_shape` (B4).

- [ ] **Step 1: Type + probe seed.** In `lib/trim.ts` add `cam_shape: string` to `ProbeResult`. In `TrimView.tsx`, when `has_cam`, seed the initial `CamPlacement.shape` from `probe.cam_shape` (fallback `"circle"`), and use `shapeAspect(shape, videoAspect)` where the overlay box aspect is needed.

- [ ] **Step 2: Overlay render.** In `TrimCamOverlay.tsx`, compute the box height from the shape:

```ts
const aspect = shapeAspect(placement.shape, videoAspect);
const size = placement.diameter * rect.w;      // width
const height = size / aspect;                  // height follows shape
```

Apply `width: size, height` to the `.trim-cam` div, and set the border-radius by shape (circle 50%, square 14%, rounded 16px, rect 0) via a shape class `trim-cam--${placement.shape}`. The move/resize math is unchanged (resize still drives `diameter` = width).

- [ ] **Step 3: Shape control.** In the TrimView cam control cluster (next to Reset / ✕), add a shape-cycle button that updates `placement.shape` (via the existing placement setter) so the user can change shape after recording. Cycle `circle → rounded → square → rect`.

- [ ] **Step 4: CSS.** In `trim.css` add:

```css
.trim-cam--circle  .trim-cam-video { border-radius: 50%; }
.trim-cam--square  .trim-cam-video { border-radius: 14%; }
.trim-cam--rounded .trim-cam-video { border-radius: 16px; }
.trim-cam--rect    .trim-cam-video { border-radius: 0; }
```

- [ ] **Step 5: Typecheck + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: clean / green.

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/TrimCamOverlay.tsx glint/src/recorder/TrimView.tsx glint/src/lib/trim.ts glint/src/recorder/trim.css
git commit -m "feat(p22): trim editor renders webcam shape + post-hoc shape control"
```

---

### Task B6: per-shape export mask (single rounded-rect `geq`)

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs` (`CamOverlay`, mask helper, `build_trim_args`, `recorder_trim_export`)
- Modify: `glint/src/lib/trim.ts` + `glint/src/recorder/TrimView.tsx` (pass `w,h,shape` in the overlay)
- Test: `trim.rs` tests

**Interfaces:**
- Consumes: `toPixels` returning `{x,y,w,h}` (B2).
- Produces: `CamOverlay { x, y, w, h, shape: String }` (replaces `{x,y,d}`); mask helper `fn cam_shape_chain(shape, w, h) -> String`.

- [ ] **Step 1: Failing tests** — in `trim.rs` tests, add (adapt to the existing test harness for `build_trim_args`):

```rust
#[test]
fn rect_shape_has_no_geq_mask() {
    let ov = CamOverlay { x: 10.0, y: 10.0, w: 320.0, h: 180.0, shape: "rect".into() };
    let a = build_trim_args("in.mp4", "out.mp4", &one_segment(), false, 0.0, 0.0, Some("c.webm"), Some(ov));
    let fc = filter_complex_of(&a);
    assert!(!fc.contains("geq"), "rect should not punch an alpha mask");
    assert!(fc.contains("overlay="));
}

#[test]
fn rounded_shape_uses_rounded_rect_geq() {
    let ov = CamOverlay { x: 10.0, y: 10.0, w: 320.0, h: 180.0, shape: "rounded".into() };
    let a = build_trim_args("in.mp4", "out.mp4", &one_segment(), false, 0.0, 0.0, Some("c.webm"), Some(ov));
    let fc = filter_complex_of(&a);
    assert!(fc.contains("geq"));
    assert!(fc.contains("hypot"));
}

#[test]
fn no_cam_is_byte_identical_baseline() {
    let with = build_trim_args("in.mp4", "out.mp4", &one_segment(), false, 0.0, 0.0, None, None);
    assert!(!filter_complex_of(&with).contains("camcat"));
}
```

(Provide `one_segment()` / `filter_complex_of()` helpers if not present — a segment vec with one clip, and a scan of `a` for the string after `-filter_complex`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test recorder::trim`
Expected: FAIL — `CamOverlay` fields; helper missing.

- [ ] **Step 3: Implement.** Change the struct:

```rust
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CamOverlay {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// "circle" | "rounded" | "square" | "rect"
    pub shape: String,
}
```

Add the mask helper (unifies circle/square/rounded via a rounded-rect SDF; rect skips the mask):

```rust
/// The cam filter chain from `[camcat]` to `[cammask]`: crop/scale to the box, then (for all
/// shapes except `rect`) punch a rounded-rectangle alpha. Circle = square box with radius =
/// half-width; square = small radius; rounded = larger radius; rect = no mask (sharp frame).
fn cam_shape_chain(shape: &str, w: f64, h: f64) -> String {
    let n = |v: f64| format!("{v:.3}");
    // circle/square use a centred square box (min side); rounded/rect keep the native w×h.
    let square = matches!(shape, "circle" | "square");
    let crop = if square { "crop='min(iw,ih)':'min(iw,ih)'," } else { "" };
    let (bw, bh) = if square { (w.min(h), w.min(h)) } else { (w, h) };
    let radius = match shape {
        "circle" => bw / 2.0,
        "square" => bw * 0.14,
        "rounded" => bw.min(bh) * 0.14,
        _ => 0.0, // rect
    };
    let scale = format!("{crop}scale={bw}:{bh}", bw = n(bw), bh = n(bh));
    if shape == "rect" {
        // No alpha mask — a sharp rectangle overlays directly.
        return format!("{scale}[cammask]");
    }
    // Rounded-rectangle SDF: inside iff hypot(max(|X-cx|-(W/2-r),0), max(|Y-cy|-(H/2-r),0)) <= r.
    let (cx, cy) = (bw / 2.0, bh / 2.0);
    let (hx, hy) = (bw / 2.0 - radius, bh / 2.0 - radius);
    format!(
        "{scale},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(max(abs(X-{cx})-{hx}\\,0)\\,max(abs(Y-{cy})-{hy}\\,0)),{r}),255,0)'[cammask]",
        cx = n(cx), cy = n(cy), hx = n(hx), hy = n(hy), r = n(radius),
    )
}
```

In `build_trim_args`, replace the current circular-mask block:

```rust
    let vpost = if has_cam {
        let ov = overlay.unwrap();
        fc.push(';');
        for i in 0..n { fc.push_str(&format!("[c{i}]")); }
        fc.push_str(&format!("concat=n={n}:v=1:a=0[camcat]"));
        fc.push_str(&format!(";[camcat]{}", cam_shape_chain(&ov.shape, ov.w, ov.h)));
        let ovlabel = if apply_fade { "cvf" } else { "outv" };
        fc.push_str(&format!(";[vbase][cammask]overlay=x={}:y={}:eof_action=pass[{ovlabel}]", num(ov.x), num(ov.y)));
        ovlabel
    } else {
        vconcat
    };
```

- [ ] **Step 4: Pass `w,h,shape` from the editor.** In `lib/trim.ts`, change the `CamOverlay` interface to `{ x, y, w, h, shape }`. In `TrimView.tsx` `save()`, build the overlay via `toPixels(placement, srcW, srcH, videoAspect)` (now `{x,y,w,h}`) plus `shape: placement.shape`. Update `trimExport`'s param type accordingly. Match `recorder_trim_export`'s Rust `cam_overlay: Option<CamOverlay>` param — it already deserializes the struct, so the new fields flow through.

- [ ] **Step 5: Build + test**

Run: `cd glint/src-tauri && cargo test recorder::trim && cargo clippy --all-targets` then `cd glint && npx tsc --noEmit && npx vitest run`
Expected: PASS / clean / green.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs glint/src/lib/trim.ts glint/src/recorder/TrimView.tsx
git commit -m "feat(p22): per-shape webcam export mask (unified rounded-rect geq; rect unmasked)"
```

---

## Track C — App-wide accent color

### Task C1: replace pure-hardcoded accent hexes with `var(--accent)`

**Files:**
- Modify: `glint/src/ocr/ocr.css`, `glint/src/recorder/recorder.css`, `glint/src/recorder/trim.css`

**Interfaces:** none (CSS only). Sites that already use `var(--accent, #5b7cfa)` are left alone — they already respond to the accent; only the pure hardcoded values below don't.

- [ ] **Step 1: Edit `ocr.css`** — line 10:

```css
/* before */ .ocr-btn--primary { background: #5b7cfa; border-color: #5b7cfa; }
/* after  */ .ocr-btn--primary { background: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 2: Edit `recorder.css`** — apply each:

```css
/* line 41 */ .rec-sel-rect { position: absolute; outline: 1px solid var(--accent); cursor: move; box-sizing: border-box; }
/* line 45 */ .rec-sel-handle { position: absolute; background: var(--accent); padding: 4px; margin: -4px; box-sizing: content-box; border-radius: 2px; }
/* line 65 */ border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
/* line 80 */ background: var(--accent); color: #fff; border: none; border-radius: 8px;
```

- [ ] **Step 3: Edit `trim.css`** — apply each:

```css
/* line 29 */ border-radius: 50%; background: var(--accent); border: 2px solid #fff;
/* line 45 */ .trim-btn--primary { background: var(--accent); border-color: var(--accent); }
/* line 53 */ .trim-clip { position: absolute; top: 6px; bottom: 6px; background: var(--accent-subtle); border: 1px solid var(--accent); border-radius: 5px; box-sizing: border-box; pointer-events: none; }
/* line 58 */ .trim-progress-fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--accent) 33%, transparent); }
```

(The trim.css line 29 rule is the playhead dot; keep the `#fff` border — it's a neutral outline, not an accent.)

- [ ] **Step 4: Verify no pure-hardcoded default-accent remains**

Run: `cd glint && npx tsc --noEmit` (sanity) then grep:
`rg -n "#5[bB]7[cC][fF][aA]|91\s*,\s*124\s*,\s*250" src/ocr/ocr.css src/recorder/recorder.css src/recorder/trim.css`
Expected: only matches that are inside a `var(--accent, …)` fallback (there should be none left in these three files except intentional fallbacks — trim.css line 69's `var(--accent-subtle, rgba(91,124,250,.16))` fallback may remain and is fine).

- [ ] **Step 5: Commit**

```bash
git add glint/src/ocr/ocr.css glint/src/recorder/recorder.css glint/src/recorder/trim.css
git commit -m "fix(p22): accent applies app-wide (OCR, region selector, trim editor)"
```

---

## Final: green gate + at-screen acceptance + merge

### Task Z: full gate + merge to master

- [ ] **Step 1: Full green gate**

Run:
```bash
cd glint/src-tauri && cargo clippy --all-targets && cargo test
cd ../ && npx tsc --noEmit && npx vitest run
```
Expected: 0 clippy warnings; all Rust tests pass; tsc clean; all vitest pass.

- [ ] **Step 2: At-screen acceptance (user-driven).** Confirm:
  - **A:** Record → log shows `video encoder probe: chose Nvenc`; output plays; smooth ~60fps at full res; pause/resume concatenates cleanly.
  - **B:** Each of circle/rounded/square/rect — live bubble shows the shape; a movable recording opens in the trim editor at the same shape, is changeable there, and exports with correct masked/sharp edges; a no-cam recording still exports.
  - **C:** With **Teal** selected, the OCR panel, region selector, and trim editor show Teal (not periwinkle); semantic colors unchanged.

- [ ] **Step 3: ROADMAP entry.** Move the "hardware video encoder" deferred item into Shipped as Phase 22, and note webcam shapes + app-wide accent. Commit.

- [ ] **Step 4: Merge**

```bash
git checkout master
git merge --no-ff phase-22-gpu-encode-cam-shapes-accent -m "Merge Phase 22 — GPU H.264 encode, webcam shapes, app-wide accent"
```

---

## Self-Review

**Spec coverage:**
- Track A (probe, encoder tail, lock-per-session, libx264 fallback, segment-0 demotion, unit tests) → A1–A3. ✓
- Track B (setting, aspect-aware geometry, live bubble + selector, `.cam.json` persistence, trim render + control, per-shape export mask, tests) → B1–B6. ✓
- Track C (audit pure-hardcoded accent → var) → C1. ✓
- Cross-cutting (green gate, ROADMAP, `--no-ff` merge) → Task Z. ✓

**Placeholder scan:** No "TBD/handle appropriately" — each code step shows the code; CSS steps show exact before/after. B3/B5 UI-control steps describe the control precisely (cycle order, seed source, persistence call) rather than showing full JSX because the surrounding markup is read at execution time; the data flow and function names are exact.

**Type consistency:** `CamPlacement.shape: CamShape` (B2) is read by TrimCamOverlay/TrimView (B5) and mapped to Rust `CamOverlay.shape: String` (B6). `toPixels` returns `{x,y,w,h}` everywhere after B2. `read_cam_placement` returns a 4-tuple (B4) consumed in trim probe (B4). `VideoEncoder` (A1) flows through `build_ffmpeg_args`/`spawn_segment`/`ActiveRecording` (A2–A3). Consistent.
