# Phase 20 — Trim Editor Upgrades (Design Spec)

**Date:** 2026-07-03
**Branch:** `phase-20-trim-upgrades`
**Status:** Approved design — ready for implementation plan

## Goal

Deepen the recording trim window with four upgrades, all inside the recorder-isolated
`trim.rs` / `recorder/` boundary (no capture/editor imports):

1. **Redo** — pair a redo stack with the existing undo.
2. **Audio waveform** — show the recording's waveform under the timeline for precise cuts.
3. **Fades in/out** — optional fade-in/out on the exported output (video + audio).
4. **Per-segment speed** — each kept segment gets its own speed (0.5× / 1× / 1.5× / 2×).

**Explicitly out of scope (stays deferred):** clip reordering (biggest model change, least
value for screen recordings), speeds outside [0.5, 2] (would need `atempo` chaining).

The unifying change: the export contract evolves from merged keep-ranges `(start,end)[]`
to **per-segment `{start, end, speed}[]` + `fade_in`/`fade_out`**. Everything else builds
on that.

---

## §1 — Edit-state model (foundation)

**Today:** `Clip = { id, start, end, kept }` (trimModel.ts). Clips partition `[0, duration]`;
`keepRanges` merges *adjacent kept* clips into `(start,end)[]` for export.

**Changes:**
- `Clip` gains **`speed: number`** (default `1`). `splitClips`/`setKept` preserve it; a split
  copies the parent's speed to both halves.
