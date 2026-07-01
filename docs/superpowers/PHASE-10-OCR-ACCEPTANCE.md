# Phase 10 — OCR / Capture Text — Acceptance

Extract selectable text from a screen region or an existing screenshot using the
**local** Windows OCR engine (`Windows.Media.Ocr`), copy it to the clipboard, and
show it in a small review panel. No cloud, no upload, no bundled models.

## Architecture (as built)

- **`ocr/` module (isolated).** `assemble_text` (pure line-join core) + `recognize`
  (RGBA → BGRA `SoftwareBitmap` → `OcrEngine::TryCreateFromUserProfileLanguages` →
  blocking wait via a completion-handler + channel, since windows-rs 0.62 dropped
  `IAsyncOperation::get()` and keeps `Async::join` private). `OcrState` stashes the
  last result for the panel; `commands.rs` is the thin Tauri surface; `window.rs`
  builds the decorated `#/ocr` panel off-thread.
- **Capture Text (live).** Reuses the existing frozen-overlay selector: the session
  carries a `CaptureIntent` (`Screenshot` default), `begin_ocr_capture` re-tags it to
  `Text` (and hides the main window first, like `capture_start`), and `capture_commit`
  branches — `finish_ocr_commit` crops the frozen region (capture owns geometry) and
  delegates recognition to `ocr::recognize`. No PNG, no Library row for text intent.
- **Extract text (existing captures).** `ocr_extract_capture(id)` decodes a Library
  image's PNG; `ocr_extract_last()` OCRs the in-memory `LastCapture` RGBA (the HUD's
  path — no Library id needed, mirrors `hud_copy`).
- **Review panel.** Editable textarea, Copy (selection or whole), copied/edited status,
  line + char counts, empty state, Esc-to-close. View-logic in a pure `ocrPanelModel`.
- **Shared publish path.** `publish_and_open` = copy text (local `clipboard::copy_text`)
  + stash in `OcrState` + open/focus the panel. Used by every flow.

## Automated gate (all green at ship)

- `cargo test --lib` → **87 passed** (incl. `ocr::tests::*` — 5 `assemble_text` cases).
- `npx vitest run` → **55 passed** across 8 files (incl. `ocr/ocrPanelModel.test.ts`).
- `npx tsc --noEmit` → clean. `npx vite build` → clean.

## Hard gates (recorder isolation — SACRED)

- `grep -rnE "crate::recorder" glint/src-tauri/src/ocr` → **empty** (ocr→recorder clean).
- `grep -rnE "crate::ocr" glint/src-tauri/src/recorder` → **empty** (recorder→ocr clean).

The recording ffmpeg/gdigrab/WASAPI path is untouched by this phase.

## Test-convention note

The plan sketched a `@testing-library/react` component test for the panel, but the
project has **no** component-test infrastructure (no `@testing-library`, no jsdom) —
its convention is pure-logic `.test.ts` files. Rather than add a jsdom + testing-library
stack for one panel, the panel's testable view-logic was extracted into a pure
`ocrPanelModel` (`hasText` / `countsLabel` / `copyTarget`) and unit-tested there,
matching `trimModel.test.ts` et al.

## At-screen checklist (manual — deferred to user)

Run `npm run tauri dev`:

- [ ] **Home → Capture Text**: drag over on-screen text → panel opens with recognized
      text; the text is on the clipboard (paste to confirm). Main window was hidden
      during the freeze (Glint not in the frame) and returns afterward.
- [ ] **Tray → Capture → Capture Text**: same flow from the tray.
- [ ] **Library image card → Extract text** (ScanText icon): panel with the image's text.
- [ ] **Post-capture HUD → Extract text**: panel with the just-captured region's text.
- [ ] Capture Text over: a **code** block, a **paragraph**, and **UI chrome** — text is
      reasonable; multi-line preserved.
- [ ] **Copy** in the panel re-copies (whole text, or the current selection if any).
- [ ] **Empty state**: capture a region with no text → "No text found in that region."
- [ ] **No language pack** (if applicable): a graceful "install a language pack in
      Windows Settings → Time & Language" message rather than a crash.
- [ ] **Screenshot-only**: recording Library rows show **no** Extract text action.
