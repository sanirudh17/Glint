# Build Prompt — "Snip": Local-First Screenshot & Screen Recording Studio (Windows)

> Working title is **Snip** — rename if you have something better. Paste this whole file into Claude Code, **or** drop it in the project root and tell Claude Code: *"Read this and build it."*

---

## What I'm building

A polished, fast, **local-first desktop app for Windows** that clones the core workflow of CleanShot X — screenshots, screen recording, annotation, OCR, floating pinned screenshots, a post-capture quick overlay, drag-and-drop sharing, auto-save, and capture history.

It must feel **native, instant, minimal, and keyboard-driven** — a "capture → quick overlay → act" experience. Everything stays **on my device**. No cloud, no upload, no accounts, no network calls.

This is a single-user app — **just me**. No login, no admin password, no auth of any kind.

---

## How I want you to work (read this first)

1. **Think hard before coding.** Use maximum reasoning. Produce a concrete architecture + phase plan, then **show it to me and propose improvements** before you start building. Don't blindly implement — pressure-test the spec, flag risks, suggest better approaches. Use your planning superpowers to make this better than what I wrote.
2. **Use the `frontend-design` skill/superpower.** The UI is non-negotiable — it has to look genuinely excellent (design direction below). Do not ship default-looking UI.
3. **Use superpowers/skills throughout** — for design, for planning, for anything that raises quality.
4. **De-risk first.** Before any UI, build a throwaway spike that records the screen via `scap` → pipes frames to an `ffmpeg` sidecar → writes a smooth, in-sync MP4. If that works, the project is viable. Validate it on day one.
5. **Build in phases** (order at the bottom). Each phase should be a working, usable increment.

---

## Stack (non-negotiable)

- **Tauri v2** — Rust backend + **React + TypeScript** frontend.
- **Local SQLite** via `tauri-plugin-sql` for all history/metadata. On-device only. No server, no network.
- **Windows-first.** Keep platform-specific code behind clean abstractions so Linux *could* be added later, but do not build or test Linux now.
- Core libraries to use:
  - Screen capture: **`scap`** (recording-grade) and/or **`xcap`** for simple stills.
  - Recording encode: **`ffmpeg` sidecar** with hardware encoders (`h264_nvenc` / `h264_qsv` / `h264_amf`) and a software fallback.
  - Drag-out: **`tauri-plugin-drag`** (`drag-rs`).
  - Global hotkeys: **`tauri-plugin-global-shortcut`**.
  - Annotation canvas: **Konva.js** (layered, non-destructive).
- No Electron. No .NET.

---

## Design direction (apply the frontend-design skill)

Aim for the polish of **Raycast, Linear, Attio, and Vercel** — restrained, confident, fast.

- **Minimal and clean.** Dark theme as primary (with a clean light option). Thin/light font weights. Generous whitespace. Crisp 1px borders over heavy shadows.
- **No generic-AI clichés** — no purple gradients, no glow effects, no sparkle/star icons, no rainbow accents. One tasteful accent color, used sparingly.
- Tight, consistent spacing scale and type scale. Smooth, *subtle* motion (no bouncy/flashy animation).
- Every surface — the capture overlay, the post-capture HUD, the annotation editor, settings — should feel like one coherent, premium product. Iconography minimal and uniform (e.g. Lucide).
- The capture overlay and HUD especially must feel **instant and weightless**.

---

## This is a real desktop app, not a background utility

It runs in the tray with global hotkeys, **but it also has a proper main window** I can open and work in. Main window views:

- **Home / Dashboard** — recent captures grid, quick-start buttons (Capture Area, Window, Fullscreen, Record), and current hotkeys at a glance.
- **Library / History** — all captures and recordings with thumbnails, filter/search, restore, delete, retention settings; shows metadata (dimensions, duration, size).
- **Editor** — the annotation studio (can also open standalone after a capture).
- **Settings** — comprehensive, organized into sections: General, Capture, Recording, Auto-save & file naming, Hotkeys, Appearance, Storage/History. Includes the **enable auto-save** toggle and all the per-type behavior options below.

Plus the floating, transient surfaces: capture overlays (per monitor), the post-capture quick overlay/HUD, recording controls, and pinned screenshots.

---

## Architecture

- **Tray-core process (Rust, invisible):** owns global hotkeys, app lifecycle, and the capture + recording pipelines. The brain.
- **Spawned windows:** main window (the views above), capture overlay (one per monitor, fullscreen/transparent/borderless/always-on-top), post-capture HUD, recording controls, pinned-image windows.
- **Rust owns all native work:** hotkeys, screen capture, recording + encode, drag-out, clipboard image/text, temp-file lifecycle, DPI/monitor enumeration, tray.
- **Frontend owns all visual surfaces.**
- **Three principles:**
  1. **Freeze-frame capture** — on hotkey, grab all monitors to memory *instantly*, then let me select on the frozen still (this is what makes it feel instant).
  2. **Layered, non-destructive annotation** — every object stays editable after placement (Konva layer tree, serializable).
  3. **Isolated recorder** — the recording pipeline must be sandboxed so an ffmpeg hiccup can NEVER break the instant-screenshot path. Screenshot reliability is sacred.

---

## My #1 workflow priority — drag & path

This is the feature I use most. Get it right:

