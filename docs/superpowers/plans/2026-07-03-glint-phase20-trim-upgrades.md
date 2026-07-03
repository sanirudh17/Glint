# Phase 20 — Trim Editor Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add redo, an audio waveform, fade-in/out, and per-segment speed to the recording trim window.

**Architecture:** The export contract evolves from merged keep-ranges `(start,end)[]` to per-segment `{start,end,speed}[]` + `fade_in`/`fade_out`. Rust `trim.rs` owns the ffmpeg arg-building, validation, and a new waveform-extraction command (all pure helpers unit-tested); the React trim window gains a single `EditState` with undo/redo stacks and the speed/fade/waveform UI. The editing timeline stays source-time, so speed never distorts layout.

**Tech Stack:** Rust (Tauri v2, `tauri-plugin-shell` ffmpeg/ffprobe sidecars), TypeScript/React 19, vitest.

## Global Constraints

- Base branch is `master`; work on `phase-20-trim-upgrades` (already created; spec already committed there).
- **Recorder isolation:** `trim.rs` may import only recorder `ffmpeg`/`thumb` + `crate::db` — nothing from capture/editor/overlay/ocr. Frontend trim files import nothing from editor.
- **Speed set is exactly {0.5, 1, 1.5, 2}×** (each fits a single `atempo`, no chaining). `validate_segments` rejects speed outside `[0.5, 2]`.
- **No-op export** = a single full-span segment at speed 1 with both fades 0. Any speed/fade/cut change is a real edit.
- **Byte-identical no-fade/no-speed path:** a segment at speed 1 emits the exact old `trim…setpts=PTS-STARTPTS` filter; with both fades 0 the concat outputs map directly to `[outv]`/`[outa]` (no passthrough filter).
- Clip reordering and speeds outside [0.5,2] are **out of scope**.
- Green gate before each commit of a completed slice: from `glint/src-tauri` → `cargo clippy --all-targets` (0 warnings) + `cargo test`; from `glint` → `npx tsc --noEmit` + `npx vitest run`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015nTvnnokF1JXxN8bbKfuiH
  ```

---

## File Structure

- `glint/src-tauri/src/recorder/trim.rs` — `KeepSegment`, `build_trim_args` (speed+fades), `validate_segments`, `output_duration`, `is_noop`, `recorder_trim_export` migration, `peaks_from_pcm_s16le` + `recorder_trim_waveform` (§1/§3/§4/§5/§6 backend).
- `glint/src-tauri/src/lib.rs` — register `recorder_trim_waveform` in the invoke handler.
- `glint/src/recorder/trimModel.ts` — `Clip.speed`, `keptSegments`, `outputDuration`, `setSpeed`, speed-preserving split/delete (§1).
- `glint/src/recorder/trimModel.test.ts` — new model tests.
- `glint/src/lib/trim.ts` — `trimExport` new signature + `trimWaveform` (§6/§3 IPC).
- `glint/src/recorder/TrimView.tsx` — `EditState`, undo/redo, redo control, speed control, fade steppers, waveform fetch, export wiring (§2/§4/§5).
- `glint/src/recorder/TrimTimeline.tsx` — waveform bars + per-clip speed badge (§3/§5).
- `glint/src/recorder/trim.css` — waveform, speed badge, speed control, fade stepper styles.

---

## Task 1: Rust export core — KeepSegment, speed + fades, validation (§1/§4/§5/§6)

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs`

**Interfaces:**
- Produces:
  ```rust
  #[derive(Debug, Clone, Copy, serde::Deserialize)]
  pub struct KeepSegment { pub start: f64, pub end: f64, pub speed: f64 }
  pub fn output_duration(segments: &[KeepSegment]) -> f64
  pub fn validate_segments(segments: &[KeepSegment], duration: f64) -> Result<Vec<KeepSegment>, String>
  pub fn is_noop(segments: &[KeepSegment], duration: f64, fade_in: f64, fade_out: f64) -> bool
  pub fn build_trim_args(input: &str, output: &str, segments: &[KeepSegment], has_audio: bool, fade_in: f64, fade_out: f64) -> Vec<String>
  ```
  `recorder_trim_export` takes `segments: Vec<KeepSegment>, … fade_in: f64, fade_out: f64`.

- [ ] **Step 1: Write failing tests**

In `trim.rs` tests module, **replace** the existing `video_only_two_regions_concat`, `video_audio_interleaves_streams`, `single_region_uses_concat_n1`, `args_silence_stderr_and_progress`, `validate_sorts_and_rejects_overlap_and_oob`, and `noop_when_single_full_span` tests with segment-based versions, and add speed/fade/output-duration tests:

