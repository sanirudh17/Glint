# Glint Phase 10 — OCR / Capture Text — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract selectable text from a screen region or an existing screenshot using the local Windows OCR engine, copy it to the clipboard, and show it in a small review panel.

**Architecture:** A new isolated `ocr/` module owns the `Windows.Media.Ocr` call (pixels → text) plus a pure `assemble_text` core. A live **Capture Text** mode reuses the existing frozen-overlay selector — the session is tagged with an `intent`, and `capture_commit` routes a text-intent commit to OCR (cropping stays in `capture/`, recognition in `ocr/`), so the shared overlay frontend is untouched. An **Extract text** action OCRs an existing capture's PNG. Results are stashed in `OcrState` and shown in a small decorated `#/ocr` window.

**Tech Stack:** Rust + Tauri v2, the `windows` crate (v0.62, already a dependency — features only), React 19 + TypeScript + Vite + Zustand, Vitest.

## Global Constraints

- **Local-first, verbatim:** "Everything stays on my device. No cloud, no upload, no accounts, no network calls."
- **Single-user, verbatim:** "This is a single-user app — just me. No login, no admin password, no auth of any kind."
- **Recorder isolation (SACRED):** `ocr/` imports nothing from `recorder/`, and `recorder/` imports nothing from `ocr/`. The recording ffmpeg/gdigrab path is irrelevant here and untouched.
- **OCR engine:** `Windows.Media.Ocr` only. No cloud OCR, no bundled Tesseract/models.
- **Window-build rule:** any command/function that BUILDS a WebView2 window must run off the main thread (async command or spawned thread). Closing is safe from any thread.
- **Base branch:** work on `phase-10-ocr` branched from `master`; phases merge into `master`.

---

### Task 1: OCR text-assembly core (pure, TDD)

**Files:**
- Create: `glint/src-tauri/src/ocr/mod.rs`
- Modify: `glint/src-tauri/src/lib.rs` (add `mod ocr;`)

**Interfaces:**
- Produces:
  - `pub struct OcrOutput { pub text: String, pub line_count: usize, pub word_count: usize }` (derive `Clone`, `serde::Serialize`)
  - `pub fn assemble_text(lines: &[String]) -> Option<String>` — joins non-empty lines with `\n`, trims trailing whitespace on each line and overall; returns `None` if the result is empty/whitespace-only.

- [ ] **Step 1: Register the module**

In `glint/src-tauri/src/lib.rs`, add alongside the other `mod` declarations (e.g. near `mod clipboard;`):

```rust
mod ocr;
```

- [ ] **Step 2: Write the failing tests**

Create `glint/src-tauri/src/ocr/mod.rs`:

```rust
//! OCR / Capture Text. Turns pixels into text via the Windows.Media.Ocr engine
//! (fully local, no cloud). ISOLATED from `recorder/` (imports nothing from it, and
//! it imports nothing from here).

#[derive(Clone, serde::Serialize)]
pub struct OcrOutput {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

/// Join OCR lines into a single block of text: trim trailing whitespace per line,
/// join with `\n`, drop a trailing blank tail. Empty / whitespace-only → None.
pub fn assemble_text(lines: &[String]) -> Option<String> {
    let joined = lines
        .iter()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = joined.trim_matches('\n');
    if trimmed.trim().is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_lines_with_newlines() {
        let lines = vec!["hello".to_string(), "world".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "hello\nworld");
    }

    #[test]
    fn trims_trailing_whitespace_per_line() {
        let lines = vec!["a   ".to_string(), "b\t".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "a\nb");
    }

    #[test]
    fn empty_slice_is_none() {
        let lines: Vec<String> = vec![];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn all_whitespace_is_none() {
        let lines = vec!["   ".to_string(), "".to_string()];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn single_line_no_newline() {
        let lines = vec!["solo".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "solo");
    }
}
```

- [ ] **Step 3: Run tests — verify pass**

Run: `cd glint/src-tauri && cargo test --lib ocr:: 2>&1 | tail -8`
Expected: 5 tests pass. (`OcrOutput` warns dead_code until Task 2 — fine.)

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/ocr/mod.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p10): OCR text-assembly core (assemble_text) TDD"
```

---

### Task 2: WinRT recognize + windows crate features

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `windows` features)
- Modify: `glint/src-tauri/src/ocr/mod.rs` (add `recognize`)

**Interfaces:**
- Consumes: `assemble_text`, `OcrOutput` (Task 1).
- Produces: `pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String>` — runs Windows OCR on RGBA pixels; `Err` carries a user-facing message (engine/language unavailable, bad input, or "no text found").

- [ ] **Step 1: Add the windows crate features**

In `glint/src-tauri/Cargo.toml`, find the existing `windows = { version = "0.62", features = [...] }` line and extend its `features` array to include the OCR APIs:

```toml
windows = { version = "0.62", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Foundation",
    "Foundation_Collections",
    "Globalization",
    "Graphics_Imaging",
    "Media_Ocr",
    "Storage_Streams",
] }
```

(Keep whatever Win32 features were already present; only ADD the new ones.)

- [ ] **Step 2: Implement `recognize`**

Append to `glint/src-tauri/src/ocr/mod.rs` (above the `#[cfg(test)]` module):

