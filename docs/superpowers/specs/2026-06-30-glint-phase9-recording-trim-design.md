# Glint Phase 9 — Recording Trim / Quick-Edit — Design Spec

**Date:** 2026-06-30
**Status:** Approved (brainstorm). Awaiting plan.
**Builds on:** Phase 8 Screen Recorder (R1 video / R2 audio / R3 webcam), all shipped to `master`.

## Goal

Let the user **trim a finished recording** — cut dead air from the start/end and remove
sections from the middle — via a **multi-cut timeline**. Available both immediately after
recording (the post-recording HUD) and later from the Library. Fully local; no cloud, no
network, no new accounts. Stays inside **recorder isolation**.

## Scope (V1)

**In:** a reusable trim window with a video player + multi-cut timeline (split + delete
keep-regions), gap-skipping preview playback, frame-accurate export via one ffmpeg pass,
and two save modes (Save copy / Overwrite). Entry points: HUD **Trim** action + Library
**Trim** action on `kind="recording"` rows.

**Deferred (explicitly out of V1):** clip **reordering**, redo (undo only), audio
waveform display, fades/transitions, speed changes, loading a different file into an
already-open trim window, and storing duration in the DB (probed on open instead).

## Approach decision

**Cut engine = Approach A — single-pass `filter_complex`** (chosen over extract-then-concat
and stream-copy). One ffmpeg process trims each keep-region and `concat`-joins them with a
single re-encode → **frame-accurate** cuts, audio handled in the same graph. Stream-copy was
rejected because the recorder encodes with `-preset ultrafast` (long GOP), so `-c copy` cuts
would snap to keyframes seconds away from the chosen point.

## Architecture & components

**New backend module `recorder/trim.rs`** (recorder-owned; uses the ffmpeg sidecar +
`recorder::thumb` + `crate::db`; imports nothing from `editor/`/`capture/`/`overlay/`):

- `recorder_open_trim(id, path)` — stashes `TrimTarget { id, path }` in a new
  `RecorderTrimState(Mutex<Option<TrimTarget>>)` and builds the trim window. Mirrors the
  `rec_hud_data` / region-selector pattern of passing context to a window via state.
- `recorder_trim_target()` → `{ id, path }` — the window reads its target back.
- `recorder_trim_probe(path)` → `{ duration_secs, has_audio, fps, width, height }` — runs the
  **ffprobe sidecar** (`-show_streams -show_format -of json`) and parses it. Authoritative
  for audio-stream presence (drives the cut graph), duration, and `fps` (from the video
  stream's `avg_frame_rate`, which the timeline's frame-step uses for the `1/fps` nudge).
- `recorder_trim_export(src_path, keep: [(start,end)…], mode: "copy"|"overwrite")` — builds
  the `filter_complex`, runs the ffmpeg sidecar, emits `rec-trim-progress`, writes a temp
  file, then commits per mode; regenerates the thumbnail; updates the Library.

**Window** — `windows.rs` gains `build_trim_window(app)`: a **normal decorated, focused,
resizable** app window (label `rec-trim`), unlike the transparent recorder overlays. Built
from an async command (off-main-thread, per the window-build rule). Single instance.

**Frontend** — new route `#/rec-trim` → `TrimView.tsx` (+ `TrimTimeline.tsx` sub-component)
and `lib/trim.ts` (typed invokes). `<video>` plays the file via `convertFileSrc` (asset
protocol). Duration + `has_audio` come from `recorder_trim_probe`; the `<video>` element
drives playback/seeking.

**New plumbing** (each on the new-window checklist):
1. **Asset protocol** — enable `app.security.assetProtocol` in `tauri.conf.json` scoped to
   `Videos\Glint`, granted in the `rec-trim` capability (CSP is already `null`, so `<video>`
   media loads). Force a recompile after the capability edit.
2. **ffprobe sidecar** — add `ffprobe` to `bundle.externalBin` alongside ffmpeg (binary placed
   with the target-triple suffix, git-ignored like the ffmpeg sidecar), resolved via
   `app.shell().sidecar("ffprobe")`.

**Entry points** — the HUD gets a **Trim** button and the Library a **Trim** action on
recording rows; both just `invoke("recorder_open_trim", { id, path })`. These are IPC calls,
not cross-domain Rust imports, so isolation holds (the HUD already calls generic Library
commands by id this way).

**Data** — duration + audio-presence are **probed on open**; no DB schema migration in V1.

## Trim window UX (the multi-cut timeline)

**Layout** (normal resizable window, ~900×600 default):
- **Video player** up top (letterboxed `<video>`).
- **Transport row:** play/pause, `current / output-duration` readout, frame-step.
- **Timeline** along the bottom: a time ruler over a single track spanning the original
  `[0 … D]`. Keep-regions render as solid blocks; deleted regions as dimmed/hatched gaps. A
  **playhead** line tracks playback.
- **Action bar:** `Save copy` · `Overwrite` · `Cancel`, replaced by a progress bar during
  export.