```rust
    fn seg(start: f64, end: f64, speed: f64) -> KeepSegment { KeepSegment { start, end, speed } }

    #[test]
    fn video_only_two_regions_concat() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 1.5, 1.0), seg(3.0, 4.0, 1.0)], false, 0.0, 0.0);
        let fc = "[0:v]trim=0:1.5,setpts=PTS-STARTPTS[v0];\
                  [0:v]trim=3:4,setpts=PTS-STARTPTS[v1];\
                  [v0][v1]concat=n=2:v=1:a=0[outv]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(!a.iter().any(|s| s == "-c:a"));
        assert_eq!(a.last().unwrap(), "out.mp4");
    }

    #[test]
    fn speed_segment_divides_video_pts_and_atempos_audio() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 4.0, 2.0)], true, 0.0, 0.0);
        let fc = "[0:v]trim=0:4,setpts=(PTS-STARTPTS)/2[v0];\
                  [0:a]atrim=0:4,asetpts=PTS-STARTPTS,atempo=2[a0];\
                  [v0][a0]concat=n=1:v=1:a=1[outv][outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
    }

    #[test]
    fn speed_one_is_byte_identical_to_plain_trim() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(2.0, 8.0, 1.0)], false, 0.0, 0.0);
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex"
            && w[1] == "[0:v]trim=2:8,setpts=PTS-STARTPTS[v0];[v0]concat=n=1:v=1:a=0[outv]"), "got {a:?}");
    }

    #[test]
    fn fades_post_process_the_concat_output() {
        // single 0..10 kept, fade in 1s + out 2s → out-fade starts at 8.
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 10.0, 1.0)], true, 1.0, 2.0);
        let fc = "[0:v]trim=0:10,setpts=PTS-STARTPTS[v0];\
                  [0:a]atrim=0:10,asetpts=PTS-STARTPTS[a0];\
                  [v0][a0]concat=n=1:v=1:a=1[cv][ca];\
                  [cv]fade=t=in:st=0:d=1,fade=t=out:st=8:d=2[outv];\
                  [ca]afade=t=in:st=0:d=1,afade=t=out:st=8:d=2[outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outa]"));
    }

    #[test]
    fn fade_out_start_is_speed_aware() {
        // two segments: 0..4 at 2x (→2s out) and 10..14 at 1x (→4s out); outDur=6, fade-out 1s → st=5.
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 4.0, 2.0), seg(10.0, 14.0, 1.0)], false, 0.0, 1.0);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("fade=t=out:st=5:d=1"), "got {fc}");
    }

    #[test]
    fn args_silence_stderr_and_progress() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 1.0, 1.0)], false, 0.0, 0.0);
        assert!(a.iter().any(|s| s == "-nostats"));
        assert!(a.windows(2).any(|w| w[0] == "-loglevel" && w[1] == "error"));
        assert!(a.windows(2).any(|w| w[0] == "-progress" && w[1] == "pipe:1"));
        assert!(a.iter().any(|s| s == "-y"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert!(a.windows(2).any(|w| w[0] == "-movflags" && w[1] == "+faststart"));
    }

    #[test]
    fn output_duration_is_speed_weighted() {
        let d = output_duration(&[seg(0.0, 4.0, 2.0), seg(10.0, 16.0, 1.0)]);
        assert!((d - (2.0 + 6.0)).abs() < 1e-9, "got {d}");
    }

    #[test]
    fn validate_sorts_rejects_overlap_oob_and_bad_speed() {
        assert_eq!(
            validate_segments(&[seg(3.0, 4.0, 1.0), seg(0.0, 1.0, 2.0)], 10.0).unwrap(),
            vec![seg(0.0, 1.0, 2.0), seg(3.0, 4.0, 1.0)]
        );
        assert!(validate_segments(&[seg(0.0, 2.0, 1.0), seg(1.0, 3.0, 1.0)], 10.0).is_err()); // overlap
        assert!(validate_segments(&[seg(0.0, 11.0, 1.0)], 10.0).is_err());                    // oob
        assert!(validate_segments(&[seg(2.0, 2.0, 1.0)], 10.0).is_err());                     // empty
        assert!(validate_segments(&[], 10.0).is_err());                                       // empty list
        assert!(validate_segments(&[seg(0.0, 5.0, 3.0)], 10.0).is_err());                     // speed too high
        assert!(validate_segments(&[seg(0.0, 5.0, 0.25)], 10.0).is_err());                    // speed too low
    }

    #[test]
    fn noop_only_when_full_span_speed1_no_fades() {
        assert!(is_noop(&[seg(0.0, 10.0, 1.0)], 10.0, 0.0, 0.0));
        assert!(!is_noop(&[seg(0.0, 10.0, 2.0)], 10.0, 0.0, 0.0));  // speed change is an edit
        assert!(!is_noop(&[seg(0.0, 10.0, 1.0)], 10.0, 0.5, 0.0));  // fade is an edit
        assert!(!is_noop(&[seg(0.0, 5.0, 1.0)], 10.0, 0.0, 0.0));   // a cut
    }
```

Update the `KeepSegment` type derive to `PartialEq` so `assert_eq!` on `Vec<KeepSegment>` compiles (see Step 3).

- [ ] **Step 2: Run to verify failure**

