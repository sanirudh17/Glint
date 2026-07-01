# Phase 9 — Recording Trim / Quick-Edit — Acceptance

**Branch:** `phase-9-recording-trim` (base `1ff9700`).
**Spec:** `docs/superpowers/specs/2026-06-30-glint-phase9-recording-trim-design.md`
**Plan:** `docs/superpowers/plans/2026-06-30-glint-phase9-recording-trim.md`

Trim a finished recording via a multi-cut timeline (split + delete keep-regions),
gap-skipping preview playback, and a single frame-accurate ffmpeg pass. Opened from the
post-recording HUD and from Library recording rows. Save copy or Overwrite. Fully local;
recorder isolation preserved.

## Automated gate (all green)

- **Rust:** `cd glint/src-tauri && cargo test --lib` → **80 passed** (2 ignored). Includes 9
  `recorder::trim` unit tests (filtergraph video-only / video+audio / N=1, keep validation,
  no-op, name derivation, ffprobe-JSON parse).
- **Frontend types:** `cd glint && npx tsc --noEmit` → clean.
- **Frontend unit:** `npx vitest run` → **51 passed** (incl. 5 `trimModel` timeline-reducer tests).
- **Bundle:** `npx vite build` → built OK.

## Hard gates (must stay true)

- **Recorder isolation:** `grep -rnE "crate::(capture|editor|overlay)" glint/src-tauri/src/recorder`
  → **no matches**. `trim.rs` imports only `crate::db` / `crate::Db` + recorder-owned
  `thumb`/`windows`/`ffmpeg` + tauri/shell/serde.
- **Recording ffmpeg path untouched:** `git diff 1ff9700..HEAD -- glint/src-tauri/src/recorder/ffmpeg.rs`
  → **0 lines**. `build_ffmpeg_args` / gdigrab / WASAPI capture are unchanged; trim is a
  separate pass over the finished MP4.
- **Window-build rule:** `recorder_open_trim` is `#[tauri::command(async)]` (builds a WebView2
  window off the main thread — a sync command would deadlock all windows).

## At-screen checklist (manual — run `npm run tauri dev`)

Open:
- [ ] Record a short clip → HUD **Trim** (scissors) opens the trim window for that clip.
- [ ] Library recording row → **Trim** opens the same window. A **screenshot** row shows **no** Trim.
- [ ] The `<video>` plays via the asset protocol (not black) and scrubbing works.
- [ ] Single-instance: opening Trim while one is open **focuses** it + toasts "Close the current trim first".

Edit:
- [ ] **Drag the timeline** — press and drag anywhere on the track; the red playhead
      follows the cursor instantly (even dragging past the track edges), and the video
      keeps up without freezing on a fast drag.
- [ ] Space play/pause; click the track to seek; `←/→` frame-step (1/fps).
- [ ] **S** splits the block under the playhead; splitting on a boundary is a no-op (no zero-width block).
- [ ] Select a block + **Del** removes it (hatched gap); **can't** remove the last remaining block.
- [ ] **Playback skips the gap** (jumps to the next kept region) — matches the exported result.
- [ ] **Ctrl+Z** undoes the last split/delete; the `Output: M:SS / M:SS` readout updates live.
- [ ] Save disabled on a no-op (keep-set == full original) or when nothing is kept.

Save:
- [ ] **Save copy** → progress bar → window closes → a new `… (trimmed).mp4` row appears in the
      Library with a correct thumbnail and plays back un-corrupted.
- [ ] **Overwrite** (on a throwaway clip) → replaces the original in place, refreshes the thumb,
      keeps the same Library row; playback is the trimmed result.
- [ ] Both a **video-only** recording and a **video+audio** recording trim correctly (audio stays
      in sync in the output).
- [ ] Failure safety: if export fails, the **original is intact** and a "Trim failed" toast shows;
      the window stays open to retry. (Overwrite moves the original to `.trimbak` and only removes
      it once the new file is safely in place — verified rollback-safe.)

Open in Glint (video files):
- [ ] Settings → General toggle is ON; right-click a **video** in Explorer (mp4/mov/mkv/
      webm/avi/m4v/wmv) → **Open in Glint** → the trim window opens and the video plays
      (asset access granted for that specific file even outside `Videos\Glint`).
- [ ] Works both **warm** (Glint already open) and **cold** (Glint closed → launches).
- [ ] **Save copy** writes `… (trimmed).mp4` next to the source and adds a Library row;
      **Overwrite** replaces the original video in place (rollback-safe). Opening a known
      Glint recording this way still updates its existing Library row on Overwrite.
- [ ] A right-clicked **image** still opens the editor (unchanged).

## Deferred (out of V1, unchanged from spec)

Clip reordering, redo (undo only), audio waveform, fades/transitions, speed changes, loading a
different file into an open trim window, storing duration in the DB (probed on open instead).
