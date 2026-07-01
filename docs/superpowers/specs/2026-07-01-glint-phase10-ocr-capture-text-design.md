# Glint Phase 10 — OCR / Capture Text — Design Spec

**Date:** 2026-07-01
**Status:** Approved (brainstorm). Awaiting plan.
**Builds on:** Phases 1–9 (capture, HUD, Library, editor, pin, recorder, trim), all on `master`.

## Goal

Let the user **extract selectable text from the screen or from an existing screenshot** —
CleanShot's "Capture Text". Two entry points: a live **Capture Text** mode (drag a region,
get its text) and an **Extract text** action on already-captured images. Extracted text is
copied to the clipboard and shown in a small review panel for reading/editing. Fully
**local** — uses the OCR engine built into Windows; no cloud, no network, no bundled models,
no accounts.

## Scope (V1)

**In:**
- **Capture Text mode** — freeze the screen (reuse the capture overlay), drag a region, OCR
  those pixels, copy the text, open the review panel. No PNG saved, no Library row.
- **Extract text** action on the post-**capture** HUD and on Library **image** cards
  (recordings excluded). Loads the capture's PNG, OCRs it, copies + opens the panel.
- **Review panel** — a small decorated window (`#/ocr`) with the extracted text in an
  editable textarea, a copied-confirmation + line/char count, a Copy (re-copy) button, and a
  "No text found" empty state.
- **Engine:** `Windows.Media.Ocr` via the `windows` crate, language chosen automatically
  from the user's installed languages.

**Deferred (explicitly out of V1):** language picker / per-capture language override,
paragraph reflow and de-hyphenation, preserving text bounding-box layout, an Editor
"Extract text" button, OCR of PDF/multi-page, translation, and a Settings toggle for OCR
behavior.

## Approach decision

**Engine = Windows.Media.Ocr (built into Windows 10/11), called from Rust via the existing
`windows` crate.** Chosen over bundling Tesseract: zero bundled binaries or model files,
fully offline, native, good accuracy on screen text, and supports many languages via OS
language packs. Tesseract was rejected because it adds a ~15–30 MB bundled sidecar + model
data for no accuracy win on screen text.

**Region grab = reuse the capture frozen-overlay selector.** Capture Text is a new *purpose*
for the existing selection overlay, not a new overlay — the user drags a rectangle exactly
as for a screenshot; we route the resulting region to OCR instead of the save pipeline.

## Architecture & components

**New module `ocr/` (peer to `capture/`, `editor/`, `recorder/`):**

- `ocr/mod.rs` — owns the WinRT call. Deep, narrow interface:
  - `pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String>` — wraps the
    RGBA pixels in a `SoftwareBitmap` (`Windows.Graphics.Imaging`), runs
    `Windows.Media.Ocr::OcrEngine`, and returns `OcrOutput { text: String, line_count: usize,
    word_count: usize }`. Callers never see WinRT types.
  - `pub fn assemble_text(lines: &[String]) -> Option<String>` — the pure, unit-tested core:
    joins OCR lines in reading order with `\n`, trims trailing whitespace, and returns `None`
    for an empty/whitespace-only result. `recognize` calls this.
  - Engine creation: `OcrEngine::TryCreateFromUserProfileLanguages()`. If it yields null,
    `recognize` returns a typed "no OCR language available" error the command layer turns into
    a guidance toast.