Run (in `glint/src-tauri`): `cargo test --lib recorder::trim`
Expected: FAIL to compile (`KeepSegment`, `validate_segments`, `output_duration`, new `build_trim_args`/`is_noop` signatures don't exist).

- [ ] **Step 3: Implement the new core**

In `trim.rs`, add the type near the top (after `ProbeResult`):
```rust
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct KeepSegment {
    pub start: f64,
    pub end: f64,
    pub speed: f64,
}

/// Output (exported) duration: each kept segment contributes `(end-start)/speed`.
pub fn output_duration(segments: &[KeepSegment]) -> f64 {
    segments.iter().map(|s| (s.end - s.start) / s.speed).sum()
}
```

Replace `validate_keep` with:
```rust
/// Validate + sort kept segments: non-empty, each (start < end), all within [0, duration],
/// non-overlapping after sorting by start, and speed within [0.5, 2].
pub fn validate_segments(segments: &[KeepSegment], duration: f64) -> Result<Vec<KeepSegment>, String> {
    if segments.is_empty() {
        return Err("nothing to keep".into());
    }
    let mut v = segments.to_vec();
    v.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut prev_end = 0.0;
    for (i, s) in v.iter().enumerate() {
        if !matches!(s.end.partial_cmp(&s.start), Some(std::cmp::Ordering::Greater)) {
            return Err("empty keep-region".into());
        }
        if s.start < -1e-6 || s.end > duration + 1e-3 {
            return Err("keep-region out of bounds".into());
        }
        if i > 0 && s.start < prev_end - 1e-6 {
            return Err("overlapping keep-regions".into());
        }
        // NaN fails both comparisons → rejected.
        if !(s.speed >= 0.5 - 1e-9 && s.speed <= 2.0 + 1e-9) {
            return Err("speed out of range".into());
        }
        prev_end = s.end;
    }
    Ok(v)
}
```

Replace `is_noop`:
```rust
/// True when the edit changes nothing: a single full-span segment at speed 1 with no fades.
pub fn is_noop(segments: &[KeepSegment], duration: f64, fade_in: f64, fade_out: f64) -> bool {
    segments.len() == 1
        && segments[0].start <= 1e-3
        && segments[0].end >= duration - 0.05
        && (segments[0].speed - 1.0).abs() < 1e-9
        && fade_in <= 1e-9
        && fade_out <= 1e-9
}
```

Replace `build_trim_args`:
```rust
/// Build ffmpeg args for a per-segment trim: trim each kept segment (applying its speed),
/// concat them in one re-encode pass, then optionally fade the concatenated output in/out.
/// `segments` is already validated (sorted, non-overlapping, in-bounds, speed∈[0.5,2]).
pub fn build_trim_args(
    input: &str,
    output: &str,
    segments: &[KeepSegment],
    has_audio: bool,
    fade_in: f64,
    fade_out: f64,
) -> Vec<String> {
    // Format a number without a trailing ".0" (so 1.5 -> "1.5", 3.0 -> "3").
    fn num(n: f64) -> String {
        if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
    }
    let one = |k: f64| (k - 1.0).abs() < 1e-9;

    let mut fc = String::new();
    for (i, s) in segments.iter().enumerate() {
        if one(s.speed) {
            fc.push_str(&format!("[0:v]trim={}:{},setpts=PTS-STARTPTS[v{i}];", num(s.start), num(s.end)));
        } else {
            fc.push_str(&format!("[0:v]trim={}:{},setpts=(PTS-STARTPTS)/{}[v{i}];", num(s.start), num(s.end), num(s.speed)));
        }
        if has_audio {
            if one(s.speed) {
                fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS[a{i}];", num(s.start), num(s.end)));
            } else {
                fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS,atempo={}[a{i}];", num(s.start), num(s.end), num(s.speed)));
            }
        }
    }
    let n = segments.len();
    for i in 0..n {
        fc.push_str(&format!("[v{i}]"));
        if has_audio { fc.push_str(&format!("[a{i}]")); }
    }

    // Fades post-process the concat output; with no fades, concat writes [outv]/[outa]
    // directly (byte-identical to the pre-fade path).
    let apply_fade = fade_in > 1e-9 || fade_out > 1e-9;
    let (vlabel, alabel) = if apply_fade { ("cv", "ca") } else { ("outv", "outa") };
    if has_audio {
        fc.push_str(&format!("concat=n={n}:v=1:a=1[{vlabel}][{alabel}]"));
    } else {
        fc.push_str(&format!("concat=n={n}:v=1:a=0[{vlabel}]"));
    }
    if apply_fade {
        let out_dur = output_duration(segments);
        let st = (out_dur - fade_out).max(0.0);
        let mut vf = String::new();
        if fade_in > 1e-9 { vf.push_str(&format!("fade=t=in:st=0:d={}", num(fade_in))); }
        if fade_out > 1e-9 {
            if !vf.is_empty() { vf.push(','); }
            vf.push_str(&format!("fade=t=out:st={}:d={}", num(st), num(fade_out)));
        }
        fc.push_str(&format!(";[cv]{vf}[outv]"));
        if has_audio {
            let mut af = String::new();
            if fade_in > 1e-9 { af.push_str(&format!("afade=t=in:st=0:d={}", num(fade_in))); }
            if fade_out > 1e-9 {
                if !af.is_empty() { af.push(','); }
                af.push_str(&format!("afade=t=out:st={}:d={}", num(st), num(fade_out)));
            }
            fc.push_str(&format!(";[ca]{af}[outa]"));
        }
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

- [ ] **Step 4: Migrate `recorder_trim_export` to the new signature**

Change its signature and body. Replace the parameter list `keep: Vec<(f64, f64)>` with `segments: Vec<KeepSegment>` and add `fade_in`/`fade_out`:
```rust
pub async fn recorder_trim_export(
    app: tauri::AppHandle,
    id: i64,
    src_path: String,
    segments: Vec<KeepSegment>,
    has_audio: bool,
    duration: f64,
    width: i64,
    height: i64,
    fade_in: f64,
    fade_out: f64,
    mode: String,
) -> Result<(), String> {
```
In the body, replace the first lines:
```rust
    let segments = validate_segments(&segments, duration)?;
    if is_noop(&segments, duration, fade_in, fade_out) {
        return Err("no changes to save".into());
    }
    let total_out: f64 = output_duration(&segments);
```
Change the args build:
```rust
    let args = build_trim_args(&src_path, &tmp_str, &segments, has_audio, fade_in, fade_out);
```
And the progress line uses `total_out` instead of `total_kept`:
```rust
                            let pct = ((us / 1_000_000.0) / total_out.max(0.001) * 100.0).clamp(0.0, 100.0);
```
(Delete the old `let total_kept: f64 = keep.iter()…` line.)

- [ ] **Step 5: Run to verify pass + gate**

Run (in `glint/src-tauri`): `cargo test --lib recorder::trim` — PASS.
Then `cargo clippy --all-targets --quiet` (0 warnings) and `cargo test` — PASS.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs
git commit -m "feat(p20): trim export supports per-segment speed + fades (Rust core)"
```

---

## Task 2: Rust waveform extraction command (§3)

**Files:**
- Modify: `glint/src-tauri/src/recorder/trim.rs`
- Modify: `glint/src-tauri/src/lib.rs` (register the command)

**Interfaces:**
- Produces:
  ```rust
  pub fn peaks_from_pcm_s16le(bytes: &[u8], buckets: usize) -> Vec<f32>
  #[tauri::command(async)] pub async fn recorder_trim_waveform(app, path: String, buckets: u32) -> Result<Vec<f32>, String>
  ```

- [ ] **Step 1: Write failing tests for the pure bucketing**

Add to the `trim.rs` tests module:
```rust
    #[test]
    fn peaks_bucket_max_abs_normalized() {
        // 4 samples (i16le): 0, 16384(=0.5), -32768(=1.0), 8192(=0.25) → 2 buckets.
        let mut bytes = Vec::new();
        for v in [0i16, 16384, -32768, 8192] { bytes.extend_from_slice(&v.to_le_bytes()); }
        let p = peaks_from_pcm_s16le(&bytes, 2);
        assert_eq!(p.len(), 2);
        assert!((p[0] - 0.5).abs() < 1e-3, "bucket0 = {}", p[0]);  // max(|0|,|0.5|)
        assert!((p[1] - 1.0).abs() < 1e-3, "bucket1 = {}", p[1]);  // max(|1.0|,|0.25|)
    }

    #[test]
    fn peaks_empty_input_is_zeros() {
        assert_eq!(peaks_from_pcm_s16le(&[], 3), vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn peaks_zero_buckets_is_empty() {
        assert!(peaks_from_pcm_s16le(&[0, 0, 0, 0], 0).is_empty());
    }
```

- [ ] **Step 2: Run to verify failure**

Run (in `glint/src-tauri`): `cargo test --lib recorder::trim::tests::peaks`
Expected: FAIL (function not defined).

- [ ] **Step 3: Implement the pure helper + command**

Add to `trim.rs`:
```rust
/// Reduce interleaved mono `s16le` PCM into `buckets` normalized peak values in [0,1]
/// (per-bucket max |sample| / i16::MAX). Pure + unit-tested; the command below is the
/// thin ffmpeg+IO wrapper. Returns all-zeros for empty input, empty for 0 buckets.
pub fn peaks_from_pcm_s16le(bytes: &[u8], buckets: usize) -> Vec<f32> {
    if buckets == 0 {
        return Vec::new();
    }
    let n_samples = bytes.len() / 2;
    if n_samples == 0 {
        return vec![0.0; buckets];
    }
    let mut out = vec![0.0f32; buckets];
    for i in 0..n_samples {
        let s = i16::from_le_bytes([bytes[i * 2], bytes[i * 2 + 1]]);
        let amp = (s as f32).abs() / i16::MAX as f32;
        let b = (i * buckets / n_samples).min(buckets - 1);
        if amp > out[b] {
            out[b] = amp;
        }
    }
    out
}

/// Extract a downsampled mono waveform for the timeline. Runs ffmpeg to decode audio to
/// mono s16le @ 8 kHz, then buckets it. Any failure (no audio track, ffmpeg error) → Err;
/// the frontend treats that as "no waveform" and renders the timeline without it.
#[tauri::command(async)]
pub async fn recorder_trim_waveform(
    app: tauri::AppHandle,
    path: String,
    buckets: u32,
) -> Result<Vec<f32>, String> {
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("ffmpeg resolve: {e}"))?;
    let out = sidecar
        .args([
            "-v", "error",
            "-i", &path,
            "-map", "0:a:0",
            "-ac", "1",
            "-ar", "8000",
            "-f", "s16le",
            "-",
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg run: {e}"))?;
    if !out.status.success() {
        return Err("no audio / ffmpeg failed".into());
    }
    Ok(peaks_from_pcm_s16le(&out.stdout, buckets as usize))
}
```

- [ ] **Step 4: Register the command in lib.rs**

In `glint/src-tauri/src/lib.rs`, in the `invoke_handler`, next to the existing `crate::recorder::trim::recorder_trim_export,` line add:
```rust
            crate::recorder::trim::recorder_trim_waveform,
```

- [ ] **Step 5: Run to verify pass + gate**

Run (in `glint/src-tauri`): `cargo test --lib recorder::trim::tests::peaks` — PASS.
Then `cargo clippy --all-targets --quiet` (0 warnings) + `cargo test` — PASS.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/trim.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p20): recorder_trim_waveform command + peak bucketing (Rust)"
```

---

## Task 3: TS trim model — speed field + selectors (§1)

**Files:**
- Modify: `glint/src/recorder/trimModel.ts`
- Modify: `glint/src/recorder/trimModel.test.ts`

**Interfaces:**
- Produces: `Clip = { id, start, end, kept, speed }`; `keptSegments(clips): {start,end,speed}[]`; `outputDuration(clips): number`; `setSpeed(clips, id, speed): Clip[]`. `initClips`/`splitClips`/`setKept` preserve/seed `speed`.

- [ ] **Step 1: Write failing tests**

Add to `trimModel.test.ts` (and import the new symbols):
```ts
import { initClips, splitClips, setKept, keepRanges, keptCount, keptSegments, outputDuration, setSpeed } from "./trimModel";

  it("seeds speed 1 and preserves it across split", () => {
    const c = splitClips(initClips(10), 4);
    expect(c.every((x) => x.speed === 1)).toBe(true);
  });

  it("keptSegments returns kept clips in order without merging (speed boundaries kept)", () => {
    let c = splitClips(initClips(10), 5); // [0-5][5-10] both kept
    c = setSpeed(c, c[1].id, 2);          // second segment at 2x
    expect(keptSegments(c)).toEqual([
      { start: 0, end: 5, speed: 1 },
      { start: 5, end: 10, speed: 2 },
    ]);
  });

  it("keptSegments drops deleted clips", () => {
    let c = splitClips(initClips(10), 3);
    c = splitClips(c, 6); // [0-3][3-6][6-10]
    c = setKept(c, c[1].id, false);
    expect(keptSegments(c)).toEqual([
      { start: 0, end: 3, speed: 1 },
      { start: 6, end: 10, speed: 1 },
    ]);
  });

  it("outputDuration is speed-weighted over kept clips", () => {
    let c = splitClips(initClips(12), 4); // [0-4][4-12]
    c = setSpeed(c, c[0].id, 2);          // 4/2 = 2  + 8/1 = 8 → 10
    expect(outputDuration(c)).toBeCloseTo(10, 6);
  });
```

- [ ] **Step 2: Run to verify failure**

Run (in `glint`): `npx vitest run src/recorder/trimModel.test.ts`
Expected: FAIL (imports `keptSegments`/`outputDuration`/`setSpeed` undefined; `speed` missing).

- [ ] **Step 3: Implement**

Replace the top of `trimModel.ts`:
```ts
export type Clip = { id: number; start: number; end: number; kept: boolean; speed: number };

let nextId = 1;
const mk = (start: number, end: number, kept: boolean, speed: number): Clip => ({ id: nextId++, start, end, kept, speed });

const EPS = 1e-4;

export function initClips(duration: number): Clip[] {
  return [mk(0, Math.max(0, duration), true, 1)];
}
```
In `splitClips`, the two pushed clips copy the parent speed:
```ts
      out.push(mk(c.start, t, c.kept, c.speed));
      out.push(mk(t, c.end, c.kept, c.speed));
```
Add at the end of the file:
```ts
/** Set a clip's speed factor (0.5 | 1 | 1.5 | 2). */
export function setSpeed(clips: Clip[], id: number, speed: number): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, speed } : c));
}