**Split + delete model:**
- Starts as one block `[0 … D]`.
- **Split (S):** divides the block under the playhead in two at the playhead (creates a
  boundary; both halves stay kept). Ignored at an existing boundary (no zero-width blocks).
- **Select:** click a block to highlight it.
- **Delete (Del):** turns the selected block into a gap. The remaining ordered blocks are
  the output.
- **Undo (Ctrl+Z):** reverts the last split/delete (undo stack; redo deferred).

**Gap-skipping preview:** during **play**, when the playhead reaches a deleted gap it jumps
to the next kept region — previewing exactly what export produces. Manual **scrubbing** can
still go anywhere (including gaps) to inspect boundaries.

**Precision:** `←/→` nudge the playhead one frame (`1/fps`); Space = play/pause; Esc =
cancel (confirm if edits exist).

**Guardrails:** can't delete the last remaining block; `Save` disabled when nothing is kept
**or** the keep-set equals the full original (no-op); an `Output: M:SS / original M:SS`
readout always shows the result.

## Cut engine, audio & save flow

**ffmpeg graph (Approach A).** For keep-regions `[(S₀,E₀)…(Sₙ,Eₙ)]`, one sidecar pass.

*Video-only* (probe reports no audio):
```
[0:v]trim=S0:E0,setpts=PTS-STARTPTS[v0]; … ;
[v0][v1]…concat=n=N:v=1:a=0[outv]
→ -map [outv] -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart
```
*Video+audio:* additionally `[0:a]atrim=Si:Ei,asetpts=PTS-STARTPTS[ai]` per region,
interleaved `[v0][a0][v1][a1]…concat=n=N:v=1:a=1[outv][outa]`, plus
`-map [outa] -c:a aac -b:a 192k`. `has_audio` from the probe selects the graph. `N=1` (pure
top-and-tail) flows through the same path.

**Progress.** Export runs `-progress` on the sidecar; the export loop **continuously drains**
the capacity-1 sidecar event channel (safe — unlike live recording, export is a foreground op
we read), computes `out_time / total-kept-duration`, and emits `rec-trim-progress` to the bar.

**Save modes** (both encode to a **temp file first**, then commit — the original is never at
risk mid-encode):
- **Save copy:** temp → final `…(trimmed).mp4` in `Videos\Glint` (counter suffix on
  collision) → extract thumb → **insert a new** `kind="recording"` Library row → emit
  `capture-saved` → close window, toast.
- **Overwrite:** temp → verify (ffmpeg exit 0, output > 1 KB) → **atomic replace** the
  original (`fs::rename`) → regenerate thumb → **update the existing** row's
  bytes/thumb/dimensions → emit `capture-saved` → close. Any failure deletes the temp and
  leaves the original intact + toasts.

**Isolation intact:** `trim.rs` uses only recorder-owned `ffmpeg`/`thumb` + `crate::db` (the
recorder's existing outbound coupling); nothing from `editor/`/`capture/`/`overlay/`. The
recording ffmpeg path (`build_ffmpeg_args`/gdigrab) is **untouched** — trim is a separate pass.

## Error handling

- **Open fails** (file missing/unreadable, ffprobe error) → toast "Couldn't open recording for
  trimming"; window doesn't open.
- **Video won't load** (asset/codec) → in-window message; `Save` disabled.
- **Export fails** (non-zero exit / missing / <1 KB output) → toast "Trim failed"; original
  untouched; window stays open to retry.
- **Overwrite safety:** encode to temp → verify → atomic `rename`; any failure deletes temp,
  original intact.
- **Close during export** → Cancel/close disabled while exporting (progress is modal); the
  window closes itself on success.
- **Single instance:** one trim window at a time — if one is open, `recorder_open_trim`
  focuses it and toasts "Close the current trim first".
- **Guardrails:** can't delete the last block; `Save` disabled when nothing is kept or the
  edit is a no-op.

## Testing

- **Rust unit (TDD):** `build_trim_filtergraph(keep, has_audio)` exact args — video-only,
  video+audio, N=1, N=3; keep-region validation (sorted, non-overlapping, in-bounds, min
  length); output-name derivation incl. `(trimmed)` collision counter; no-op detection;
  ffprobe-JSON parse → `{duration, has_audio, fps, w, h}`.
- **Frontend (vitest):** the timeline reducer as a pure model — split / delete / undo,
  "can't delete last block", "no zero-width split", and keep-regions derived from the clip
  list.
- **At-screen acceptance** (manual checklist doc): real ffmpeg cut, gap-skipping playback,
  Save copy → new Library row, Overwrite → in-place + refreshed thumb, failure leaves the
  original intact.

**Hard gates:** recorder isolation holds (`trim.rs` imports nothing from
`editor/`/`capture/`/`overlay/`); the recording ffmpeg path (`build_ffmpeg_args`/gdigrab) is
untouched.

## Out of scope (project-wide, unchanged)

Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls,
scrolling capture, QR/barcode scan, AI/LLM features, GIF recording/export.