- `ocr/commands.rs` — the Tauri surface (thin; delegates to `ocr::` + reused helpers):
  - `#[tauri::command(async)] ocr_capture_region(app)` — Flow 1: open the capture overlay in
    "text" intent; on region commit, grab region pixels (reuse capture's region grab),
    `recognize`, `clipboard::copy_text`, stash the result in `OcrState`, build the `#/ocr`
    window. (Async — it builds a window.)
  - `#[tauri::command(async)] ocr_extract_capture(app, id)` — Flow 2: look up the capture's
    PNG path by id, decode (via the `image` crate), `recognize`, copy, stash, open the panel.
  - `#[tauri::command] ocr_result(app) -> Option<OcrResultDto>` — the panel reads back
    `{ text, line_count, word_count }`.
  - `OcrState(Mutex<Option<OcrOutput>>)` — mirrors the trim window's `TrimTarget` stash pattern.

**Capture overlay "text intent".** The overlay already returns a committed region. Capture
Text sets a small flag (an intent enum or a dedicated command path) so the commit routes to
OCR rather than the crop/encode/save pipeline. The exact wiring (reuse `capture_commit` with
an intent vs. a parallel `ocr_commit`) is a plan-level decision; the selection UX is identical.

**Frontend:**
- New route `#/ocr` → `OcrPanel.tsx` (+ `lib/ocr.ts` typed invokes). A small decorated window
  (~460×420), outside AppShell (its own root), not in the transparent-route list. Reads
  `ocr_result()` on mount; renders the editable textarea, the copied-✓ + counts header, a Copy
  button (re-copies the textarea's current value/selection), and the empty state.
- **Entry points:** a Home quick-start **Capture Text** button; a tray entry; an **Extract
  text** button on the post-capture HUD and on Library image cards. All are thin `invoke`s
  (`ocr_capture_region` / `ocr_extract_capture`).

**New plumbing** (each on the new-window checklist):
1. `windows` crate features: `Media_Ocr`, `Graphics_Imaging`, `Globalization`,
   `Storage_Streams`, `Foundation` (the crate is already a dependency; this adds features only).
2. A new `ocr` capability scoped to the `ocr` window (core defaults + clipboard as needed),
   with the usual forced recompile after the capability edit.

## Data flow

**Flow 1 (Capture Text):** trigger → freeze/overlay → drag region → region RGBA →
`ocr::recognize` → `clipboard::copy_text` → stash in `OcrState` → build `#/ocr` → panel reads
`ocr_result()`. No file, no DB.

**Flow 2 (Extract text):** trigger with capture `id` → resolve PNG path (DB) → decode to RGBA
→ `ocr::recognize` → copy → stash → build `#/ocr` → panel reads back.

## Result panel UX

Small decorated window, fixed-ish size, dark to match the app:
- **Header:** "Copied to clipboard ✓" with a subtle line/char count (e.g. "12 lines · 480
  chars"). On the empty result: no checkmark, just the empty state.
- **Body:** an editable `<textarea>` pre-filled with the extracted text (monospace, selectable,
  scrollable). The user can fix an OCR slip or select a subset.
- **Footer:** **Copy** (re-copies the textarea's current selection if any, else all) and
  **Close**. Esc closes.
- **Empty state:** "No text found in that region." + Close.

## Engine, language & line handling

- **Engine:** `Windows.Media.Ocr::OcrEngine::TryCreateFromUserProfileLanguages()` — auto-picks
  from installed languages; no picker in V1.
- **Unavailable engine/language:** typed error → toast *"OCR isn't available — install a
  language pack in Windows Settings → Time & Language."* No panel, no crash.
- **Line handling:** `assemble_text` joins recognized lines in order with `\n`; trailing
  whitespace trimmed; empty → treated as "no text found". No reflow/de-hyphenation in V1.

## Error handling

- **No text found** → panel opens in the empty state; a "No text found" toast; nothing copied.
- **Engine/language unavailable** → guidance toast; no panel.
- **Region too small** (Flow 1) → the capture overlay's existing "Selection too small" guard.
- **OCR failure** (bad bitmap, WinRT error) → toast "Couldn't read text"; no panel.
- **Missing/unreadable source** (Flow 2, file deleted) → toast "Couldn't open that capture".

## Testing

- **Rust unit:** `assemble_text` — multi-line join, trailing-whitespace trim, all-whitespace →
  `None`, single line, empty slice → `None`; plus the language-fallback decision (engine-null →
  typed error) exercised where it can be isolated from the OS. The WinRT `recognize` glue is
  thin and covered at-screen.
- **Frontend (vitest):** `OcrPanel` states — text, empty, and the count formatting — as a pure
  component; the Copy handler (all vs. selection).
- **At-screen acceptance (manual checklist doc):** OCR a code snippet, a paragraph, and a UI
  screenshot; verify clipboard contents; Extract text from a Library image; "no text" empty
  state; graceful message if no language pack.

**Hard gates:** recorder isolation is untouched (OCR is a separate domain; it does not import
from `recorder/`, and `recorder/` does not import from `ocr/`). The recording ffmpeg/gdigrab
path is irrelevant to this phase and unchanged.

## Out of scope (project-wide, unchanged)

Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls, scrolling
capture, QR/barcode scan, AI/LLM features, GIF recording/export.