/** Kept clips in source order as export segments — NOT merged (a speed boundary between
 *  adjacent kept clips must stay a boundary). */
export function keptSegments(clips: Clip[]): { start: number; end: number; speed: number }[] {
  return clips.filter((c) => c.kept).map((c) => ({ start: c.start, end: c.end, speed: c.speed }));
}

/** Exported duration: each kept clip contributes (end-start)/speed. */
export function outputDuration(clips: Clip[]): number {
  return clips.filter((c) => c.kept).reduce((a, c) => a + (c.end - c.start) / c.speed, 0);
}
```
(`setKept` and `keepRanges` are unchanged — `keepRanges` still merges for playback gap-skipping.)

- [ ] **Step 4: Run to verify pass**

Run (in `glint`): `npx vitest run src/recorder/trimModel.test.ts` — PASS (existing + new tests). Then `npx tsc --noEmit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/trimModel.ts glint/src/recorder/trimModel.test.ts
git commit -m "feat(p20): trim model gains per-clip speed + keptSegments/outputDuration"
```

---

## Task 4: TS IPC wrappers — trimExport signature + trimWaveform (§3/§6)

**Files:**
- Modify: `glint/src/lib/trim.ts`

**Interfaces:**
- Produces:
  ```ts
  trimExport(id, srcPath, segments: {start,end,speed}[], hasAudio, duration, width, height, fadeIn, fadeOut, mode): Promise<void>
  trimWaveform(path: string, buckets: number): Promise<number[]>
  ```

- [ ] **Step 1: Replace `trimExport` and add `trimWaveform`**

In `glint/src/lib/trim.ts`, replace the `trimExport` export with:
```ts
export interface KeepSegment {
  start: number;
  end: number;
  speed: number;
}