```rust
/// Run Windows.Media.Ocr on RGBA pixels. Fully local. Returns assembled text, or a
/// user-facing error: no OCR language installed, empty input, or no text found.
///
/// Windows OCR wants a BGRA8 `SoftwareBitmap`; we swap R/B from our RGBA buffer. The
/// async recognition is `.get()`-blocked — callers MUST run this off the main thread.
pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String> {
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    if w == 0 || h == 0 || rgba.len() < (w * h * 4) as usize {
        return Err("Couldn't read text".into());
    }

    // RGBA -> BGRA (Windows imaging expects BGRA8 for OCR).
    let mut bgra = vec![0u8; rgba.len()];
    for (dst, src) in bgra.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        dst[0] = src[2]; // B
        dst[1] = src[1]; // G
        dst[2] = src[0]; // R
        dst[3] = src[3]; // A
    }

    // Wrap the bytes in an IBuffer and build a SoftwareBitmap.
    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&bgra).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        w as i32,
        h as i32,
    )
    .map_err(|e| e.to_string())?;

    // Engine from the user's installed languages; null/err => no language pack.
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
        "OCR isn't available — install a language pack in Windows Settings → Time & Language.".to_string()
    })?;
    // TryCreateFromUserProfileLanguages can yield a null engine; probe a member to detect it.
    if engine.RecognizerLanguage().is_err() {
        let _ = Language::CreateLanguage; // keep the import meaningful; see note below
        return Err(
            "OCR isn't available — install a language pack in Windows Settings → Time & Language."
                .into(),
        );
    }

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let lines_view = result.Lines().map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = Vec::new();
    for line in lines_view {
        if let Ok(t) = line.Text() {
            lines.push(t.to_string_lossy());
        }
    }

    let text = assemble_text(&lines).ok_or("No text found")?;
    let line_count = text.lines().count();
    let word_count = text.split_whitespace().count();
    Ok(OcrOutput { text, line_count, word_count })
}
```

> Note on the `Language` import: if the `RecognizerLanguage()` null-probe or the `Language` import causes an unused-import or API-shape warning/error at build, delete the `Language` import and the `let _ = Language::CreateLanguage;` line — they exist only to make null-engine detection explicit, and `TryCreateFromUserProfileLanguages().map_err(...)?` already covers the common "no language" case. `HString`/`to_string_lossy` come from the `windows` crate's string type; if `to_string_lossy` is unavailable use `t.to_string()`.

- [ ] **Step 3: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -20`
Expected: clean build. Resolve any minor `windows`-crate signature mismatches (method casing, `HString` conversion) against the compiler messages — the API shape above targets `windows` 0.62.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/src/ocr/mod.rs
git commit -m "feat(p10): Windows.Media.Ocr recognize() + windows crate OCR features"
```

---

### Task 3: OcrState + result command + panel window + route (minimal)

**Files:**
- Create: `glint/src-tauri/src/ocr/commands.rs`
- Create: `glint/src-tauri/src/ocr/window.rs`
- Modify: `glint/src-tauri/src/ocr/mod.rs` (`pub mod commands; pub mod window;` + `OcrState`)
- Modify: `glint/src-tauri/src/lib.rs` (`.manage(OcrState)` + register `ocr_result`)
- Create: `glint/src-tauri/capabilities/ocr.json`
- Create: `glint/src/lib/ocr.ts`
- Create: `glint/src/ocr/OcrPanel.tsx`
- Create: `glint/src/ocr/ocr.css`
- Modify: `glint/src/router.tsx` (add `/ocr` route)

**Interfaces:**
- Consumes: `OcrOutput` (Task 1).
- Produces:
  - Rust: `pub struct OcrState(pub std::sync::Mutex<Option<OcrOutput>>)` (derive `Default`); `pub const OCR_LABEL: &str = "ocr";`; `pub fn build_ocr_window(app) -> tauri::Result<()>`, `pub fn close_ocr_window(app)`; `#[tauri::command] pub fn ocr_result(app) -> Option<OcrResultDto>` where `OcrResultDto { text, line_count, word_count }`.
  - TS: `lib/ocr.ts` exporting `type OcrResult`, `ocrResult()`.

- [ ] **Step 1: State + result DTO in `ocr/mod.rs`**

