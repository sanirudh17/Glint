# Glint — Roadmap

Local-first Windows screenshot tool (CleanShot X clone). Everything stays on-device — no
cloud, accounts, auth, or network. Single user. Recorder path stays isolated from the
capture/library/editor path.

## Shipped

- **Phase 1 — App shell** (tray-core, main window, settings).
- **Phase 2 — Screenshots** (region/window/fullscreen capture, frozen-overlay selection).
- **Phase 3 — HUD** (post-capture floating action bar).
- **Phase 4 — Auto-save + Library** (Pictures\Glint, SQLite index, thumbnails, recents).
- **Phase 5a — Annotation editor** (Konva; arrow/line/rect/ellipse/text/pen/highlight/blur/step,
  undo/redo, native-res export: copy/save/drag).
- **Phase 5b — Crop + Backgrounds/Framing** (non-destructive crop; solid/gradient/transparent
  backdrop, padding, rounded corners, drop shadow, aspect presets; live WYSIWYG; native-res
  export). *Merged to master.*
- **Phase 5c — `.glint` save/load** (versioned, self-contained document: embedded base image +
  opaque doc {annotations, crop, frame}; Save=project / Export=PNG; Ctrl+S; dirty indicator in
  the titlebar; Home "Open Project" + Recent Projects). Also shipped in the at-screen round: a
  scrub **eraser** (sized footprint, partial freehand erase), **copy-path hotkey** wired up, and
  a **capture-overlay reuse** speedup (pre-warmed webview). *Merged to master.*
- **Phase 6 — "Open in Glint"** (Explorer integration + edit any image). HKCU shell verb under
  `SystemFileAssociations\image\shell\Glint` (the `image` perceived-type covers png/jpg/jpeg/
  webp/bmp/gif in one entry) running `glint.exe "%1"` — no admin. Auto-registers on first run +
  self-heals each launch; Settings → General toggle (default ON) adds/removes it. Cold start
  parses argv; warm start routes through `tauri-plugin-single-instance`; both funnel into one
  `open_image_path` that decodes → re-encodes PNG → opens an **Untitled** external doc (no Library
  row). Non-destructive: Save = new `.glint`, Export = new PNG; the source file is never touched.
  New dep: `winreg`. *Merged to master.* At-screen round fixed a window-hijack bug
  (editor-open navigation must be guarded to the main window — all windows share one `<App/>`).
  Note: on Windows 11 the entry sits under Explorer's "Show more options"; top-level placement
  needs a packaged build + `IExplorerCommand` (future). (See PHASE-6-ACCEPTANCE.md.)
- **Phase 7 — "Pin to Screen"** (floating always-on-top image windows). One borderless,
  transparent `WebviewWindow` per pin (`pin-<n>`), backed by an in-memory `PinState` registry
  (PNG bytes + dims) — ephemeral: closing a pin or quitting clears it, nothing persisted. Pin
  from the post-capture HUD ("Pin") or any Library card ("Pin to screen"). The `/pin` route
  renders `PinApp`: drag to move, mouse-wheel / corner handles to resize (aspect locked, clamped
  80px → monitor), right-click menu (Copy · Save to Library · Opacity 100/75/50/25 · Close),
  hover **×** and Esc to close. Opacity is plain CSS on the `<img>` (no OS window-alpha API).
  Reuses the existing save/thumb/clipboard helpers; no new dependencies; zero recorder coupling.
  *Built — awaiting at-screen.* (See PHASE-7-ACCEPTANCE.md.)