export const trimExport = (
  id: number,
  srcPath: string,
  segments: KeepSegment[],
  hasAudio: boolean,
  duration: number,
  width: number,
  height: number,
  fadeIn: number,
  fadeOut: number,
  mode: "copy" | "overwrite",
): Promise<void> =>
  invoke<void>("recorder_trim_export", {
    id,
    srcPath,
    segments,
    hasAudio,
    duration,
    width,
    height,
    fadeIn,
    fadeOut,
    mode,
  });

export const trimWaveform = (path: string, buckets: number): Promise<number[]> =>
  invoke<number[]>("recorder_trim_waveform", { path, buckets });
```

- [ ] **Step 2: Verify typecheck fails at the call site (expected — fixed in Task 5)**

Run (in `glint`): `npx tsc --noEmit`
Expected: FAIL in `TrimView.tsx` (`save()` still calls `trimExport` with the old arg shape). This is fixed in Task 5; do NOT patch it here.

- [ ] **Step 3: Commit**

```bash
git add glint/src/lib/trim.ts
git commit -m "feat(p20): trim IPC — segments+fades export signature + waveform wrapper"
```
(Commit even though tsc is red — the very next task makes it green. If your workflow forbids a red commit, do Tasks 4 and 5 together and commit once.)

---

## Task 5: TrimView — EditState, undo/redo, export wiring (§2/§5/§6)

**Files:**
- Modify: `glint/src/recorder/TrimView.tsx`

**Interfaces:**
- Consumes: `keptSegments`, `outputDuration`, `setSpeed` (Task 3); `trimExport` new signature (Task 4).
- Produces: `EditState = { clips: Clip[]; fadeIn: number; fadeOut: number }`; `commit`/`undo`/`redo`; export sends segments + fades.

- [ ] **Step 1: Replace the state + edit-ops + save wiring**

Replace the imports line for the model and lucide, and the state block through `save`. Specifically:

Update imports:
```tsx
import { Scissors, Trash2, Undo2, Redo2, Play, Pause } from "lucide-react";
import { trimTarget, trimProbe, trimExport, type ProbeResult } from "../lib/trim";
import { initClips, splitClips, setKept, setSpeed, keepRanges, keptCount, keptSegments, outputDuration, type Clip } from "./trimModel";
```

Replace the `clips`/`history` state (lines ~25-26) with an `EditState` + undo/redo stacks:
```tsx
  type EditState = { clips: Clip[]; fadeIn: number; fadeOut: number };
  const [edit, setEdit] = useState<EditState>({ clips: [], fadeIn: 0, fadeOut: 0 });
  const [undoStack, setUndoStack] = useState<EditState[]>([]);
  const [redoStack, setRedoStack] = useState<EditState[]>([]);
  const { clips, fadeIn, fadeOut } = edit;