Add to `glint/src-tauri/src/ocr/mod.rs` (after `OcrOutput`):

```rust
pub mod commands;
pub mod window;

/// The last OCR result, stashed for the `#/ocr` panel to read back (mirrors the trim
/// window's `TrimTarget` pattern).
#[derive(Default)]
pub struct OcrState(pub std::sync::Mutex<Option<OcrOutput>>);
```

- [ ] **Step 2: The panel window builder `ocr/window.rs`**

Create `glint/src-tauri/src/ocr/window.rs`:

```rust
//! Off-thread builder for the OCR review panel — a small NORMAL decorated window
//! (label `ocr`), unlike the transparent capture overlays. Built from async/spawned
//! contexts only (window-build rule). Single instance.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OCR_LABEL: &str = "ocr";

/// Build (or focus, if already open) the OCR review panel.
pub fn build_ocr_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(OCR_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, OCR_LABEL, WebviewUrl::App("index.html#/ocr".into()))
        .title("Glint — Captured Text")
        .decorations(true)
        .resizable(true)
        .inner_size(460.0, 420.0)
        .min_inner_size(360.0, 280.0)
        .center()
        .visible(true)
        .build()?;
    let _ = win.set_focus();
    Ok(())
}

/// Close the OCR panel if open.
pub fn close_ocr_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(OCR_LABEL) {
        let _ = w.close();
    }
}
```

- [ ] **Step 3: The result command `ocr/commands.rs`**

Create `glint/src-tauri/src/ocr/commands.rs`:

```rust
//! Tauri command surface for OCR. Thin — delegates to `ocr::recognize` + reused
//! helpers. Flow commands (capture-region / extract) are added in later tasks.
use tauri::Manager;

use super::OcrState;

#[derive(serde::Serialize)]
pub struct OcrResultDto {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

/// The `#/ocr` panel reads back the last OCR result.
#[tauri::command]
pub fn ocr_result(app: tauri::AppHandle) -> Option<OcrResultDto> {
    app.state::<OcrState>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|o| OcrResultDto {
            text: o.text.clone(),
            line_count: o.line_count,
            word_count: o.word_count,
        })
}
```

- [ ] **Step 4: Register state + command in `lib.rs`**

Add alongside the other `.manage(...)` calls:

```rust
        .manage(crate::ocr::OcrState::default())
```

And add to `tauri::generate_handler![...]`:

```rust
            crate::ocr::commands::ocr_result,
```

- [ ] **Step 5: Capability `capabilities/ocr.json`**

Create `glint/src-tauri/capabilities/ocr.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "ocr",
  "description": "Capability for the OCR review panel window.",
  "windows": ["ocr"],
  "permissions": [
    "core:default",
    "core:window:allow-close",
    "core:window:allow-set-focus"
  ]
}
```

- [ ] **Step 6: Frontend lib `glint/src/lib/ocr.ts`**

```ts
/** ocr.ts — typed wrappers for the OCR commands. */
import { invoke } from "@tauri-apps/api/core";

export interface OcrResult {
  text: string;
  line_count: number;
  word_count: number;
}

export const ocrResult = (): Promise<OcrResult | null> =>
  invoke<OcrResult | null>("ocr_result");
```

- [ ] **Step 7: Minimal panel `glint/src/ocr/OcrPanel.tsx`**

```tsx
/** OcrPanel.tsx — OCR review panel (#/ocr). Minimal first: read + show text. */
import { useEffect, useState } from "react";
import { ocrResult, type OcrResult } from "../lib/ocr";
import "./ocr.css";

