# Glint Phase 18 — Settings Truthfulness + Library Rename/Search — Design Spec

**Date:** 2026-07-03
**Branch:** `phase-18-settings-truthfulness` → merge to `master`
**Status:** Approved (brainstorm). Awaiting plan.
**Builds on:** Phases 1–17, all on `master`.

## Goal

Make three surfaces honest and useful. The Settings panel currently shows four controls as
disabled "Available in a later phase" stubs (image format, JPEG quality, recording frame rate,
video codec) and the Library search box filters on the file path — which is always
`Glint <timestamp>`, so it can never match by content. This phase makes the implementable
settings **real**, represents the genuinely-fixed one **honestly** (no fake control), and makes
Library search useful by letting captures be **renamed**.

Binding constraints unchanged: everything local (no cloud/upload/accounts/network), single-user
(no auth). **Recorder isolation (SACRED):** `recorder/*` imports nothing from `capture/`,
`editor/`, `overlay/`, `ocr/`; `ocr/` imports nothing from `recorder/`.

## A. Image format & JPEG quality (Capture settings → real)

**Settings (new, persisted to SQLite like the rest):**
- `image_format`: `"png" | "jpeg" | "webp"`, default `"png"`.
- `jpeg_quality`: `"high" | "medium" | "low"` → maps to JPEG quality **92 / 80 / 65**, default
  `"high"`. Applies to JPEG only.

**Encoder core (new pure helper):** `settings::image::encode_save(rgba, w, h, fmt, quality)
-> (Vec<u8>, &'static str)` returning the encoded bytes and the file extension:
- `png` → `PngEncoder` (today's behavior).
- `jpeg` → `JpegEncoder::new_with_quality(q)`; ext `"jpg"`.
- `webp` → the `image` crate's **lossless** WebP encoder (0.25 encodes WebP losslessly). The
  quality slider therefore genuinely governs JPEG only, matching the UI label "JPEG quality".

**Filename:** `capture_filename(dt, ext)` → `Glint %Y-%m-%d at %H.%M.%S.<ext>`.

**Wiring — applies to the direct screenshot saves only:**
- Capture auto-save (`capture/commands.rs` `finish_commit`), tray "Save" (`tray_save`), and pin
  "Save to Library" (`pin.rs`) encode via `encode_save` and name with the returned ext.
- **Explicitly unchanged (boundary decision, user-approved):** the `latest.png` coding-agent
  mirror stays PNG; the HUD/tray thumbnail data-URLs stay PNG (display only); and the **editor's
  own "Export"** stays PNG — it is a deliberately PNG-labeled action, not an auto-save.

**UI (`Capture.tsx`):** format + quality become live `Select`s bound to the store; the
"Available in a later phase" note is removed; the JPEG-quality control is enabled only when
format = JPEG (otherwise shown disabled with a hint that it applies to JPEG).

**Tests:** `encode_save` per format returns the correct magic bytes (PNG `\x89PNG`, JPEG
`\xFF\xD8`, WebP `RIFF….WEBP`) and extension; a higher JPEG quality yields more bytes than a
lower one on the same input.

## B. Recording frame rate (real) + honest codec

**Setting (new):** `record_fps`: `30 | 60`, default **60** (today's `const FPS`). Read at
record-start and passed to the existing `build_ffmpeg_args(…, fps, …)` (already a parameter →
gdigrab `-framerate`). The `const FPS` usage in `recorder/mod.rs` is replaced by the setting.

**UI (`Recording.tsx`):**
- Frame rate → a live `Select` (30 fps / 60 fps); note removed.
- **Video codec stays H.264** (libx264, unchanged) and is shown **honestly**: the disabled
  dropdown + "later phase" note is replaced by a read-only info line — *"H.264 · MP4 (maximum
  compatibility)"* — styled as static text (`.settings-static-value`), not a control. Rationale:
  H.265 brings real playback-compatibility tradeoffs for little gain; representing it as a fixed
  value is more honest than a fake selector.

**Tests:** an ffmpeg-arg test asserting `record_fps` 30 vs 60 changes the `-framerate` value
(the arg builder already takes fps; this pins the wiring).

## C. Library rename + search

**DB:** add a nullable `title TEXT` column to `captures`:
- Boot path: new plugin-sql `Migration { version: 2, … "ALTER TABLE captures ADD COLUMN title
  TEXT" }`.
- Defensive path: `ensure_captures_table` includes `title` in its `CREATE TABLE IF NOT EXISTS`
  and additionally runs `ALTER TABLE captures ADD COLUMN title TEXT`, ignoring the
  duplicate-column error, so any pre-existing DB gains the column regardless of which path
  created the table.
- `CaptureRow` (Rust) and `CaptureItem` (TS) gain `title: Option<String>` / `title: string |
  null`; `list_captures` selects it.

**Backend:** `capture_rename(id: i64, title: String)` command → `UPDATE captures SET title = ?
WHERE id = ?` (empty/whitespace title clears it back to NULL). Emits nothing — the frontend
refreshes via its existing `onChanged`.

**Frontend:**
- `CaptureCard` shows the custom title (when set) in place of the dimensions line, with the date
  kept. A **Rename** affordance opens an inline text input pre-filled with the current title;
  **Enter** saves via `capture_rename` + `onChanged()`, **Esc** cancels, blur saves.
- `LibraryView` search matches via a pure helper `matchesCapture(item, query)`: true when the
  lowercased query is a substring of the **title**, the **human date** (e.g. "2 jul", "01:07"),
  or the **kind** ("screenshot"/"recording"). Placeholder → "Search by name or date…", aria
  label updated.

**Tests:** DB rename round-trip (set title → `list_captures` returns it; empty clears it); the
pure `matchesCapture` helper (matches title / date / kind; empty query matches all; no-match
case).

## Out of scope

- Editor "Export" following the format setting (stays PNG, by decision).
- H.265 / VP9 / other codecs; true >60 fps (`ddagrab`) — deferred as before.
- OCR-based content search; bulk rename; tags/folders.
- Changing the format of already-saved files (format applies to new saves only).

## Verification / green gate

- `cargo build` + `cargo clippy` warning-clean; `cargo test` + `npx vitest run` green;
  `npx tsc --noEmit` clean.
- At-screen: save a JPEG and a WebP screenshot (correct extension + opens); record at 30 fps and
  confirm the file plays; rename a capture and find it by its new name in search; confirm the
  codec line reads as honest static text.

## Isolation note

No new cross-module coupling. `record_fps` flows through the recorder's existing `fps` parameter
(recorder reads `settings`, which is permitted). The image encoder lives in `settings::image` and
is called from `capture/`/`pin.rs` (already capture-domain). Nothing under `recorder/*` gains a
forbidden import.