```

In the init effect, seed `edit`:
```tsx
        setClips: // (remove) — replace the old `setClips(initClips(...))` call with:
        setEdit({ clips: initClips(p.duration_secs), fadeIn: 0, fadeOut: 0 });
```
(Concretely: the line `setClips(initClips(p.duration_secs));` becomes `setEdit({ clips: initClips(p.duration_secs), fadeIn: 0, fadeOut: 0 });`.)

Replace the derived values that used `clips`/`outDur`/`noop`:
```tsx
  const ranges = keepRanges(clips);
  const outDur = outputDuration(clips);
  const noop = ranges.length === 1 && ranges[0][0] <= 0.001 && ranges[0][1] >= duration - 0.05
    && clips.filter((c) => c.kept).every((c) => c.speed === 1) && fadeIn === 0 && fadeOut === 0;
  const canSave = clips.length > 0 && keptCount(clips) > 0 && !noop && exporting === null;
```

Replace `pushHistory`/`doSplit`/`doDelete`/`doUndo` with `commit`/edit-ops/`undo`/`redo`:
```tsx
  const commit = useCallback((next: EditState) => {
    setUndoStack((s) => [...s, edit]);
    setRedoStack([]);
    setEdit(next);
  }, [edit]);
  const doSplit = useCallback(() => { commit({ ...edit, clips: splitClips(clips, playhead) }); }, [commit, edit, clips, playhead]);
  const doDelete = useCallback(() => {
    if (selectedId == null || keptCount(clips) <= 1) return; // can't delete the last block
    commit({ ...edit, clips: setKept(clips, selectedId, false) });
  }, [commit, edit, clips, selectedId]);
  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (!s.length) return s;
      setRedoStack((r) => [...r, edit]);
      setEdit(s[s.length - 1]);
      return s.slice(0, -1);
    });
  }, [edit]);
  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (!r.length) return r;
      setUndoStack((u) => [...u, edit]);
      setEdit(r[r.length - 1]);
      return r.slice(0, -1);
    });
  }, [edit]);
```

Update `requestClose` to key off `undoStack.length`:
```tsx
  const requestClose = useCallback(() => {
    if (exporting !== null) return;
    if (undoStack.length > 0 && !window.confirm("Discard your trim edits?")) return;
    getCurrentWindow().close().catch(() => {});
  }, [exporting, undoStack.length]);
```

Update the keydown effect: add redo, swap `doUndo`→`undo`:
```tsx
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
```
and update its dependency array to `[doSplit, doDelete, undo, redo, seek, playhead, fps, exporting, requestClose]`.

Update `save` to send segments + fades:
```tsx
  const save = (mode: "copy" | "overwrite") => {
    if (!target || !probe || !canSave) return;
    setExporting(0);
    trimExport(target.id, target.path, keptSegments(clips), probe.has_audio, duration, probe.width, probe.height, fadeIn, fadeOut, mode)
      .catch(() => setExporting(null));
  };
```

Update the undo button + add a redo button in the transport row:
```tsx
        <button className="trim-iconbtn" onClick={undo} disabled={!undoStack.length} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="trim-iconbtn" onClick={redo} disabled={!redoStack.length} title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>
```

- [ ] **Step 2: Verify typecheck + tests**

Run (in `glint`): `npx tsc --noEmit` — PASS (Task 4's call-site error is now resolved). Then `npx vitest run` — PASS.

- [ ] **Step 3: Commit**

```bash
git add glint/src/recorder/TrimView.tsx
git commit -m "feat(p20): trim window EditState + undo/redo + segment/fade export wiring"
```

---

## Task 6: Per-segment speed UI + timeline badge + playback preview (§5)

**Files:**
- Modify: `glint/src/recorder/TrimView.tsx`
- Modify: `glint/src/recorder/TrimTimeline.tsx`
- Modify: `glint/src/recorder/trim.css`

**Interfaces:**
- Consumes: `setSpeed` (Task 3), `selected`/`selectedId`, `commit`, `edit`, `clips` (Task 5).

- [ ] **Step 1: Add a speed control + handler in TrimView**

After `doDelete`, add:
```tsx
  const SPEEDS = [0.5, 1, 1.5, 2];
  const selSpeed = selected?.speed ?? 1;
  const canSpeed = selectedId != null && exporting === null;
  const setSel = useCallback((k: number) => {
    if (selectedId == null) return;
    commit({ ...edit, clips: setSpeed(clips, selectedId, k) });
  }, [commit, edit, clips, selectedId]);
```
Add the segmented control to the transport row (after the undo/redo buttons):
```tsx
        <span className="trim-spacer" />
        <div className="trim-speedctl" role="group" aria-label="Segment speed">
          {SPEEDS.map((k) => (
            <button
              key={k}
              className={`trim-speedbtn${selSpeed === k ? " trim-speedbtn--on" : ""}`}
              disabled={!canSpeed}
              onClick={() => setSel(k)}
              title={`Play the selected section at ${k}×`}
            >{k}×</button>
          ))}
        </div>
```

- [ ] **Step 2: Add the playback-rate preview**

In `onTimeUpdate`, after computing `t` and before `setPlayhead(t)`, set the rate from the kept clip under the playhead:
```tsx
    const cur = clips.find((c) => c.kept && t >= c.start - 0.02 && t < c.end);
    const rate = cur?.speed ?? 1;
    if (v.playbackRate !== rate) v.playbackRate = rate;