export function OcrPanel() {
  const [res, setRes] = useState<OcrResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ocrResult().then((r) => { setRes(r); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  return (
    <div className="ocr-root">
      {loaded && (!res || !res.text) && <div className="ocr-empty">No text found.</div>}
      {res && res.text && <textarea className="ocr-text" defaultValue={res.text} readOnly />}
    </div>
  );
}
```

- [ ] **Step 8: Styles `glint/src/ocr/ocr.css`**

```css
.ocr-root { display: flex; flex-direction: column; height: 100vh; background: #0c0c10; color: #e8e8ee; font: 13px system-ui, sans-serif; }
.ocr-text { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; resize: none; border: none; padding: 12px; background: #0c0c10; color: #e8e8ee; font: 13px ui-monospace, monospace; }
.ocr-empty { padding: 16px; opacity: 0.8; }
```

- [ ] **Step 9: Route in `glint/src/router.tsx`**

Add the import and a top-level route (outside AppShell, like `/rec-trim`; do NOT add to `main.tsx`'s transparent-route list):

```tsx
import { OcrPanel } from "./ocr/OcrPanel";
// …in the createHashRouter array, next to the /rec-trim entry:
  { path: "/ocr", element: <OcrPanel /> },
```

- [ ] **Step 10: Build + typecheck (force ACL re-embed)**

Run: `cd glint && touch src-tauri/src/lib.rs && npx tsc --noEmit 2>&1 | tail -8 && cd src-tauri && cargo build 2>&1 | tail -12`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add glint/src-tauri/src/ocr/ glint/src-tauri/src/lib.rs glint/src-tauri/capabilities/ocr.json glint/src/lib/ocr.ts glint/src/ocr/ glint/src/router.tsx
git commit -m "feat(p10): OcrState + ocr_result + panel window/route (minimal)"
```

---

### Task 4: Extract-text flow (`ocr_extract_capture`)

**Files:**
- Modify: `glint/src-tauri/src/ocr/commands.rs` (add `ocr_extract_capture` + shared `open_with_output`)
- Modify: `glint/src-tauri/src/lib.rs` (register `ocr_extract_capture`)
- Modify: `glint/src/lib/ocr.ts` (add `extractCapture`)

**Interfaces:**
- Consumes: `ocr::recognize` (Task 2), `OcrState`, `build_ocr_window` (Task 3), `crate::db::capture_path`, `crate::clipboard::copy_text`.
- Produces: `#[tauri::command(async)] pub async fn ocr_extract_capture(app, id: i64) -> Result<(), String>`; TS `extractCapture(id)`.

- [ ] **Step 1: Shared "publish + open" helper + the extract command**

Add to `glint/src-tauri/src/ocr/commands.rs`:

```rust
/// Copy the text, stash the output for the panel, and open (or focus) the panel.
/// Shared by every OCR flow. Runs off the main thread (callers are async/spawned).
pub fn publish_and_open(app: &tauri::AppHandle, out: super::OcrOutput) {
    let _ = crate::clipboard::copy_text(&out.text);
    *app.state::<OcrState>().0.lock().unwrap() = Some(out);
    let _ = super::window::build_ocr_window(app);
}

/// OCR an existing Library capture (image) by id: decode its PNG, recognize, copy,
/// and open the panel. Async because it builds the panel window.
#[tauri::command(async)]
pub async fn ocr_extract_capture(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::capture_path(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("Couldn't open that capture")?
    };
    let bytes = std::fs::read(&path).map_err(|_| "Couldn't open that capture".to_string())?;
    let img = image::load_from_memory(&bytes)
        .map_err(|_| "Couldn't open that capture".to_string())?
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    match super::recognize(&img.into_raw(), w, h) {
        Ok(out) => {
            publish_and_open(&app, out);
            Ok(())
        }
        Err(e) => {
            let _ = tauri::Emitter::emit(&app, "glint-toast", &e);
            Err(e)
        }
    }
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add to `generate_handler!`:

```rust
            crate::ocr::commands::ocr_extract_capture,
```

- [ ] **Step 3: Frontend wrapper**

Add to `glint/src/lib/ocr.ts`:

```ts
export const extractCapture = (id: number): Promise<void> =>
  invoke<void>("ocr_extract_capture", { id });
```

- [ ] **Step 4: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -12 && cd ../ && npx tsc --noEmit 2>&1 | tail -5`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/ocr/commands.rs glint/src-tauri/src/lib.rs glint/src/lib/ocr.ts
git commit -m "feat(p10): ocr_extract_capture (OCR an existing Library image)"
```

---

### Task 5: Capture Text flow — session intent + capture_commit branch + `ocr_capture_region`

**Files:**
- Modify: `glint/src-tauri/src/capture/mod.rs` (`CaptureIntent`, session field, `begin_ocr_capture`)
- Modify: `glint/src-tauri/src/capture/commands.rs` (`capture_commit` branch + `finish_ocr_commit`)
- Modify: `glint/src-tauri/src/ocr/commands.rs` (`ocr_capture_region`)
- Modify: `glint/src-tauri/src/lib.rs` (register `ocr_capture_region`)
- Modify: `glint/src/lib/ocr.ts` (add `captureText`)

**Interfaces:**
- Consumes: `capture::begin_restoring` semantics, `capture::geometry::{logical_to_physical, clamp_rect, crop_rgba, LogicalRect}`, `ocr::recognize`, `ocr::commands::publish_and_open`.
- Produces: `pub enum CaptureIntent { Screenshot, Text }`; `pub fn begin_ocr_capture(app: &AppHandle)`; `#[tauri::command(async)] pub async fn ocr_capture_region(app) -> Result<(), String>`; TS `captureText()`.

- [ ] **Step 1: Add the intent to the capture session**

In `glint/src-tauri/src/capture/mod.rs`:

Add the enum (near `CaptureMode`):

```rust
/// What a capture is FOR. Screenshot = the normal save/HUD pipeline; Text = OCR the
/// region and show the result panel (no file, no Library row).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CaptureIntent {
    Screenshot,
    Text,
}
```

Add a field to `CaptureSession` (after `mode: CaptureMode,`):

```rust
    pub intent: CaptureIntent,
```

Find where `CaptureSession { … }` is constructed inside `begin_restoring` (the `Some(CaptureSession { … mode, restore_main, })` literal) and add `intent`:

```rust
        mode,
        restore_main,
        intent: CaptureIntent::Screenshot,
    });
```

That default keeps every existing caller a screenshot. Then add an OCR entry point that flips the intent after the session is built. The simplest, lowest-risk approach: a thin wrapper that begins a normal Area capture, then re-tags the freshly-created session's intent to `Text`:

```rust
/// Begin a Capture Text session: an Area capture whose committed region is OCR'd
/// instead of saved. Reuses the whole freeze/overlay path. Must run off the main
/// thread (it freezes + shows the overlay), same as `begin_restoring`.
pub fn begin_ocr_capture(app: &AppHandle) {
    begin_restoring(app, CaptureMode::Area, true);
    if let Some(session) = app.state::<CaptureState>().0.lock().unwrap().as_mut() {
        session.intent = CaptureIntent::Text;
    }
}
```

> If `begin_restoring` returns before the session is stored (it stores the session as its last step per the existing code), this re-tag runs after and finds it. If a future refactor makes `begin_restoring` async-store, pass the intent as a parameter instead. Confirm the session is present after `begin_restoring` returns during Step 4's build/run.

- [ ] **Step 2: Branch `capture_commit` on intent**

In `glint/src-tauri/src/capture/commands.rs`, replace the body of `capture_commit`'s background spawn with an intent branch:

```rust
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = match session.intent {
            crate::capture::CaptureIntent::Text => finish_ocr_commit(&app2, session, rect),
            crate::capture::CaptureIntent::Screenshot => finish_commit(&app2, session, rect),
        };
        if let Err(e) = result {
            log::error!("capture commit failed: {e}");
            let _ = app2.emit("glint-toast", "Couldn't save capture");
        }
    });
```

(`capture_commit` already `take()`s the session, tears down the overlay, and restores main before this spawn — that stays unchanged and is correct for both intents.)

- [ ] **Step 3: Add `finish_ocr_commit`**

Add to `glint/src-tauri/src/capture/commands.rs` (next to `finish_commit`):

```rust
/// The OCR half of a commit: crop the frozen region, run OCR, publish to the panel.
/// Cropping stays here (capture owns geometry); recognition is delegated to `ocr`.
fn finish_ocr_commit(
    app: &AppHandle,
    session: crate::capture::CaptureSession,
    rect: RectArg,
) -> Result<(), String> {
    let phys = logical_to_physical(
        LogicalRect { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        session.scale,
    );
    let clamped = clamp_rect(phys, session.image.width, session.image.height)
        .ok_or("empty selection")?;
    let cropped = crop_rgba(&session.image.rgba, session.image.width, session.image.height, clamped);
    match crate::ocr::recognize(&cropped, clamped.w, clamped.h) {
        Ok(out) => {
            crate::ocr::commands::publish_and_open(app, out);
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("glint-toast", &e);
            Ok(()) // handled via toast; not a hard commit failure
        }
    }
}
```

- [ ] **Step 4: The `ocr_capture_region` command**

Add to `glint/src-tauri/src/ocr/commands.rs`:

```rust
/// Start a Capture Text session (freeze + overlay). On region commit, `capture_commit`
/// routes to OCR. Async: it freezes the screen + shows the overlay off the main thread.
#[tauri::command(async)]
pub async fn ocr_capture_region(app: tauri::AppHandle) -> Result<(), String> {
    crate::capture::begin_ocr_capture(&app);
    Ok(())
}
```

- [ ] **Step 5: Register in `lib.rs`**

Add to `generate_handler!`:

```rust
            crate::ocr::commands::ocr_capture_region,
```

- [ ] **Step 6: Frontend wrapper**

Add to `glint/src/lib/ocr.ts`:

```ts
export const captureText = (): Promise<void> =>
  invoke<void>("ocr_capture_region");
```

- [ ] **Step 7: Build + typecheck**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -15 && cd ../ && npx tsc --noEmit 2>&1 | tail -5`
Expected: both clean. (`begin_restoring` may need `pub` visibility on `CaptureState`/fields already used — confirm compile.)

- [ ] **Step 8: AT-SCREEN GATE (manual, deferred to user)**

`npm run tauri dev` → trigger `captureText()` (temporarily from the Home button once Task 7 lands, or via devtools `window.__TAURI__.core.invoke('ocr_capture_region')`), drag over some on-screen text → the OCR panel opens with the recognized text and it's on the clipboard. This is the runtime gate for the WinRT `recognize` glue.

- [ ] **Step 9: Commit**

```bash
git add glint/src-tauri/src/capture/mod.rs glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/ocr/commands.rs glint/src-tauri/src/lib.rs glint/src/lib/ocr.ts
git commit -m "feat(p10): Capture Text flow — session intent + capture_commit OCR branch"
```

---

### Task 6: Full OcrPanel UI (editable, copy, counts, empty state)

**Files:**
- Modify: `glint/src/ocr/OcrPanel.tsx`
- Modify: `glint/src/ocr/ocr.css`
- Create: `glint/src/ocr/OcrPanel.test.tsx`

**Interfaces:**
- Consumes: `ocrResult` (Task 3), `getCurrentWindow` (`@tauri-apps/api/window`).
- Produces: `#[tauri::command] ocr_copy(text: String)` + TS `ocrCopy(text)` — re-copy edited/selected text through the app's own `clipboard::copy_text` (stays local; no browser clipboard API). Added in Step 1.

- [ ] **Step 1: Add an `ocr_copy` command (re-copy edited/selected text)**

In `glint/src-tauri/src/ocr/commands.rs`:

```rust
/// Re-copy text from the panel (after an edit or partial selection).
#[tauri::command]
pub fn ocr_copy(text: String) -> Result<(), String> {
    crate::clipboard::copy_text(&text)
}
```

Register in `lib.rs` `generate_handler!`:

```rust
            crate::ocr::commands::ocr_copy,
```

Add to `glint/src/lib/ocr.ts`:

```ts
export const ocrCopy = (text: string): Promise<void> =>
  invoke<void>("ocr_copy", { text });
```

- [ ] **Step 2: Write the panel test**

Create `glint/src/ocr/OcrPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { OcrPanel } from "./OcrPanel";

vi.mock("../lib/ocr", () => ({
  ocrResult: vi.fn(),
  ocrCopy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
}));
import { ocrResult } from "../lib/ocr";

describe("OcrPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the extracted text and a copied confirmation with counts", async () => {
    (ocrResult as any).mockResolvedValue({ text: "hello\nworld", line_count: 2, word_count: 2 });
    render(<OcrPanel />);
    expect(await screen.findByDisplayValue(/hello/)).toBeInTheDocument();
    expect(screen.getByText(/2 lines/)).toBeInTheDocument();
  });

  it("shows the empty state when no text was found", async () => {
    (ocrResult as any).mockResolvedValue({ text: "", line_count: 0, word_count: 0 });
    render(<OcrPanel />);
    expect(await screen.findByText(/No text found/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `cd glint && npx vitest run src/ocr/OcrPanel.test.tsx 2>&1 | tail -15`
Expected: FAIL (counts header / editable value not present yet).

- [ ] **Step 4: Implement the full panel**

Replace `glint/src/ocr/OcrPanel.tsx`:

```tsx
/** OcrPanel.tsx — OCR review panel (#/ocr): editable text, copy, counts, empty state. */
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ocrResult, ocrCopy, type OcrResult } from "../lib/ocr";
import "./ocr.css";

export function OcrPanel() {
  const [res, setRes] = useState<OcrResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(true); // the flow already copied on open
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ocrResult().then((r) => { setRes(r); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") getCurrentWindow().close().catch(() => {}); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copy = async () => {
    const el = ref.current; if (!el) return;
    const sel = el.value.substring(el.selectionStart, el.selectionEnd);
    await ocrCopy(sel.length > 0 ? sel : el.value).catch(() => {});
    setCopied(true);
  };

  const hasText = !!(res && res.text);

  return (
    <div className="ocr-root">
      <div className="ocr-header">
        {hasText ? (
          <>
            <span className="ocr-ok">{copied ? "Copied to clipboard ✓" : "Edited"}</span>
            <span className="ocr-spacer" />
            <span className="ocr-counts">{res!.line_count} lines · {res!.text.length} chars</span>
          </>
        ) : (
          <span className="ocr-ok">Captured text</span>
        )}
      </div>

      {loaded && !hasText && <div className="ocr-empty">No text found in that region.</div>}
      {hasText && (
        <textarea
          ref={ref}
          className="ocr-text"
          defaultValue={res!.text}
          onChange={() => setCopied(false)}
          spellCheck={false}
        />
      )}

      <div className="ocr-actions">
        <span className="ocr-spacer" />
        {hasText && <button className="ocr-btn ocr-btn--primary" onClick={copy}>Copy</button>}
        <button className="ocr-btn" onClick={() => getCurrentWindow().close()}>Close</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Styles**

Replace `glint/src/ocr/ocr.css`:

```css
.ocr-root { display: flex; flex-direction: column; height: 100vh; background: #0c0c10; color: #e8e8ee; font: 13px system-ui, sans-serif; }
.ocr-header, .ocr-actions { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }
.ocr-spacer { flex: 1; }
.ocr-ok { color: #7ee0a2; }
.ocr-counts { opacity: 0.75; font-variant-numeric: tabular-nums; }
.ocr-text { flex: 1; min-height: 0; width: 100%; box-sizing: border-box; resize: none; border: none; padding: 12px; background: #0c0c10; color: #e8e8ee; font: 13px ui-monospace, monospace; outline: none; }
.ocr-empty { flex: 1; padding: 16px; opacity: 0.8; }
.ocr-btn { background: #1b1d27; color: #e8e8ee; border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; padding: 6px 12px; cursor: pointer; }
.ocr-btn--primary { background: #5b7cfa; border-color: #5b7cfa; }
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `cd glint && npx vitest run src/ocr/OcrPanel.test.tsx 2>&1 | tail -8 && npx tsc --noEmit 2>&1 | tail -5 && cd src-tauri && cargo build 2>&1 | tail -8`
Expected: tests pass, tsc clean, cargo clean.

- [ ] **Step 7: Commit**

```bash
git add glint/src/ocr/ glint/src-tauri/src/ocr/commands.rs glint/src-tauri/src/lib.rs glint/src/lib/ocr.ts
git commit -m "feat(p10): full OCR panel — editable text, copy (all/selection), counts, empty state"
```

---

### Task 7: Entry points (Home, tray, HUD, Library)

**Files:**
- Modify: `glint/src/views/HomeView.tsx` (Capture Text quick-start button)
- Modify: `glint/src-tauri/src/tray.rs` (tray "Capture Text" item + handler)
- Modify: `glint/src/hud/HudApp.tsx` (post-capture screenshot HUD; Extract text button — NOT `recorder/RecHud.tsx`, which is the recording HUD)
- Modify: `glint/src/views/library/CaptureCard.tsx` (Extract text on image cards)

**Interfaces:**
- Consumes: `captureText`, `extractCapture` (`lib/ocr.ts`).

- [ ] **Step 1: Home quick-start button**

In `glint/src/views/HomeView.tsx`, import `captureText` from `../lib/ocr` and add a quick-start button next to the existing capture buttons (match the existing button markup/classes exactly; e.g. if they use a `<button className="quick-btn">` with an icon, mirror it):

```tsx
import { captureText } from "../lib/ocr";
// …among the QUICK START buttons, after Capture Fullscreen:
        <button className="quick-btn" onClick={() => captureText()}>
          {/* use the same icon component pattern as siblings, e.g. a lucide "Type" or "ScanText" */}
          Capture Text
        </button>
```

> Read `HomeView.tsx` first and copy the exact button element/class/icon pattern its siblings use — do not invent new classes.

- [ ] **Step 2: Tray entry**

In `glint/src-tauri/src/tray.rs`, add a "Capture Text" menu item next to the capture entries, and in its handler call the OCR start. Mirror how an existing capture tray item is built and dispatched; the handler body is:

```rust
// in the tray event match, for the "capture_text" item id:
crate::capture::begin_ocr_capture(app);
```

> Read `tray.rs` first; add the `MenuItem` with a stable id (e.g. `"capture_text"`) alongside the existing capture items and route it in the existing `on_menu_event` match. Tray handlers run on the main thread — `begin_ocr_capture` freezes + shows the overlay via the same path the existing tray capture items use, so follow their exact spawning pattern (if they spawn a thread, do the same).

- [ ] **Step 3: Post-capture HUD "Extract text" button**

In `glint/src/hud/HudApp.tsx`, add an Extract-text action to the HUD toolbar. The HUD acts on the current capture; it has the capture id available the same way its other actions do (Open/Copy/etc.). Import `extractCapture` and, if the HUD already exposes the capture id, wire a button:

```tsx
import { extractCapture } from "../lib/ocr";
// …in the toolbar, mirroring the existing action buttons:
        <button className="hud-btn" title="Extract text" aria-label="Extract text" onPointerDown={(e) => e.stopPropagation()} onClick={() => id != null && extractCapture(id)}>
          {/* lucide ScanText / Type icon at size 16 */}
        </button>
```

> Read `HudApp.tsx` first. If the HUD does not currently have the capture's Library id (it may act via `hud_*` commands rather than an id), add the button ONLY if an id is available; otherwise skip the HUD entry point and note it in the acceptance doc as Library-only. Do not fabricate an id.

- [ ] **Step 4: Library "Extract text" on image cards**

In `glint/src/views/library/CaptureCard.tsx`, add a Scan/Extract button in the **non-recording (screenshot)** branch only. Import once at top:

```tsx
import { ScanText } from "lucide-react"; // add to the existing lucide import line
import { extractCapture } from "../../lib/ocr";
```

In the screenshot branch (the `:` side of `isRecording ? … : …`), after the Edit button:

```tsx
            <button className="cap-btn" aria-label="Extract text" title="Extract text" onClick={() => act(() => extractCapture(item.id))}>
              <ScanText size={15} strokeWidth={1.75} />
            </button>
```

- [ ] **Step 5: Typecheck + build**

Run: `cd glint && npx tsc --noEmit 2>&1 | tail -8 && cd src-tauri && cargo build 2>&1 | tail -8`
Expected: both clean.

- [ ] **Step 6: AT-SCREEN GATE (manual, deferred to user)**

`npm run tauri dev`: Home **Capture Text** → drag over text → panel with text. Library image card **Extract text** → panel. Tray **Capture Text** → panel. HUD Extract text (if wired). Screenshot-only: recordings show no Extract text.

- [ ] **Step 7: Commit**

```bash
git add glint/src/views/HomeView.tsx glint/src-tauri/src/tray.rs glint/src/hud/HudApp.tsx glint/src/views/library/CaptureCard.tsx
git commit -m "feat(p10): OCR entry points — Home, tray, HUD, Library"
```

---

### Task 8: Acceptance doc + roadmap

**Files:**
- Create: `docs/superpowers/PHASE-10-OCR-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md` (Phase 10 under Shipped; clear the OCR "next up" line)

- [ ] **Step 1: Write the acceptance checklist**

Create `docs/superpowers/PHASE-10-OCR-ACCEPTANCE.md` with: the automated gate (cargo test count incl. `ocr::` unit tests, vitest incl. `OcrPanel`, tsc/vite clean), the hard gates (`grep -rnE "crate::recorder" glint/src-tauri/src/ocr` empty; `grep -rnE "crate::ocr" glint/src-tauri/src/recorder` empty), and the at-screen checklist (Capture Text over code/paragraph/UI; clipboard verified; Extract text from a Library image; tray + Home entry; "no text" empty state; graceful "install a language pack" message if none).

- [ ] **Step 2: Update the roadmap**

In `docs/superpowers/ROADMAP.md`, move Phase 10 from Planned to Shipped with a summary bullet, and remove the "(next up)" from the OCR line.

- [ ] **Step 3: Full green gate**

Run:
```bash
cd glint/src-tauri && cargo test --lib 2>&1 | tail -3
cd ../ && npx tsc --noEmit 2>&1 | tail -3 && npx vitest run 2>&1 | tail -3 && npx vite build 2>&1 | tail -3
grep -rnE "crate::recorder" src-tauri/src/ocr || echo "ocr->recorder clean"
grep -rnE "crate::ocr" src-tauri/src/recorder || echo "recorder->ocr clean"
```
Expected: cargo green, vitest green, tsc/vite clean, both isolation greps clean.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-10-OCR-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p10): OCR acceptance checklist + roadmap"
```

---

## Self-Review notes

- **Spec coverage:** Capture Text mode (T5), Extract text on existing captures (T4 + T7), review panel with editable text/copy/counts/empty state (T3+T6), Windows.Media.Ocr auto-language + graceful no-language (T2), copy-to-clipboard (T4/T5 via `publish_and_open`), no-PNG/no-Library for Capture Text (T5 `finish_ocr_commit` never writes/inserts), entry points Home/tray/HUD/Library (T7), testing (T1 unit, T6 vitest, at-screen gates in T5/T7/T8). Covered.
- **Isolation:** `ocr/` does not import `recorder/`; `recorder/` does not import `ocr/`. `capture/` gains a single delegating call into `ocr::` (`finish_ocr_commit` → `recognize` + `publish_and_open`) and `ocr::` calls back into `capture::begin_ocr_capture` — an intentional, one-call-each-way coupling within the crate, NOT touching the recorder boundary.
- **Window-build rule:** every window build (`build_ocr_window`) is reached only from async commands (`ocr_extract_capture`, `ocr_capture_region`→overlay→`capture_commit`'s spawned thread) or spawned threads — never a sync command on the main thread.
- **Type consistency:** `OcrOutput{text,line_count,word_count}` (Rust) ↔ `OcrResult{text,line_count,word_count}` (TS) ↔ `OcrResultDto` identical fields. `publish_and_open` is the single copy+stash+open path used by both flows.
- **At-screen items** (WinRT recognize, real overlay OCR, tray/Home/HUD wiring) are explicitly deferred to the user, consistent with prior phases.
