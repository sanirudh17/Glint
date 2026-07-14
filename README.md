<div align="center">

<img src="glint/src-tauri/icons/128x128@2x.png" width="112" alt="Glint icon" />

# Glint

**A fast, local-first screenshot, screen-recording, annotation & OCR tool for Windows.**

A CleanShot X–style capture suite that keeps everything on your machine — no cloud, no accounts, no network.

[Download the latest release »](https://github.com/sanirudh17/Glint/releases/latest)

</div>

---

## What is Glint?

Glint is an all-in-one capture tool for Windows. Take a screenshot or record your screen, then annotate it, extract its text, pin it on top of everything, or drag it straight into another app — all from a quiet corner HUD. Screenshots auto-save to a searchable library, recordings can be trimmed on a multi-cut timeline, and every edit is non-destructive and saveable as a re-openable `.glint` project.

Everything runs **100% on-device**. Glint never talks to the network — no cloud storage, no accounts, no telemetry.

## Features

### 📸 Screenshots
- **Region, window, and fullscreen** capture with a frozen-screen selection overlay (a precise magnifier loupe + live dimensions).
- Instant post-capture actions from a floating HUD.

### 🎬 Screen recording
- Record a **region or fullscreen** to MP4 (H.264, `+faststart`), with a 3·2·1 countdown and a floating control bar (REC dot · timer · pause · stop). Stop is graceful — the file always closes with a valid `moov` atom.
- **System audio + microphone**, captured install-free via WASAPI (loopback + capture endpoints), mixed and encoded to AAC. Each source is independently selectable and live-mutable.
- **Webcam bubble** — a circular, draggable, resizable camera overlay you can toggle live mid-recording.
- **Hardware-accelerated encoding** and high-frame-rate (up to 60 fps) capture.

### ✂️ Recording trim editor
- Multi-cut timeline trimming of any recording: split, delete regions, undo, frame-step, and gap-skipping preview playback.
- Export as a **Save copy** (`… (trimmed).mp4`) or a rollback-safe **Overwrite** in place.

### ✏️ Annotation editor
- Tools: **arrow, line, rectangle, ellipse, text, pen (freehand), highlighter, blur, and numbered steps**, plus a scrub **eraser** for partial freehand erase.
- Full **undo/redo** history, and **native-resolution export** (copy to clipboard, save to file, or drag out).
- Scroll-to-zoom centered on the cursor, drag-pan, and a Fit / 100% zoom control with `Ctrl +/-/0/1` keybinds.

### 🖼️ Backgrounds & framing
- Non-destructive **crop** with aspect presets.
- Wrap the image in a **solid / gradient / transparent** backdrop with padding, **rounded corners**, and a drop shadow — live WYSIWYG.
- Frame and crop both participate in undo/redo.

### 🔤 Capture Text (OCR)
- Extract text from any capture with one click, powered by a bundled **Tesseract** engine — no separate install required.

### 📌 Pin to Screen
- Float any capture as an always-on-top, borderless window. Drag to move, wheel/handles to resize (aspect-locked), adjust opacity, copy, or save — all from a right-click menu.

### 🗂️ Library
- Screenshots auto-save to `Pictures\Glint`, indexed in a local SQLite database with thumbnails and recents.
- Rename, search, and delete — with **two-way delete-sync**: files removed in Explorer no longer leave ghost rows, and deletions in Glint reconcile to disk.

### ⚡ Quick Access HUD
- An accumulating bottom-corner tray of capture cards. Per card: **copy image, copy path, save/reveal, annotate, extract text, pin, and dismiss** — and drag the card straight into any app that accepts an image or file.

### 💾 `.glint` projects
- Save any edit as a versioned, self-contained `.glint` document (embedded base image + annotations + crop + frame). Re-open it later, keep editing, and export a fresh PNG anytime. `Ctrl+S`, a dirty indicator in the title bar, and a Recent Projects list on Home.

### 🪟 Explorer integration
- **"Open in Glint"** on any image (png/jpg/jpeg/webp/bmp/gif) via a per-user shell verb — no admin needed. Edits are non-destructive; the source file is never modified.

### 🎨 Polish
- Dark, tokenized UI with a customizable accent color, a collapsible navigation sidebar, and a redesigned app icon.

---

## Download & Install

Grab the latest installer from the [**Releases**](https://github.com/sanirudh17/Glint/releases/latest) page:

- **`Glint_x.y.z_x64-setup.exe`** — NSIS installer (recommended), or
- **`Glint_x.y.z_x64_en-US.msi`** — MSI installer.

Run it and launch Glint. That's it — the recorder, OCR, and everything else are self-contained in the installer.

> **Windows SmartScreen:** the installer isn't code-signed, so Windows may show a "Windows protected your PC" prompt on first run. Click **More info → Run anyway**.

---

## Building from source

### Prerequisites
- **[Node.js](https://nodejs.org/)** 18+ and npm
- **[Rust](https://rustup.rs/)** (stable toolchain)
- **[Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)** for Windows (WebView2 is preinstalled on Windows 11; MSVC build tools required)
- **PowerShell** (for the binary fetch scripts)

### 1. Clone and install
```bash
git clone https://github.com/sanirudh17/Glint.git
cd Glint/glint
npm install
```

### 2. Fetch the bundled binaries
Glint's recorder and OCR shell out to FFmpeg/FFprobe and Tesseract. These are large (~100 MB each) and are **not** committed to the repo — fetch them once per machine from the repo root:

```powershell
powershell -File scripts/fetch-ffmpeg.ps1
powershell -File scripts/fetch-tesseract.ps1
```

This populates `glint/src-tauri/binaries/` so the app runs and `tauri build` can bundle them.

### 3. Run in development
```bash
cd glint
npm run tauri dev
```

### 4. Build installers
```bash
cd glint
npm run tauri build
```
The MSI and NSIS installers land in `glint/src-tauri/target/release/bundle/`.

---

## Tech stack

- **[Tauri v2](https://v2.tauri.app/)** — Rust core + system WebView (WebView2)
- **React + TypeScript + Vite** — UI, with **Zustand** state and **React Router**
- **[Konva](https://konvajs.org/)** — annotation canvas
- **SQLite** (via `sqlx`) — local library index
- **FFmpeg / FFprobe** — recording capture, encode, and trim
- **WASAPI** — system + microphone audio capture
- **Tesseract** — OCR

## Project structure

```
glint/          The Tauri app (React frontend in src/, Rust core in src-tauri/)
docs/           Design docs, per-phase specs, and the roadmap
scripts/        Binary fetch scripts (FFmpeg/FFprobe, Tesseract)
```

## Privacy

Glint is **local-first by design**. It has no network code — no cloud sync, no accounts, no analytics. Your captures, recordings, and library never leave your machine.

## License

[MIT](LICENSE) © 2026 Sanirudh ([sanirudh17](https://github.com/sanirudh17))

Bundled FFmpeg/FFprobe and Tesseract are third-party binaries under their own licenses (see [LICENSE](LICENSE) for details); they are fetched per-machine and are not part of this repository.

## Acknowledgements

Built with [Tauri](https://v2.tauri.app/), [FFmpeg](https://ffmpeg.org/), and [Tesseract OCR](https://github.com/tesseract-ocr/tesseract). Inspired by [CleanShot X](https://cleanshot.com/).
