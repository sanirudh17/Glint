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
  **isolated** `ocr/` module runs **local Tesseract 5** (LSTM): preprocess (grayscale → invert
  dark backgrounds → ~3× upscale) → PNG → shell out to the `tesseract` CLI (`-l eng --oem 1
  --psm 6`, console suppressed) → parse, assembled through a pure `assemble_text` core. The
  binary is resolved from the standard install dir / PATH (missing → a clear "winget install
  UB-Mannheim.TesseractOCR" message). **Engine note:** originally `Windows.Media.Ocr`, but it
  proved far less accurate than Snipping Tool on small / dark-mode / terminal text (dropped
  backslash paths, `0.1.0`→`e.l.e`); a probe confirmed the ceiling was the engine, not
  preprocessing, so we switched to Tesseract. Fully local, no cloud. **Capture Text (live)** reuses
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

- **Phase 11 — Recording FX** (CleanShot-style capture-time polish). A new **isolated**
  `recorder/fx/` module: global low-level **mouse + keyboard hooks** (WH_MOUSE_LL / WH_KEYBOARD_LL
  on a dedicated message-pump thread; keyboard hook installed *only* when keystroke display is on
  — privacy) feed a transparent, click-through **`rec-fx` overlay** window that gdigrab records for
  free (the webcam-bubble trick — no ffmpeg-pipeline rewrite). Canvas renderers draw **click
  ripples** (blue left / amber right), a **cursor spotlight** halo, and a bottom-center
  **keystroke** chip strip. **Cursor style** (Normal / Large / XL / Hidden) is a capture-time
  choice — Hidden/enlarged flip gdigrab's `-draw_mouse` and draw our own pointer, so they're set
  before recording (no mid-capture skip); clicks/keys/spotlight are live-togglable in the control
  pill. Effects are baked in at capture time. **Recorder isolation honored** (`recorder/fx/`
  imports nothing from capture/editor/overlay/ocr). *Shipped — at-screen accepted.*

- **Phase 12 — Editor essentials + "Done" hand-off** (CleanShot-parity editing depth). A primary
  **Done** button flattens the current composition to a native-res PNG, hands it to a new
  `editor_done` command that makes it the current capture, hides the editor, and opens the
  existing bottom-left post-capture HUD — the inverse of `editor_open_from_last`, reusing the
  HUD wholesale (zero new HUD UI). Batched with it, a set of small high-value editing wins, all
  as **additive, safe-default** model changes so existing `.glint` docs and tests keep working:
  optional **fill + fill-opacity** for rect/ellipse, **dashed** strokes for line/arrow/rect/
  ellipse, an arrow **start-head** toggle, **Shift-to-45°** angle snap while drawing
  (`snapAngle`, unit-tested), **Duplicate** (Ctrl+D, `duplicateAnnotation` with a +12,+12
  offset), **arrow-key nudge** (1px / 10px with Shift), and **z-order** bring-forward / send-back.
  `model.ts` helpers stay pure and unit-tested. *Shipped — at-screen accepted.*

- **Phase 13 — Window-frame chrome** (the CleanShot "designed mockup" look, OS-neutral). Wraps a
  framed screenshot in a fake application window with **no** macOS traffic-lights or Windows
  caption buttons (a picture-frame convention, not an OS claim). Two styles — **Window** (clean
  title bar, optional centered title) and **Browser** (title bar as an address pill: lock glyph +
  editable cosmetic URL, back/forward chevrons, reload) — each in **light** and **dark**. Built as
  an extension of the existing frame system: pure layout math in `composition.ts`, Konva rendering
  in `EditorStage.tsx`, controls in `FramePanel.tsx`, persisted in the `.glint` doc via
  `SerializedDoc.frame`. The URL is cosmetic text only — nothing is fetched or validated
  (local-first). *Shipped — at-screen accepted.*

- **Phase 14 — Quick Access Overlay** (an accumulating bottom-left tray of recent captures). Each
  capture pushes a card onto a persistent `TrayStore` (capacity-capped, oldest evicted with its
  temp file cleaned up) rendered as a bottom-anchored stack. Per-card actions (Copy · Save↔Reveal ·
  Copy path · drag-out · Annotate · Delete) mirror the HUD; a **Clear all** appears once two or
  more cards stack, and Esc clears the tray. Cards use the **full-resolution** capture PNG so they
  stay crisp under the card's `object-fit: cover` (a downscaled thumb blurred). The tray model
  (`tray.rs`) is pure and unit-tested (push / eviction / remove / mark-saved / clear).
  *Shipped — at-screen accepted.*

- **Phase 15 — Rebindable hotkeys** (change any global shortcut from Settings). A capture-driven
  panel: press **Change**, then the key combo — `keyEventToAccelerator` maps the browser event to
  a Tauri accelerator, validated (`validate_accelerator` requires a Ctrl/Alt/Win modifier, rejects
  Shift-only) and de-duplicated against the other bindings. On save, `settings_set_hotkey`
  re-registers live via `shortcuts::reapply(strict)` and **rolls back** if the OS rejects the combo;
  shortcuts are suspended while capturing so the combo isn't swallowed. In-app instructions, plus
  Reset-to-defaults and Clear. Validation is unit-tested on both the Rust (`hotkeys.rs`) and TS
  (`hotkeys.ts`) sides. *Shipped — at-screen accepted.*

- **Phase 16 — Settings gaps** (settings completeness). Five previously-stubbed settings made real:
  a **custom save folder** (folder picker + write-probe; all save sites — capture, tray-save,
  editor, pin, recorder — routed through one `settings::locations` resolver, recorder-isolation
  safe), **launch-at-login** (HKCU `…\Run` key, self-healing), an opt-in **synthesized shutter
  sound** on capture (in-memory PCM WAV, no shipped asset; later refined to a camera-snap with a
  lead-in silence so the first cold-endpoint play isn't attenuated), **show-in-taskbar** toggle
  (`set_skip_taskbar`, applied at startup), and opt-in **cursor compositing** (Win32 GDI draws the
  pointer into the frozen frame at capture time). Settings persist to SQLite and hydrate at startup.
  *Shipped — at-screen accepted.*

- **Phase 17 — P8 capstone: hardening, cleanup & docs** (close out the planned roadmap; no new
  features). `cargo build` **and** `cargo clippy` made warning-clean: safe clippy autofixes applied,
  a negated float compare rewritten via `partial_cmp` (explicit NaN handling), and the retained
  `too_many_arguments` / `type_complexity` warnings each given a per-site rationale rather than left
  silent. Dead code removed (`LastCapture.saved`, orphaned `close_ocr_window`); the documented,
  test-covered `window_at` reservation kept. A **DPI audit** confirmed every scale-sensitive path
  (overlay / HUD / pin / cursor-composite / capture) reads `monitor.position()` as origin and scales
  by `scale_factor()` — correct, with one documented single-monitor limitation (all paths target the
  **primary** monitor). Live-refresh wiring verified (hotkeys, taskbar, sound, save-dir, Library
  add/delete all apply without restart). Test suite honestly green (121 Rust incl. 2 documented
  ignores + 99 vitest); the bare `#[ignore]` given a reason. ROADMAP reconciled (this entry +
  phases 12–16). **This completes the Phase 0 "P8 — polish" capstone, delivered across P15
  (hotkeys), P16 (settings completeness), and P17 (DPI/refresh hardening, cleanup, tests, docs).**
  *Shipped — at-screen accepted.*

- **Phase 18 — Settings truthfulness + Library rename/search** (make the settings UI tell the
  truth, then make the Library searchable). Three previously-dishonest controls made real:
  **image capture format** now actually encodes PNG / JPEG / WebP with a JPEG **quality** tier
  (a shared `settings::image::encode_save` used by capture auto-save, tray-save and pin; JPEG drops
  the alpha channel RGBA→RGB, WebP is lossless in the `image` crate so the quality slider is
  JPEG-only; editor **Export stays PNG** by deliberate choice); **recording frame rate** is a live
  30/60 selector read by `recorder_start`, and the **codec** — which is genuinely fixed — is shown
  as honest static text (`H.264 · MP4`) instead of a dead dropdown. No control is labelled
  "available in a later phase" any more. Library gains **rename** (inline title edit on each card,
  persisted to a `captures.title` column) and a **working search** matching title, human-readable
  date, or kind — replacing the previously inert search box (captures had been indistinguishable
  "Glint <timestamp>" rows). A **settings-persistence regression** surfaced and was fixed: the new
  `title` column had been added by *both* a plugin-sql migration and `ensure_captures_table`'s
  rusqlite ALTER, so `duplicate column name: title` rejected the whole sql-plugin DB load and made
  every `persistSetting` throw — silently freezing accent/theme/format/fps in the UI. The migration
  was dropped; the column is owned solely by the idempotent rusqlite path, which self-heals existing
  DBs. *Shipped — at-screen accepted.*

- **Phase 19 — Recorder fidelity pack** (three reliability-first recorder quality wins, each with a
  fallback so recording never breaks). **Webcam device picker**: a persisted `webcam_device_id`
  setting + a **Camera** dropdown in Settings (enumerates `videoinput` devices; browsers only reveal
  labels after first camera use, handled with a hint); the `#/rec-cam` bubble requests the chosen
  `deviceId` with `exact` and falls back to the default camera + toast if it's unplugged. **True 60
  fps via `ddagrab`**: the video capture engine swaps GDI `gdigrab` for GPU `ddagrab` (Desktop
  Duplication, `hwdownload,format=bgra` before the unchanged libx264/yuv420p encode). A cached
  pre-flight probe (ddagrab → 1 frame → null muxer) picks the engine **once per session**; any
  failure/timeout falls back to the proven gdigrab path, and the engine is locked for the whole
  recording so pause/resume segments stay concat-copy compatible. Measured result on the dev machine:
  the stream is a true 60-fps-timebase H.264 (`r_frame_rate 60/1`), averaging ~46 fps delivered — a
  large jump over gdigrab's ~30, the remaining gap being libx264-`ultrafast` CPU-encode throughput at
  full resolution, not capture (a hardware encoder would close it — see follow-up). **Fuller mic**:
  the mic voice-EQ was re-voiced — kept the 80 Hz high-pass, added a +1.5 dB warmth shelf ~200 Hz and
  a gentle +3 dB air shelf @ 7.5 kHz, dropped the −2 dB @ 400 Hz cut that thinned the voice; mono-safe
  downmix retained (exclusive-mode native capture was deliberately rejected — it locks the device and
  fails during the comms-app-in-use case common when screen recording, for marginal real-world gain).
  The `build_ffmpeg_args` builder is engine-aware and fully unit-tested (both engines, region crop,
  draw_mouse, hwdownload, audio-input index shift); gdigrab args are byte-identical to before.
  *Shipped — at-screen accepted.*

- **Phase 20 — Trim editor upgrades** (four CleanShot-parity wins on the recording trim window,
  all inside the isolated recorder path). **Redo** (Ctrl+Shift+Z) alongside undo, driven by an
  `EditState` history (`{clips, fadeIn, fadeOut}`) with paired undo/redo stacks. **Audio waveform**
  under the timeline: a `recorder_trim_waveform` command decodes mono s16le @ 8 kHz and buckets it
  into peaks — bucketed over the **timeline length** (`duration × rate`) so bars stay glued to the
  ruler (audio shorter than the video reads as trailing silence), then **auto-gained** to the
  loudest peak and drawn as a bright, center-mirrored trace behind translucent keep-blocks.
  **Fades in/out**: 0.5 s-step steppers (0–2 s) that post-process the concat output with
  `fade`/`afade` (audio on the smoother `qsin` curve); speed-aware fade-out start. **Per-segment
  speed** (0.5/1/1.5/2×) via `setpts`+`atempo`, exported as un-merged `keptSegments` so each speed
  boundary survives concat, with a timeline badge and live playback preview. Two at-screen bugs
  fixed in a follow-up round: segment **selection made sticky** (set on click, not derived from the
  live playhead — so a speed set lands on the section you clicked even as playback moves on), and
  the **preview moved to a `requestAnimationFrame` loop** so per-clip playbackRate switches exactly
  at boundaries instead of bleeding ~250 ms via the coarse `timeupdate` event. A second follow-up
  round: the waveform switched from a **peak envelope to per-bucket RMS energy** (loud/quiet
  passages separate on dense audio, where peaks saturated to full height everywhere), and a
  **keyboard-first timeline zoom** (1/2/4/8×, `+`/`−` or buttons — no scrollbar) that magnifies
  around the playhead and **auto-scrolls to follow** it during playback/stepping (frozen while
  dragging); panning is a single GPU `translateX` on a content layer so children keep plain
  `t/duration` positioning and 60 fps auto-scroll stays cheap. Backend (`trim.rs`) stays pure +
  unit-tested; **recorder isolation honored**. *Shipped — at-screen accepted.*

- **Phase 21 — Independent webcam layer** (reposition/resize/remove the webcam *after* recording).
  An **opt-in** mode (the baked-in bubble stays the default): when **Movable webcam** is on (a
  Settings default or a per-recording sub-chip on the selector), the `rec-cam` bubble is marked
  `WDA_EXCLUDEFROMCAPTURE` so gdigrab/ddagrab records a **clean** screen, and the camera is captured
  **separately** — the bubble webview runs `MediaRecorder(video/webm;codecs=vp8)` (video-only, no
  audio) and streams chunks to a sibling `<stem>.cam.webm` via `recorder_cam_write_chunk` (append
  per `ondataavailable`); pause/resume mirror to the recorder. The bubble's normalized on-screen
  placement is persisted to `<stem>.cam.json` so the trim overlay **starts at the same spot/size**.
  In the trim editor the webcam becomes a **draggable, corner-resizable circular layer** (free move
  + resize about center, Reset, and ✕-to-remove / Add-back). Export composites in the **same single
  ffmpeg pass**: the cam track is trimmed with the **identical** per-segment `trim`/`setpts` as the
  screen, concatenated, circular-alpha-masked (`geq`), overlaid at the chosen source-pixel position,
  then faded — **byte-identical to before when no cam** is present. Safe fallbacks throughout:
  "Movable" implies recording the webcam at all (a lone toggle never yields silently nothing), a
  pre-start check demotes to the baked-in bubble when `vp8` MediaRecorder is unsupported, and export
  drops the overlay (with a toast) if the sidecar is missing/truncated. Pure geometry
  (`camOverlay.ts`: `clampPlacement`/`videoRectInBox`/`toPixels`) and the filter builder are
  unit-tested; a normalized↔source-pixel boundary keeps `CamPlacement` (TS, 0–1) and `CamOverlay`
  (Rust, pixels) cleanly separated. **Recorder isolation honored** (`recorder/cam.rs` + `trim.rs`
  touch only recorder helpers + `crate::db`). Two at-screen fixes folded in: the overlay now starts
  at the recorded placement/size, and global-shortcut reliability was hardened (rebind re-arms on
  every path via a single owner; **custom hotkeys now win at startup** — `shortcuts::register` runs
  *after* the DB hydrates, so a restart no longer silently re-arms the built-in defaults).
  *Shipped — at-screen accepted.*

- **Phase 22 — Hardware encode · webcam shapes · app-wide accent** (three tracks, all inside the
  isolated recorder/settings paths). **Track A — hardware H.264 encoder** (NVENC / QuickSync / AMF,
  automatic, no UI): a session-cached probe picks the fastest working encoder and locks it for the
  whole recording (concat-copy invariant); a `VideoEncoder` enum swaps only the `-c:v` tail, every
  variant emitting H.264/yuv420p. The probe is **representative** — it runs the REAL capture command
  (same engine + hw-device setup, capped to 8 frames) and requires a **non-empty** output file,
  because a hardware encoder can pass a synthetic `lavfi` probe yet fail on the live pipeline while
  ffmpeg still exits 0. On this hybrid-GPU machine that mattered: ddagrab's D3D11 device binds to the
  iGPU, so NVENC died with "no encode device" and wrote an empty file — fixed by naming the D3D11
  device, scoping it to the filter graph, and giving NVENC its own CUDA device (frames are already in
  system memory after `hwdownload`). Any still-unviable encoder falls back to libx264 ("recording
  never breaks"). The probe runs **concurrently** with the cam warmup + countdown so it adds no
  perceived start latency. **Track B — webcam shapes** (circle / rounded / square / rect): a persisted
  `webcam_shape` setting drives a shape-aware bubble window (1:1 vs 16:9), a live `clip-path` preview,
  a selector chip + trim-editor post-hoc control, and a unified rounded-rect `geq` export mask (rect =
  unmasked); shape round-trips through `<stem>.cam.json`. **Track C — app-wide accent**: audited out
  the hardcoded `#5b7cfa`/`#6d8bff` in OCR, region-selector, and trim CSS so `var(--accent)` (already
  applied per-window) now reaches every surface, including hover. Several at-screen fixes folded in:
  the per-recording **Movable chip is now authoritative** (Movable-off bakes the webcam into the
  video even when the Settings default is on — it was silently recording a capture-excluded track),
  the **trim editor opens maximized**, the **recording HUD and screenshot tray are mutually exclusive**
  at the shared bottom-left corner (each displaces the other), the region selector **reveals on first
  paint** (no stale-frame flash, no open delay), and trim zoom/fade controls got a divider so their
  −/+ steppers don't blur together. *Shipped — at-screen accepted.*

- **Phase 23 — Clip reordering** (drag kept segments into a new playback order in the trim editor,
  all inside the isolated recorder path). The timeline model no longer assumes segments stay in
  source order: each clip carries an `order` sort key **decoupled** from its source position, so the
  array stays source-ordered (the timeline/ruler never moves) while a new play order layers on top.
  `keptSegments`/`keptClipsInOrder` sort by `order` and become the single source of truth for the
  filmstrip, the preview loop, and export — `reorderKept` rewrites only the moved clip's key
  (midpoint insertion between neighbors), and `splitClips` seats each new right-half immediately
  after its left in play order. A new **filmstrip** below the timeline shows the kept clips as
  draggable tiles: each tile's **number is its recorded (source-order) identity**, its **left→right
  position is play order**, and chevrons between tiles show the processing direction — so after a
  reorder the numbers read out of sequence (e.g. 2 3 1 4 5), which *is* the indication that clips
  moved (no separate colored cue needed). Drag uses **pointer capture + geometry hit-testing**
  (WebView2-safe — capture keeps the move/up stream as the cursor leaves the tile, geometry never
  misses a target); a press under the drag-slop is a **click that selects** the clip (seating the
  timeline selection + seeking to its start) instead of reordering. The preview **plays in play
  order**: an rAF loop walks `keptSegments` via a play-order cursor, seeking `currentTime` to the
  next segment's start at each boundary and slaving the webcam overlay, with a **⏮ "play from
  start"** transport button (shown only once a real edit exists) to preview the whole updated
  sequence from the top. Export was made **order-preserving** end-to-end: the backend
  `validate_segments` now validates per-segment + overlap on a sorted copy but **returns segments in
  caller (play) order**, so the single `trim`+`concat` pass emits clips in the chosen sequence. Save
  is enabled on a **pure reorder** (not just speed/fade/cut edits). The model stays pure +
  unit-tested (`order` key, `reorderKept`, `segmentIndexAtSource`, play-order `keptSegments`);
  **recorder isolation honored** (only `trimModel.ts` + recorder-owned trim UI/`trim.rs` touched).
  *Shipped — at-screen accepted.*

- **Phase 24 — Perf polish + live accent propagation** (make the capture path feel instant and
  fix cross-window theming). The screenshot **HUD opens ~700–1000 ms sooner** (clipboard write
  moved off the critical path / made async), the capture overlay + HUD **snap on screen** with no
  OS show/hide transition, the region selector's **slide-in animation was killed** and it **reveals
  on first paint** (no stale-frame flash), a **phantom full-screen target** was dropped from Window
  capture mode, and **Esc dismisses the region selector** (granted hide/show IPC). Background
  memory shrank via **code-splitting heavy routes**. **Accent/theme now update live in every
  window** (settings-visual-changed broadcast — live WebView2 windows don't re-read shared
  localStorage). A dev-server port move off 1420 worked around a Windows WinNAT `EACCES`.
  *Shipped — at-screen accepted.*

- **Phase 25 — Developer polish** (redact/spotlight editor tools, delayed capture, video presets,
  recording-start reliability). New **redact** (solid / pixelate) and **spotlight** (dim-except-a-
  region) annotation tools — additive, safe-default model changes so existing `.glint` docs keep
  loading. **Delayed capture**: a capture-delay dropdown + three delayed-capture hotkey actions
  (`begin_delayed_spawned`), with the countdown promoted to a neutral N-parameterized module.
  **Video resolution + quality presets** threaded through settings → the ffmpeg pipeline. A round
  of recording-start fixes: **stop losing the first second** (countdown holds past zero on a
  centered cue until ffmpeg is confirmed live), the control **pill no longer clips** on either edge
  (a measurement-race fix — refit measures after its async awaits), the arming indicator became a
  static **"Starting…"** text, and the **webcam warms up during the countdown** (listener armed
  early, awaited late) to cut perceived start latency. *Shipped — at-screen accepted.*

- **Phase 26 — Editor polish** (multi-region spotlight + developer wins; front-end only, recorder
  path untouched). **Multi-region spotlight**: spotlights stay ordinary annotations but a single
  shared `SpotlightDimLayer` dims the screenshot **once** and re-paints the original pixels over each
  region (all source-over — no destination-out compositing, which had left stale dim on delete);
  overlaps no longer double-darken and the dim slider drives all spotlights together
  (`setSpotlightDim`). **Per-tool style persistence**: the in-session `toolStyles` map persists to
  `localStorage`, so preferred per-tool colors/sizes survive editor reopen + app restart (`.glint`
  docs unaffected). **Eyedropper** (`i` / StyleBar pipette): samples a pixel from the base screenshot
  as the current color. **Shortcuts cheatsheet** (`?`). Spotlight style bar shows only shape + dim
  (no color/stroke); the cursor bar is bare when nothing's selected. (The 1×/2× export toggle was
  tried then removed — negligible gain on raster screenshots, exports stay native.) Pure helpers
  unit-tested; **recorder isolation honored** (0-line diff under `src-tauri` / `src/recorder`).
  *Shipped — at-screen accepted.*

- **Phase 27 — Editor in its own window** (first editor phase to touch Rust). The annotation editor
  moved from a `/editor` route inside the main window to its **own decorated, resizable OS window**
  (label `"editor"`, `#/editor`, built off-thread by `editor::window`), so it has room to breathe and
  the main app is usable alongside it. On open the main window **minimizes to the taskbar** (stays
  restorable); **Done** hands the image to the HUD then **closes the editor window**. New
  `capabilities/editor.json` mirrors the main-window permissions; `/editor` moved to a top-level
  router route; the main window no longer navigates to the editor. Also fixed two editor bugs the
  window work surfaced: a **phantom 0×0 spotlight** from a click-without-drag (dimmed the whole canvas
  and couldn't be selected to delete) is now discarded via `discardDraft`, and **Delete** no longer
  gets swallowed while the dim slider holds focus. *Shipped — at-screen accepted.*

- **Phase 28 — HUD/editor responsiveness** (Rust threading fix). The post-capture HUD's `Copy` /
  `Save` / `Copy path` / `Reveal` and the editor's `Copy` / `Export` / `Drag` / `Done` / `Open` /
  `Save project` were plain (sync) `#[tauri::command]`s, so their blocking work — a full-resolution
  clipboard copy (~0.5–2s), PNG decode/re-encode, file writes, DB inserts, `.glint` assembly — ran on
  the **main/UI thread** and froze the window until it finished (the "delay when clicking a HUD/editor
  button"). Marked them `#[tauri::command(async)]` so they run on a worker thread and the UI stays
  live (matching the window-building tray actions that were already async, and the capture path that
  already spawned for its clipboard copy). Also investigated the intermittent **HUD accent-color
  flash**: a comprehensive per-frame flash trap (armed pre-paint, checking accent bg/border/outline/
  shadow/gradient across the HUD + overlay) found **no** accent DOM element and a rock-stable
  accent/theme across two instrumented sessions — ruling out a CSS/theme cause. It didn't reproduce
  under instrumentation, so rather than ship a guess it's **deferred** (rare, cosmetic, self-reverting;
  re-trap if it recurs). *Shipped — at-screen accepted.*

- **Phase 29 — App-wide UI/UX pass** (the last UI-focused phase before packaging; five
  sub-phases plus a new app icon, each `--no-ff` merged into `master`). Guiding principle:
  *subtraction, not accretion* — colours/type/tokens (accent `#5B7CFA`, near-black substrate,
  no glow/gradient) kept throughout. **29a — Foundations + Dashboard:** one global
  `--r-btn: 8px` token repointed across every rectangular pressable button (circular/window-
  control buttons left alone); Home restructured to Concept A "quiet launcher" — a New-capture
  action row (Capture Area primary + Window/Fullscreen/Record/Capture Text + a ghost Open
  Project) over a responsive `auto-fill` Recent grid and a conditional Resume-projects chip row;
  the Keyboard-shortcuts card removed (it duplicated Settings → Hotkeys). **29b — Sidebar:**
  the nav rail is now expandable/collapsible via a bottom chevron toggle, animating **width**
  in one smooth horizontal motion (labels always in the DOM, faded via opacity + `nowrap` to
  kill reflow jank; tooltips disabled when expanded); state persisted to `localStorage`.
  **29c — Library/Settings/Home polish:** look-only spacing, grid rhythm, hover finish, and
  `--r-btn` on card + panel buttons — no behaviour change. **29d — Library ↔ filesystem
  delete-sync:** the OS→Library direction is fixed — `captures_list` reconciles on load/focus
  (off-lock `Path::exists` per row → `soft_delete` the missing ones) so files deleted in
  Explorer no longer leave ghost rows, with a live watcher for already-open windows. **29e —
  Annotator zoom/fit:** scroll-to-zoom centered on the cursor, drag-pan, a bottom-right zoom
  control (`− <pct>% + · Fit · 100%`) and `Ctrl +/-/0/1` keybinds, all drawing routed through
  scale/position-aware pointer math (no-lag CSS-transform zoom); toolbar visuals polished.
  **App icon:** the default Tauri icon replaced everywhere (taskbar, Task Manager, Explorer
  "Open with" / "Open in Glint") with a **neon capture-marquee** mark — a deep near-black
  (`#060608`) rounded tile holding the app's own selection overlay (glowing periwinkle `#5B7CFA`
  frame + corner handles + crosshair). After several iterations (charcoal-lift variants were
  tried and rejected) the final call is a very dark tile that stands out on the grey Windows
  taskbar by being *darker* than the bar (like neighbouring dark app tiles), with a subtle inner
  rim-light so the rounded silhouette stays crisp on any bar tone, plus a brightened/​saturated
  marquee so the neon reads at 24–32px. Enhancement is pixel-level on the source render (glow
  preserved, not redrawn); regenerated via `tauri icon` across `.ico`/`.icns`/PNGs/Square logos.
  *Shipped — at-screen accepted.*

- **Phase 30 — Packaging & Distribution** (public release). The app is bundled into Windows
  installers via `tauri build` (`targets: "all"` → NSIS `.exe` + WiX `.msi`, sidecars ffmpeg/
  ffprobe + the Tesseract runtime bundled in). The repository is published to GitHub
  ([sanirudh17/Glint](https://github.com/sanirudh17/Glint), public, default branch `main`) with a
  comprehensive feature README, an MIT `LICENSE`, and a `scripts/fetch-ffmpeg.ps1` companion to
  the existing `fetch-tesseract.ps1` so a fresh clone can populate the git-ignored ~100MB sidecars
  and build. The v0.1.0 installer is attached to a GitHub **Release** so users can download and run
  it without cloning. Dev scaffolding (the original build prompt + `spike/`) dropped from the public
  tree. *Shipped.*

## Planned

- *(none — all planned phases complete. Future ideas: installer code-signing to clear SmartScreen,
  and auto-update.)*

## Out of scope (project-wide, unchanged)
Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls, scrolling
capture, QR/barcode scan, AI/LLM features, GIF recording/export.
