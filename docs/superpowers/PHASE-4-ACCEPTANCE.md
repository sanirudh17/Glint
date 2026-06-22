# Phase 4 — Auto-save + Library — Acceptance

**Branch:** `phase-4-library`
**Status:** Implementation complete; automated gate green. Manual (human-at-screen) acceptance pending.

## Automated gate (green)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vite build` | clean |
| `cargo test` | 33 passed, 0 failed, 2 ignored |

New tests this phase: `thumb` (5), `db::` (4), `settings::` auto-save/auto-copy (3), `paths::thumbs_dir_joins` (1).

## What shipped

- **Auto-save:** `finish_commit` branches on the hydrated `auto_save` setting — writes the PNG to
  `Pictures\Glint` (timestamped, collision-free) when on, else a temp file. `auto_copy` gates the
  clipboard. `.glint\latest.png` mirror is written every capture regardless.
- **Captures table owned by tray-core** via `rusqlite` (bundled), same `glint.db` plugin-sql uses
  for `settings`. Created lazily with `CREATE TABLE IF NOT EXISTS` at capture/library time only.
- **Thumbnails:** aspect-preserving downscale (≤480px long edge) saved under `<app_local>/thumbs`.
- **Library:** real cards (thumbnail, dimensions, timestamp) from a Rust `captures_list` command
  with inlined base64 thumbnail data-URLs; Open / Reveal / Copy / Delete / drag-out; live reload on
  the `capture-saved` event.
- **Settings:** Auto-save panel is live (auto-save + auto-copy toggles); Rust hydrates persisted
  settings from disk at startup; JS persists via plugin-sql.
- **HUD:** the Save action becomes Reveal-in-folder when the capture was auto-saved (no duplicate
  saves), keyed on `LastCapture.saved`.

## Manual checklist (human at screen)

- [ ] Capture with auto-save ON → file appears in `Pictures\Glint`; the Library shows it instantly.
- [ ] Card **Open** launches the default image viewer.
- [ ] Card **Reveal** selects the file in Explorer.
- [ ] Card **Copy** puts the image on the clipboard (paste into another app).
- [ ] Card **Delete** removes the card and the file.
- [ ] Dragging a card drops the PNG into another app.
- [ ] Toggle auto-save OFF → new captures stop auto-saving; the HUD **Save** adds on demand; the
      toggle persists across an app restart.
- [ ] Toggle auto-copy OFF → the clipboard is not touched on capture.
- [ ] `.glint\latest.png` still updates on each capture.
- [ ] HUD shows **Reveal in folder** (not Save) when auto-save was on for that capture.

## Notes

- Orphan thumbnails after delete are harmless and left for a P8 cleanup pass (the schema stores
  `thumb_path`).
- If a library grows large, switch the grid from inline data-URLs to the asset protocol (P8).