- The window's editable state is one object: **`EditState = { clips: Clip[]; fadeIn: number;
  fadeOut: number }`** (fades in seconds, `0` = off). Undo/redo snapshot this whole object.
- **New export selector** replaces `keepRanges` for export:
  `keptSegments(clips): { start, end, speed }[]` — kept clips **in source order, NOT merged**
  (a speed boundary between adjacent kept clips must remain a boundary). `keepRanges` may stay
  for any display use, but export uses `keptSegments`.
- The **editing timeline stays source-time**: a 2× clip still occupies its source `[start,end]`
  on the timeline, so speed never distorts the timeline or the waveform layout. Speed affects
  only the *output*.

**Output-duration helper (shared concept, implemented both sides):**
`outputDuration(segments) = Σ (end − start) / speed`. Used by the TS "Output" readout + fade-out
positioning, and by Rust for export-progress scaling.

---

## §2 — Redo

**Today:** `history: Clip[][]` (undo stack); `pushHistory()` snapshots `clips` before each edit;
`doUndo()` pops the last snapshot.

**Design:**
- Two stacks of `EditState`: `undoStack` and `redoStack`.
- Any mutating action calls `commit(next)`: pushes the *current* state onto `undoStack`, clears
  `redoStack`, sets state to `next`.
- `undo()`: if `undoStack` non-empty, push current → `redoStack`, pop `undoStack` → state.
- `redo()`: if `redoStack` non-empty, push current → `undoStack`, pop `redoStack` → state.
- Keys: **Ctrl+Z** = undo, **Ctrl+Shift+Z** = redo. Redo button beside the undo button
  (`Redo2` lucide icon), disabled when `redoStack` empty.
- Close-confirm ("Discard your trim edits?") triggers when `undoStack` non-empty (unchanged
  intent — any edit history means unsaved changes).

Because snapshots are the full `EditState`, speed and fade changes are undoable/redoable too.

---

## §3 — Audio waveform

**New Rust command** (in `trim.rs`):
```rust
#[tauri::command(async)]
pub async fn recorder_trim_waveform(app, path: String, buckets: u32) -> Result<Vec<f32>, String>
```
- Runs the ffmpeg sidecar to decode audio to **mono `s16le` at a low sample rate** (e.g.
  `-ac 1 -ar 8000 -f s16le -`), reads stdout, and reduces the samples into `buckets` normalized
  peak values in `[0, 1]` (per-bucket max |sample| / i16::MAX). A **pure** helper
  `peaks_from_pcm_s16le(bytes: &[u8], buckets: usize) -> Vec<f32>` does the bucketing and is
  unit-tested; the command is the thin ffmpeg+IO wrapper.
- On any failure (no audio track, ffmpeg error) → returns `Err`; the frontend treats that as
  "no waveform" and renders the timeline as today (no crash, no blocking).

**Frontend:**
- `lib/trim.ts` adds `trimWaveform(path, buckets): Promise<number[]>`.
- `TrimView` fetches the waveform **once** after a successful probe *iff* `probe.has_audio`,
  stores `number[] | null`.
- `TrimTimeline` renders the peaks as a row of thin bars **behind** the clip blocks, positioned
  by source time (bucket *i* → x = `i/buckets * width`). Deleted (`!kept`) regions render the
  bars dimmed (reuse the existing removed-region styling), so you see which audio you're cutting.
- Waveform is purely decorative/aid — it never affects export or model state.

---

## §4 — Fades in/out

**UI:** two compact steppers in the actions/transport row — **Fade in** and **Fade out** — each
`0–2.0 s` in `0.25 s` steps, default `0` (off). Changing a fade is a committed edit (undoable).

**Export (ffmpeg):** applied to the **concatenated output**, after the per-segment concat
produces `[cv]`/`[ca]`:
- Video: `fade=t=in:st=0:d=IN` and/or `fade=t=out:st=(outDur−OUT):d=OUT`.
- Audio: `afade=t=in:st=0:d=IN` and/or `afade=t=out:st=(outDur−OUT):d=OUT`.
- `outDur` is the speed-aware output duration (§1 helper). Fades with duration `0` are omitted.
- If both fades are `0`, the filter graph is byte-identical to the no-fade path.

Fades apply to the whole output (not per-segment) — a single graceful in at the start and out at
the end, which is the screen-recorder use case.

---

## §5 — Per-segment speed

**UI:**
- Reuse the existing **playhead-based selection** (the kept clip under the playhead — same target
  `delete` uses). A small segmented control **0.5× · 1× · 1.5× · 2×** (in the transport row) shows
  the selected clip's speed and sets it on click (a committed edit). Disabled when no clip is
  selected or during export.
- The timeline block for a non-1× clip shows a small speed badge (e.g. `2×`) so the edit is
  visible at a glance.

**Export (ffmpeg), per kept segment *i* with `speed = k`:**
- Video: `[0:v]trim=s:e,setpts=(PTS-STARTPTS)/k[vi]`.
- Audio: `[0:a]atrim=s:e,asetpts=PTS-STARTPTS,atempo=k[ai]`.
- `k = 1` omits the `/k` and `atempo` (byte-identical to today's segment), so a no-speed export is
  unchanged. `k ∈ {0.5, 1, 1.5, 2}` — all within a single `atempo` (0.5–2.0), no chaining.
- Segments then concat as today; fades (§4) apply after concat.

**Output duration & progress:** `outDur = Σ (e − s)/k`. Rust computes this to scale the
`out_time_us` progress percentage (replacing today's `total_kept`). TS computes the same for the
"Output: m:ss / m:ss" readout and the fade-out start.

**Playback preview:** during gap-skipping playback (`onTimeUpdate`), set `video.playbackRate` to
the speed of the kept clip currently under the playhead, so the preview matches the exported pace.
Reset to `1` when paused/scrubbing.

---

## §6 — Export contract + validation

`recorder_trim_export` signature changes:
- `keep: Vec<(f64, f64)>` → **`segments: Vec<KeepSegment>`** where
  `KeepSegment { start: f64, end: f64, speed: f64 }` (serde `Deserialize`).
- Add **`fade_in: f64, fade_out: f64`**.

`build_trim_args(input, output, segments: &[KeepSegment], has_audio, fade_in, fade_out)` — rebuilt
per §5/§4; existing tests updated + new tests for speed segments and fades.

`validate_keep` → **`validate_segments(&[KeepSegment], duration)`**: same non-empty / ordered /
in-bounds / non-overlapping checks on `(start,end)`, **plus** `speed ∈ [0.5, 2]` (reject NaN/0/out
of range). Returns sorted `Vec<KeepSegment>`.

`is_noop`: true only when there is a **single full-span segment AND `speed == 1` AND
`fade_in == 0` AND `fade_out == 0`** (any speed/fade change is a real edit worth exporting).

The overwrite/copy commit path, temp-file safety, thumbnail, DB row, and progress draining are
unchanged.

---

## Architecture & isolation

- All backend work stays in `recorder/trim.rs` (pure helpers: `keptSegments` is TS-side;
  `peaks_from_pcm_s16le`, `build_trim_args`, `validate_segments`, `is_noop`, `output_duration`
  are Rust, pure, unit-tested). The waveform command is the only new IPC surface.
- Frontend: `trimModel.ts` (model + selectors), `TrimView.tsx` (state, undo/redo, keys, controls),
  `TrimTimeline.tsx` (waveform + speed badges), `lib/trim.ts` (IPC wrappers), `trim.css`.
- **Recorder isolation honored** — `trim.rs` imports only recorder `ffmpeg`/`thumb` + `crate::db`.

## Testing

- **Rust (pure, unit-tested):** `peaks_from_pcm_s16le` (bucketing, empty, normalization);
  `build_trim_args` (speed=1 unchanged; per-segment setpts/atempo; fade-in/out filters; combined);
  `validate_segments` (speed range, overlap, bounds); `is_noop` (speed/fade make it non-noop);
  `output_duration` (speed-weighted sum).
- **TS (vitest):** `trimModel` — split/delete preserve speed; `keptSegments` order + no-merge
  across speed boundary; undo/redo stack behavior; `outputDuration`.
- **Manual:** waveform renders + aligns; per-segment speed exports at correct pace; fades visible;
  redo works; playback preview matches; export produces a valid, seekable file.
- Green gate before merge: `cargo clippy --all-targets` (0 warnings) + `cargo test`; `npx tsc
  --noEmit` + `npx vitest run`.

## Sequencing (ascending risk)

§2 Redo → §1 model (add `speed`, `EditState`, `keptSegments`) → §6 export contract + §5 speed
(they move together) → §4 fades → §3 waveform. Redo and the model refactor land first (pure,
low-risk); speed + the export-contract change are the core; fades and waveform layer on top.

## Out of scope (project-wide, unchanged)
Cloud/upload/share, teams/auth/network, scrolling capture, AI features, GIF export, clip
reordering, trim speeds outside [0.5, 2].