```
And when scrubbing/pausing reset to 1: in `scrub`'s `"start"` branch add `v.playbackRate = 1;` right after the pause line (`v.pause()`), so a paused seek previews at normal speed.

- [ ] **Step 3: Show a speed badge on non-1× clips in the timeline**

In `TrimTimeline.tsx`, render a badge inside each non-1× kept clip block. Replace the clip `map` body:
```tsx
      {clips.map((c) => (
        <div
          key={c.id}
          className={`trim-clip${c.kept ? "" : " trim-clip--gap"}${c.id === selectedId ? " trim-clip--sel" : ""}`}
          style={{ left: pct(c.start), width: pct(c.end - c.start) }}
        >
          {c.kept && c.speed !== 1 && <span className="trim-speed-badge">{c.speed}×</span>}
        </div>
      ))}
```
(The badge must be non-interactive: the clip divs already are visual-only; the badge inherits `pointer-events: none` from `.trim-clip` — see CSS below.)

- [ ] **Step 4: Add CSS**

Append to `glint/src/recorder/trim.css`:
```css
/* Segment speed control (transport) */
.trim-speedctl { display: inline-flex; gap: 2px; }
.trim-speedbtn {
  min-width: 30px; height: 26px; padding: 0 6px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--text-dim); background: var(--bg-elev, rgba(128,128,128,.12));
  border: 1px solid var(--border); border-radius: var(--r1, 4px); cursor: pointer;
}
.trim-speedbtn--on { color: var(--text); border-color: var(--accent); background: var(--accent-subtle, rgba(91,124,250,.16)); }
.trim-speedbtn:disabled { opacity: .45; cursor: default; }

/* Per-clip speed badge on the timeline */
.trim-speed-badge {
  position: absolute; top: 2px; right: 3px;
  font-size: 9px; line-height: 1; padding: 1px 3px;
  color: #fff; background: rgba(8,9,13,.62); border-radius: 3px;
  font-variant-numeric: tabular-nums; pointer-events: none;
}
```

- [ ] **Step 5: Verify + gate**

Run (in `glint`): `npx tsc --noEmit` — PASS. `npx vitest run` — PASS.

- [ ] **Step 6: Commit**

```bash
git add glint/src/recorder/TrimView.tsx glint/src/recorder/TrimTimeline.tsx glint/src/recorder/trim.css
git commit -m "feat(p20): per-segment speed control, timeline badge, playback preview"
```

---

## Task 7: Fade in/out steppers (§4)

**Files:**
- Modify: `glint/src/recorder/TrimView.tsx`
- Modify: `glint/src/recorder/trim.css`

**Interfaces:**
- Consumes: `commit`, `edit`, `fadeIn`, `fadeOut` (Task 5).

- [ ] **Step 1: Add fade handlers**

After `setSel` in TrimView, add:
```tsx
  const FADE_MAX = 2;
  const bump = (which: "fadeIn" | "fadeOut", delta: number) => {
    const cur = which === "fadeIn" ? fadeIn : fadeOut;
    const next = Math.max(0, Math.min(FADE_MAX, Math.round((cur + delta) * 4) / 4)); // 0.25 steps
    if (next === cur) return;
    commit({ ...edit, [which]: next });
  };
```

- [ ] **Step 2: Add the fade steppers to the actions row**

In the `trim-actions` block, before the `trim-spacer`, add (only meaningful when there's video, which is always; keep them always visible):
```tsx
        <div className="trim-fades">
          <FadeStepper label="Fade in" value={fadeIn} disabled={exporting !== null} onDelta={(d) => bump("fadeIn", d)} />
          <FadeStepper label="Fade out" value={fadeOut} disabled={exporting !== null} onDelta={(d) => bump("fadeOut", d)} />
        </div>
```
Add a small local component above `return` (or at file bottom, outside `TrimView`):
```tsx
function FadeStepper({ label, value, disabled, onDelta }: {
  label: string; value: number; disabled: boolean; onDelta: (d: number) => void;
}) {
  return (
    <div className="trim-fade" title={`${label} (0–2s)`}>
      <span className="trim-fade-label">{label}</span>
      <button className="trim-fade-btn" disabled={disabled || value <= 0} onClick={() => onDelta(-0.25)}>−</button>
      <span className="trim-fade-val">{value === 0 ? "off" : `${value}s`}</span>
      <button className="trim-fade-btn" disabled={disabled || value >= 2} onClick={() => onDelta(0.25)}>+</button>
    </div>
  );
}
```

- [ ] **Step 3: Add CSS**

Append to `trim.css`:
```css
/* Fade steppers (actions row) */
.trim-fades { display: inline-flex; gap: 12px; align-items: center; }
.trim-fade { display: inline-flex; align-items: center; gap: 4px; }
.trim-fade-label { font-size: 11px; color: var(--text-dim); }
.trim-fade-btn {
  width: 20px; height: 20px; line-height: 1; font-size: 13px;
  color: var(--text); background: var(--bg-elev, rgba(128,128,128,.12));
  border: 1px solid var(--border); border-radius: var(--r1, 4px); cursor: pointer;
}
.trim-fade-btn:disabled { opacity: .4; cursor: default; }
.trim-fade-val { min-width: 26px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text); }
```

- [ ] **Step 4: Verify + gate**

Run (in `glint`): `npx tsc --noEmit` — PASS. `npx vitest run` — PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/TrimView.tsx glint/src/recorder/trim.css
git commit -m "feat(p20): fade in/out steppers"
```

---

## Task 8: Audio waveform in the timeline (§3)