- **Smart drag-out** — dragging the HUD thumbnail carries a real temp PNG. Image-accepting apps (Slack, browser, docs, Figma) ingest the image; file contexts get the path.
- **Copy as path** — a one-key overlay action + global hotkey that copies the absolute temp-file path **as text**, so I can paste it straight into a terminal coding agent (e.g. `@C:\...\latest.png`).
- **Stable "latest" reference** — always mirror the newest capture to a fixed path (e.g. `%USERPROFILE%\.snip\latest.png`) and optionally a watched inbox folder, so an agent can be told once "read latest.png" and always get the current screenshot.
- **Path format options** — copy path as plain / `@path` / Markdown `![](path)`.

---

## Feature set (v1)

**1. Screenshot capture** — area, window, fullscreen, active-monitor, freehand/lasso. Multi-monitor aware with per-monitor DPI. Freeze-frame. Self-timer/countdown. Capture-previous-area. Crosshair + magnifier. Lock aspect ratio. Manual dimension entry. Optional cursor capture. Optional shadow/background for window capture. Hide desktop icons where feasible.

**2. Quick Access Overlay (post-capture HUD)** — always-on-top thumbnail near screen edge after every capture/recording. Actions: Copy · Save · Save As · Open in Annotate · Pin to screen · Reveal in Explorer · Delete · **Copy as path** · Drag-and-drop to any app. Configurable auto-close, position, size. In-overlay keyboard shortcuts. Restore recently-closed. Shows metadata.

**3. Auto-save & file workflow** — auto-save to a configurable folder (separate settings for screenshots vs recordings). File naming templates (date/time, counter, app name, window title). Optional ask-for-name. Optional after-capture actions: copy / open-in-annotate / pin. Remember last folder. **Auto-save toggle in Settings.**

**4. Capture history** — SQLite-backed; filter/search, restore, delete, configurable retention window.

**5. Annotation editor** — non-destructive, layered (Konva), zoomable canvas, undo/redo, snap/alignment guides. Tools: crop · resize · arrow (multi-style) · rectangle · filled rectangle · ellipse · line · text · highlighter · pencil · blur · pixelate · blackout/redaction · spotlight/focus-dim · counter/step markers · color picker with saved custom colors. Object select/move/resize/reorder/duplicate/delete. Combine multiple screenshots on one canvas (drag-drop) + image insert. **Backgrounds & framing**: padding, rounded corners, drop shadow, solid/gradient/wallpaper background, window frame, auto-balance. Export PNG/JPG/WebP. **Editable project format (`.snip` JSON)** to reopen annotations later.

**6. Screen recording** — region/window/fullscreen → **MP4 / H.264** (hardware encoders + software fallback). Microphone + system audio (WASAPI loopback). Show/hide cursor. **Click-highlight overlay.** **Keystroke overlay.** Countdown. Pause/resume. Cancel/restart. Recording toolbar excluded from the final video. Live duration display. Do-not-disturb where feasible. **Crash recovery** for unfinished recordings. Configurable FPS, bitrate, quality, max resolution. *(Webcam overlay: design the recorder so it can be added later, but it's optional — skip in v1 unless trivial.)*

**7. Video quick edit** — trim start/end, change resolution/quality, mute/adjust audio, preview playback, export optimized MP4.

**8. Floating pinned screenshots** — pin as always-on-top image; resize/reposition; adjustable opacity; click-through lock mode; hide/show all globally; context menu (copy/save/annotate/close).

**9. OCR / Capture Text** — on-device OCR from a selected region or an existing image. Fast path: hotkey → select region → text to clipboard (no file saved). Windows OCR languages. Optional line-break preservation. URL/email detection where practical.

**10. All-in-one launcher** — one global shortcut opens a compact capture toolbar to switch area / window / fullscreen / recording. Remembers last mode and optionally last region.

---

## Quality bar (non-functional)

- Native-feeling, low-latency UI; fast cold start.
- Correct under multi-monitor, **per-monitor DPI scaling**, and mixed refresh-rate displays.
- Strong memory and temp-file cleanup.
- Comprehensive, well-organized settings UI.
- Solid global keyboard shortcuts across the whole app.
- Thorough error handling + rotating logs.
- **Unit tests** for non-UI services (file naming, history, path/drag, capture cropping). **Integration tests** for file workflows and history where feasible.
- Clear code comments and an **architecture doc** in the repo.

---

## Out of scope (do NOT build)

Cloud, uploads, online share links, team/collaboration, branding/custom domains, login/auth/admin password, any web backend or network calls. Scrolling capture. QR/barcode scan. AI/LLM features. GIF recording/export. (All of these are explicitly excluded for v1.)

---

## Suggested build order

0. **Spike:** `scap` → `ffmpeg` sidecar → MP4. Prove smooth, in-sync recording. *(Validate before anything else.)*
1. **App shell:** Tauri project, tray + global hotkeys, main window with Home / Library / Settings routing, SQLite set up, design system established via the frontend-design skill.
2. **Screenshots:** freeze-frame capture (area/window/fullscreen/freehand), per-monitor DPI, → clipboard.
3. **Post-capture HUD** + the **drag & path workflow** (smart drag-out, copy-as-path, latest-reference). *Make this excellent — it's my most-used path.*
4. **Auto-save, file naming, history (Library view).**
5. **Annotation editor** (tools → backgrounds/framing → `.snip` save/load → export).
6. **Recording** (full pipeline: modes, audio, click/keystroke overlays, pause/resume, crash recovery) + **video quick edit**.
7. **Pinned screenshots**, **OCR**, **all-in-one launcher**.
8. **Polish:** settings completeness, hotkey config, DPI/refresh-rate hardening, cleanup, tests, docs.

---

**Before you build:** think hard, produce the architecture + phase plan, propose improvements to this spec, and confirm with me. Then start at Phase 0.

**Use superpowers. Use the frontend-design skill. Ultrathink.**
