# Glint — Architecture & Phase 0 Design

> Local-first screenshot & screen-recording studio for Windows. Tauri v2 (Rust) +
> React/TypeScript. No cloud, no accounts, no network. Single user. Renamed from the
> spec's working title "Snip" → **Glint** everywhere (package, window title, tray,
> `%USERPROFILE%\.glint\latest.png`, `.glint` project format).

Status: **approved 2026-06-20**. Build cadence: **phase-by-phase** — each phase gets its
own spec → plan → build → validate cycle. Phase 0 is a hard go/no-go gate.

---

## A. Cross-cutting architecture (decided once; holds for every phase)

### Window / process topology
One Tauri v2 app, multiple webviews:

- **Tray-core (Rust, headless):** owns the tray, global shortcuts, the capture pipeline,
  the *sandboxed* recording pipeline, SQLite, temp-file lifecycle, monitor/DPI
  enumeration, clipboard, and drag-out. The long-lived "brain" — survives the main
  window closing.
- **Main window webview:** Home / Library / Editor / Settings (React Router). Created
  lazily, closes to tray rather than quitting.
- **Transient webviews:** capture overlay (one transparent / borderless / always-on-top
  window **per monitor**), post-capture HUD, recording control bar, pinned-image windows
  — each a separate `WebviewWindow`.

### Recorder isolation (the sacred constraint)
The recorder is its own Rust module, with its own thread(s) and its own ffmpeg child
process, communicating with tray-core only over channels. Its panics are caught and
surfaced as errors. The screenshot path has **zero** compile-time or run-time dependency
on ffmpeg or the recorder module. A recording hiccup cannot break screenshots.

### Platform abstraction
Every native call (capture, monitors, clipboard, hide-icons, audio) sits behind Rust
traits in a `platform` module with a `windows` implementation, keeping `#[cfg(windows)]`
out of business logic. A Linux impl can slot in later but is not built or tested now.

### Data & files
- SQLite via `tauri-plugin-sql` at `%APPDATA%\Glint\glint.db`. Versioned migrations.
  `captures` table (id, kind, path, thumb, w, h, duration, bytes, created_at, app/window
  meta, `deleted_at` for soft delete) + `settings`.
- Captures save under a configurable root (default `%USERPROFILE%\Pictures\Glint`).
- Temp working files in `%LOCALAPPDATA%\Glint\tmp`, reaped on launch + on a schedule.
- Stable "latest" mirror at `%USERPROFILE%\.glint\latest.png` for coding agents.

### Frontend
React + TypeScript + Vite, React Router, Lucide icons, a tokens-based design system built
with the frontend-design skill in P1, Konva (layered, non-destructive) in P5. Lightweight
state (Zustand or context — finalized in P1). Rust unit tests cover non-UI services
(file-naming, history queries, path/drag formatting, crop math, retention).

---

## B. Decomposition — the spec's build order as discrete gated cycles

| Phase | Scope | Notes |
|------|-------|-------|
| **P0** | Recording spike | **Go/no-go gate.** |
| P0.5 | Drag-out + clipboard spike | De-risk the #1 workflow early. |
| P1 | App shell: tray, hotkeys, main window routing, SQLite, design system | |
| P2 | Screenshots: freeze-frame (area/window/fullscreen/freehand), per-monitor DPI → clipboard | |
| P3 | Post-capture HUD + drag & path workflow | The most-used path; make it excellent. |
| P4 | Auto-save, file naming, history (Library view) | |
| P5 | Annotation editor (tools → backgrounds/framing → `.glint` save/load → export) | |
| P6 | Recording (full pipeline) + **audio mini-spike** + video quick-edit | Audio is highest risk. |
| P7 | Pinned screenshots, OCR, all-in-one launcher | |
| P8 | Polish: settings completeness, hotkeys, DPI/refresh hardening, cleanup, tests, docs | |

Each phase gets its own spec + plan when we reach it.

---

## C. Phase 0 spike — concrete design

**Goal / success criteria (the gate):** record the primary monitor for ~15s and produce
`spike.mp4` (H.264) that plays back **smooth and in-sync** — motion is fluid and output
duration matches wall-clock within ~1% — using a hardware encoder when available and a
software fallback otherwise. No UI, no audio, throwaway code in `spike/`.

**Pipeline:**
1. `scap` captures the primary display → BGRA frames with capture timestamps.
2. A capture thread pushes frames into a bounded channel; a writer thread pulls.
3. The writer feeds **constant-frame-rate** raw frames to an **ffmpeg sidecar** over stdin
   (`-f rawvideo -pix_fmt bgra -s WxH -r FPS -i -`), duplicating the last frame when
   capture is idle to hold the target fps.
4. ffmpeg encodes `h264_nvenc` (then `h264_qsv`, `h264_amf`), software fallback
   `libx264 -preset veryfast`, with `-pix_fmt yuv420p -movflags +faststart` → `spike.mp4`.
5. Prints the encoder used, frames captured vs duplicated, and the output duration.

**The one real design fork — pacing:**
- ✅ **Constant frame rate + duplicate-last-frame** to hold target fps. Desktop
  duplication only delivers frames on change, so CFR pacing is what makes playback smooth
  and sync trivial (frame N renders at N/fps). Slightly more CPU on static screens.
- ❌ VFR with capture timestamps — smaller files but many players mishandle VFR and sync
  becomes fragile timestamp bookkeeping.
- ❌ ffmpeg `ddagrab`/`gdigrab` directly (skipping scap) — would bypass the
  recording-grade capture lib the architecture rides on; the spike must validate the real
  path.

**Deliberately excluded from the spike:** audio (the real risk — its own P6 mini-spike),
region/window selection, encoder auto-tuning, and any Tauri/UI. The spike uses system
ffmpeg on PATH; production bundles ffmpeg as a Tauri sidecar (decided in P6).

**If it fails:** fallbacks are ffmpeg `ddagrab` capture or `Windows.Graphics.Capture` via
`windows-rs`. We reassess at the gate before committing further.

---

## Open risks tracked from the start
- **System + loopback audio (P6)** — WASAPI process-loopback + A/V sync is the single
  hardest piece on Windows. Gets its own mini-spike before the full recorder.
- **Drag-out with a real temp PNG** (`tauri-plugin-drag`) — known rough edge on Windows;
  validated in the P0.5 spike, not discovered in P3.
- **"Hide desktop icons", window shadow/frame, do-not-disturb** — best-effort on Windows;
  implement what's clean, flag what isn't rather than fake it.
- **Freeze-frame across multi-monitor 4K** — holds several large RGBA buffers per capture;
  needs disciplined buffer lifetimes to avoid RAM bloat.