**Files:**
- Modify: `glint/src/recorder/TrimView.tsx`
- Modify: `glint/src/recorder/TrimTimeline.tsx`
- Modify: `glint/src/recorder/trim.css`

**Interfaces:**
- Consumes: `trimWaveform` (Task 4); `TrimTimeline` gains a `waveform: number[] | null` prop.

- [ ] **Step 1: Fetch the waveform on open (TrimView)**

Add state near the other `useState`s:
```tsx
  const [waveform, setWaveform] = useState<number[] | null>(null);
```
Import `trimWaveform`:
```tsx
import { trimTarget, trimProbe, trimExport, trimWaveform, type ProbeResult } from "../lib/trim";
```
In the init effect, after `setEdit({ clips: initClips(...) … })` and only when audio exists, fetch peaks:
```tsx
        if (p.has_audio) {
          trimWaveform(t.path, 800).then(setWaveform).catch(() => setWaveform(null));
        }
```
Pass it to the timeline:
```tsx
        <TrimTimeline
          clips={clips} duration={duration} playhead={playhead}
          selectedId={selectedId} onScrub={scrub} waveform={waveform}
        />
```

- [ ] **Step 2: Render the waveform behind the clips (TrimTimeline)**

Add `waveform` to the prop type:
```tsx
}: {
  clips: Clip[]; duration: number; playhead: number;
  selectedId: number | null;
  onScrub: (t: number, phase: "start" | "move" | "end") => void;
  waveform: number[] | null;
}) {
```
Just inside the `.trim-track` div (before the clips `map`), render bars:
```tsx
      {waveform && (
        <div className="trim-wave" aria-hidden>
          {waveform.map((p, i) => (
            <span
              key={i}
              className="trim-wave-bar"
              style={{ left: `${(i / waveform.length) * 100}%`, height: `${Math.max(6, p * 100)}%` }}
            />
          ))}
        </div>
      )}
```
The gap (deleted) blocks already paint over the waveform with a dimming overlay (`.trim-clip--gap`), so removed regions read as dimmed — no extra work.

- [ ] **Step 3: Add CSS**

Append to `trim.css`:
```css
/* Audio waveform behind the timeline clips */
.trim-wave { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.trim-wave-bar {
  position: absolute; bottom: 0; width: 1px;
  background: var(--text-faint, rgba(128,128,128,.5));
  transform: translateX(-0.5px);
}
```
Ensure gap clips dim what's behind them — if `.trim-clip--gap` isn't already semi-opaque over the track, confirm it has a background like `rgba(8,9,13,.55)` (check the existing rule; if it's fully transparent, add `background: rgba(8,9,13,.5);` so the waveform reads as dimmed under gaps).

- [ ] **Step 4: Verify + gate**

Run (in `glint`): `npx tsc --noEmit` — PASS. `npx vitest run` — PASS.

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/TrimView.tsx glint/src/recorder/TrimTimeline.tsx glint/src/recorder/trim.css
git commit -m "feat(p20): audio waveform under the trim timeline"
```

---

## Final integration & merge

- [ ] Full green gate from a clean tree: `glint/src-tauri` → `cargo clippy --all-targets` (0 warnings) + `cargo test`; `glint` → `npx tsc --noEmit` + `npx vitest run`.
- [ ] Manual end-to-end (dev app → record something with audio → open trim):
  - Waveform renders and aligns to audio; deleted regions read dimmed.
  - Split a clip, set a segment to 2× (badge shows), export → that section plays at 2× and the file is shorter.
  - Set fade in/out → exported file fades at both ends.
  - Undo several edits, then redo them (Ctrl+Z / Ctrl+Shift+Z + buttons).
  - Playback preview: playing over a 2× segment speeds up; scrubbing/paused previews at 1×.
  - Overwrite + Save-copy both produce valid, seekable files; a no-op (no cuts/speed/fade) is rejected with "no changes to save".
- [ ] Add a **Phase 20** entry to `docs/superpowers/ROADMAP.md` (move the trim follow-ups out of "Planned"; note clip reordering stays deferred).
- [ ] Present to the user for at-screen sign-off, then merge `phase-20-trim-upgrades` → `master` with `--no-ff`.

---

## Self-Review

**Spec coverage:**
- §1 model → Task 1 (Rust `KeepSegment`/`output_duration`) + Task 3 (TS `speed`/`keptSegments`/`outputDuration`). ✔
- §2 redo → Task 5 (undo/redo stacks + button + Ctrl+Shift+Z). ✔
- §3 waveform → Task 2 (Rust `peaks_from_pcm_s16le` + command) + Task 4 (`trimWaveform`) + Task 8 (fetch + render). ✔
- §4 fades → Task 1 (ffmpeg fade/afade + is_noop) + Task 5 (fadeIn/out in EditState + export) + Task 7 (steppers). ✔
- §5 speed → Task 1 (setpts/atempo + validate range) + Task 3 (model) + Task 6 (control, badge, playback preview). ✔
- §6 contract → Task 1 (`recorder_trim_export` sig, `validate_segments`, `is_noop`) + Task 4 (`trimExport`) + Task 5 (wiring). ✔

**Placeholder scan:** No TBD/TODO. The Task 4 "commit while tsc red" note is an explicit, resolved-next-task instruction with a stated alternative, not a placeholder.

**Type consistency:** `KeepSegment {start,end,speed}` identical in Rust (serde) and the TS `trimExport` payload; `keptSegments`/`outputDuration`/`setSpeed` names match across Tasks 3/5/6; `EditState {clips,fadeIn,fadeOut}` consistent across Tasks 5/6/7/8; `waveform: number[] | null` prop matches between Task 8's TrimView and TrimTimeline; Rust `fade_in`/`fade_out` ↔ JS `fadeIn`/`fadeOut` (Tauri camel↔snake) consistent with `recorder_trim_export`.