- **Phase 8 — Screen Recorder (R1: core video)** (silent screen recording to MP4). A new
  **isolated** `recorder/` module owns a bundled **ffmpeg** sidecar that captures the screen
  (`gdigrab`) **and** encodes H.264/yuv420p/30 fps/`+faststart` in one process — no Rust capture
  loop. Record the **fullscreen** primary monitor or a dragged **region** (a live, non-frozen
  selector). A 3·2·1 countdown precedes recording; a floating always-on-top **control bar**
  (REC dot · timer · Stop) drives it. Stop is **graceful** — send `q\n` and wait for ffmpeg to
  actually exit (writes a valid `moov`), force-kill only as a 30 s last resort. The finished MP4
  lands in `Videos\Glint\` and inserts one `kind="recording"` Library row (▶ badge; Open/Reveal/
  Delete only). Entry points: tray **Record** submenu (Region/Fullscreen/Stop), the `record`
  hotkey, and a Home button. New deps: `tauri-plugin-shell` (sidecar spawn) + `tokio` (`time`,
  already transitive). **Recorder isolation honored:** capture/editor/library import nothing from
  `recorder/`; the only coupling is the outbound MP4 + Library row + `capture-saved` emit.
  *Shipped — at-screen verified.* (See PHASE-8-RECORDER-R1-ACCEPTANCE.md.)

- **Phase 8 — Screen Recorder (R2: audio)** (system audio + microphone). Both sources are
  **install-free** via **WASAPI** (system = default render endpoint opened in loopback; mic =
  default capture endpoint), streamed as f32le PCM over **Windows named pipes** into the same
  per-segment ffmpeg, which **mixes** (`amix`) and encodes **AAC** (192k) next to the gdigrab
  video. Each source is independently selectable (per-recording **chips** on the selector, seeded
  from new `record_system_audio`/`record_microphone` settings) and **live-mutable** from the
  control bar (mute writes silence, keeping streams continuous + A/V-synced). Pause/resume/concat
  are unchanged — each segment carries its own audio. A source is only opened if enabled at start
  (privacy); each pipe accept is bounded by a 3 s timeout that toasts + drops a failed source
  rather than hanging. New deps: `wasapi`, `tokio` (`net`/`io-util`/`sync`). **Recorder isolation
  still honored.** *Shipped — at-screen verified (system + mic audio confirmed).* (See PHASE-8-RECORDER-R2-ACCEPTANCE.md.)

- **Phase 8 — Screen Recorder (R3: webcam overlay)** (live camera bubble). A circular webcam
  bubble is a recorder-owned on-screen window (`rec-cam`) rendering the default camera via the
  browser `getUserMedia` (video-only, local device, no network). Because it sits on screen and is
  **not** capture-excluded, **gdigrab records it for free** — the ffmpeg/gdigrab pipeline is
  **completely untouched** (no `dshow`, no `overlay` filter). It's draggable, has Small/Medium/Large
  preset sizes, un-mirrored, opens bottom-right of the recording area during the countdown. Enabled
  per-recording via a **Webcam chip** on the selector (seeded from a new `record_webcam` setting) and
  **togglable live** from the control bar — instant, since it's independent of ffmpeg (no segment
  restart). **Recorder isolation still honored** (a sibling window + toggle; recorder imports nothing
  new from capture/editor/overlay). *Shipped — at-screen verified (circle, drag/resize, live
  toggle off/on, ✕, clean teardown on stop).* (See PHASE-8-RECORDER-R3-ACCEPTANCE.md.)

- **Phase 9 — Recording Trim / Quick-Edit** (multi-cut timeline trim of a finished recording). A
  new **isolated** `recorder/trim.rs` opens a normal decorated **trim window** (`rec-trim`) whose
  `<video>` plays the MP4 via the **asset protocol** (`convertFileSrc`). A pure timeline model
  (`trimModel.ts`: split / delete keep-regions / undo) drives a track UI with **gap-skipping
  preview playback** and frame-step (`1/fps` from a bundled **ffprobe** sidecar that also reports
  duration + audio-presence). Export is **one** ffmpeg `filter_complex` pass (`trim`+`concat`,
  re-encode → frame-accurate; audio interleaved when present), always to a **temp file first**,
  then committed as **Save copy** (new `… (trimmed).mp4` + Library row) or **Overwrite**
  (exit-checked, **rollback-safe** in-place replace + refreshed thumb). Opened from the HUD and
  Library recording rows (`recorder_open_trim`, IPC by id — no cross-domain imports). **Recorder
  isolation honored** (`trim.rs` touches only `crate::db` + recorder-owned helpers); the recording
  ffmpeg/gdigrab/WASAPI path is **completely untouched** (0-line diff). New Cargo feature
  `protocol-asset`; new sidecar `ffprobe`. *Shipped — at-screen verified (drag-scrub trim, Save
  copy/Overwrite, video "Open in Glint" via per-extension shell verb).*
  (See PHASE-9-RECORDING-TRIM-ACCEPTANCE.md.)

- **Phase 10 — OCR / Capture Text** (extract selectable text, CleanShot "Capture Text"). A new
  **isolated** `ocr/` module owns the **local** `Windows.Media.Ocr` call: RGBA → BGRA
  `SoftwareBitmap` → `OcrEngine::TryCreateFromUserProfileLanguages` → blocking wait via a
  completion-handler + channel (windows-rs 0.62 dropped `IAsyncOperation::get()`), assembled
  through a pure `assemble_text` core. No cloud, no bundled models. **Capture Text (live)** reuses
  the frozen-overlay selector — the session carries a `CaptureIntent` (`Screenshot` default),
  `begin_ocr_capture` re-tags it to `Text` (hiding the main window first), and `capture_commit`
  branches to `finish_ocr_commit` (crop stays in `capture/`, recognition in `ocr/`); no PNG, no
  Library row. **Extract text** OCRs an existing Library image (`ocr_extract_capture`) or the
  in-memory last capture (`ocr_extract_last`, the HUD path — no fabricated id). A small decorated
  `#/ocr` **review panel** shows editable text, Copy (whole/selection), line+char counts, and an
  empty state; every flow funnels through `publish_and_open` (copy + stash + open). Entry points:
  Home button, tray **Capture** submenu, post-capture **HUD**, and **Library** image cards. New
  Cargo features: `Graphics_Imaging`/`Media_Ocr`/`Storage_Streams` + `windows-future`. **Recorder
  isolation honored** (`ocr/`↔`recorder/` import nothing from each other). *Built — awaiting
  at-screen.* (See PHASE-10-OCR-ACCEPTANCE.md.)

## Planned

- **Deferred CleanShot video-polish** (in-scope, not yet scheduled — parked for a later phase):
  - **Click & keystroke highlighting** during recording (visualise clicks / show pressed keys).
  - **Cursor highlight / spotlight**, cursor hide, and cursor-size options while recording.
  - **Independent webcam layer** — reposition/resize/remove the webcam *after* recording (today
    the bubble is baked into the video at capture time; a post-hoc layer would need a separate
    webcam track, a bigger architectural change).

- **Deferred recorder follow-ups** (accepted gaps): mic RAW capture for a fuller voice timbre,
  true 60 fps via `ddagrab`, and a webcam device picker.

- **Deferred trim follow-ups**: clip reordering, redo, audio waveform, fades/speed changes.

## Out of scope (project-wide, unchanged)
Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls, scrolling
capture, QR/barcode scan, AI/LLM features, GIF recording/export.
