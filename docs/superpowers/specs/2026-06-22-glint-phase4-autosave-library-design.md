# Glint Phase 4 — Auto-save + Library: Design

> Every screenshot becomes durable and discoverable: auto-saved to a folder,
> recorded in the captures database, and browsable in a real Library with
> thumbnails and actions. The Auto-save settings panel goes live. Local-first;
> no cloud, no network. Builds on the Phase 2 capture pipeline + Phase 3 HUD.

Status: **draft 2026-06-22**. Parent: `2026-06-20-glint-architecture-and-phase0-design.md`.
User decisions (AskUserQuestion 2026-06-22):
- Auto-save **on by default** → captures written to `Pictures\Glint`, Library auto-populates.
- Save folder **fixed** at `Pictures\Glint` (a folder picker is deferred to P8).
- Library item actions: **Open, Reveal, Copy, Delete, Drag** (editing arrives P5).

---

## 1. Goal & scope

After Phase 3, a capture lands on the clipboard and in a temp file behind the HUD,
but it leaves no durable trace — the Library is empty and the Auto-save settings are
inert. Phase 4 makes capture history real.

**In scope (P4):**
- **Auto-save** (default on): each committed screenshot is written to
  `Pictures\Glint\Glint <yyyy-MM-dd> at <HH.mm.ss>.png` (collision-safe), a thumbnail
  is generated, and a row is inserted into the `captures` table.
- **The Library view becomes real:** a grid of `CaptureCard`s (thumbnail + timestamp +
  dimensions) with hover actions — Open (OS default viewer), Reveal (Explorer),
  Copy (to clipboard), Delete (soft-delete + remove file), and **drag-out** (reuses the
  proven `tauri-plugin-drag` path). Search + kind filter already exist; they light up.
- **Auto-save settings go live:** `auto_save` and `auto_copy` (both default true) persist
  and drive behaviour. "Open in editor after capture" stays an honest stub until P5.
- **HUD coherence:** when a capture was auto-saved, the HUD's Save action becomes
  "Reveal in folder" (so it never silently makes a duplicate).

**Explicitly NOT in scope (mapped to later phases):**
- Opening a capture into the annotation editor → **P5**.
- Recordings (the recording kind, durations) → **P6**.
- Format/quality options, a save-folder picker, bulk-select, grid virtualization → **P8** polish.

---

## 2. Architecture

### 2.1 Ownership — tray-core owns the captures table
Per the architecture doc, the Rust "brain" owns SQLite. Phase 4 honours that: Rust writes
and reads the `captures` table directly via **`rusqlite`** (bundled), so a hotkey capture
is recorded even when the main window is closed-to-tray.

Clean split of the single `glint.db` file:
- **plugin-sql (JS)** — `settings` table only (unchanged; already working).
- **rusqlite (Rust)** — `captures` table only.

Two connections to one file is fine for a single-user, low-write app. The Rust connection
sets `PRAGMA busy_timeout=5000` to ride out the rare lock, and does not change the journal
mode (avoids fighting plugin-sql's connection). Rust runs a defensive
`CREATE TABLE IF NOT EXISTS captures (...)` on connect — idempotent against the table the
plugin-sql migration already creates at main-window boot.

### 2.2 Settings hydration (fixes a latent gap)
Today the Rust `SettingsState` starts at `Default()` each launch and is never hydrated from
disk, so Rust can't know the user's preferences. With rusqlite available, Rust now reads the
`settings` table at startup and hydrates `SettingsState`. New fields `auto_save` and
`auto_copy` (default true) are added to the Rust `Settings` and the frontend `Settings`;
`settings_set` validates them and keeps the in-memory copy live for the current session.

### 2.3 Flow
1. **Commit** (`finish_commit`, Rust, background thread):
   - Crop → `rgba`.
   - If `auto_save`: ensure `Pictures\Glint`, resolve a deduped timestamped path, write the
     full PNG there → `durable_path`. Else: write the temp PNG as today → `durable_path` in temp.
   - If `auto_copy`: copy the image to the clipboard (else skip).
   - Always mirror `%USERPROFILE%\.glint\latest.png`.
   - If `auto_save`: generate a thumbnail (downscale, long edge ≤ 480 px) → `thumbs` dir;
     `insert_capture` row (`kind='screenshot'`, `path`, `thumb_path`, `width`, `height`,
     `bytes`, `created_at`); emit `capture-saved`.
   - Stash `LastCapture { path: durable_path, …, saved: auto_save }`; open the HUD.
2. **Library** (JS): on mount and on each `capture-saved` event → `captures_list` (Rust) →
   rows enriched with a `thumb_data_url` → render cards.
3. **Card actions** → Rust commands (below); drag-out → `startDrag([path])`.

### 2.4 Recorder isolation (unchanged sacred constraint)
Nothing here touches ffmpeg/scap/recorder. Only `rusqlite`, `image`, `arboard`,
`tauri-plugin-drag`, `std::fs`, and `std::process::Command` (open/reveal).

---

## 3. Components

### 3.1 Rust
- **`db/mod.rs`** (extend) — a managed `Db` (rusqlite `Connection` behind a `Mutex`, lazily
  opened to `app_config_dir()/glint.db`). Functions: `ensure_schema`, `insert_capture(NewCapture) -> i64`,
  `list_captures() -> Vec<CaptureRow>`, `soft_delete(id)`, `capture_path(id) -> Option<String>`.
  Keep `migrations()` (plugin-sql) for the settings table.
- **`capture/commands.rs`** (extend) — `finish_commit` branches on `auto_save` and inserts the
  row + thumbnail. New commands: `captures_list` (rows + thumbnail data-URLs), `capture_open`,
  `capture_reveal`, `capture_copy`, `capture_delete`. `hud_save` becomes save-or-reveal based on
  `LastCapture.saved`.
- **`capture/thumb.rs`** (new, small + unit-tested) — pure resize math
  (`thumb_dimensions(w, h, max) -> (w, h)`), plus a `make_thumb(rgba, w, h) -> png bytes` helper.
- **`paths.rs`** (extend) — `thumbs_dir(app_local)` helper for thumbnail storage.
- **`settings/`** — add `auto_save` / `auto_copy`; hydrate `SettingsState` from the DB at setup.
- **`clipboard.rs`** — reuse `copy_image` (decode a PNG file → rgba via the `image` crate for
  `capture_copy`).
- **`lib.rs`** — register the new commands + `Db` state; resolve the DB path; hydrate settings.

### 3.2 Frontend
- **`views/LibraryView.tsx`** (rebuild) — real `CaptureCard` grid; reload on `capture-saved`.
- **`views/library/CaptureCard.tsx`** (new) — thumbnail, timestamp + dimensions, hover action
  overlay (Open / Reveal / Copy / Delete), and the card as a drag handle.
- **`lib/captures.ts`** (new) — typed wrappers: `listCaptures`, `openCapture`, `revealCapture`,
  `copyCapture`, `deleteCapture`, and `dragOut` re-use.
- **`views/settings/AutoSave.tsx`** — enable the first two toggles, bound to the store.
- **`store/useAppStore.ts`** — `auto_save` / `auto_copy` in `Settings` + setters
  (`saveSetting` + `persistSetting`, mirroring `setTheme`).
- **`hud/`** — Save↔Reveal swap driven by `hud_data.saved`.

---

## 4. Data flow & contracts

| Direction | Mechanism | Payload |
|---|---|---|
| commit → DB | Rust `insert_capture` | row (kind, path, thumb_path, w, h, bytes, created_at) |
| commit → app | `capture-saved` event | — (Library re-queries) |
| Library → Rust | `captures_list()` | → `CaptureRow[]` each with `thumb_data_url` |
| Library → Rust | `capture_open/reveal/copy/delete(id)` | — / toast on error |
| Library → OS | `startDrag({ item:[path], icon:path })` | drag-out |
| settings → Rust | `settings_set(auto_save/auto_copy)` | live in-memory + JS persists to SQLite |

`CaptureRow` matches the existing `captures` schema (`id, kind, path, thumb_path, width,
height, duration_ms, bytes, app_name, window_title, created_at, deleted_at`). The list command
adds a transient `thumb_data_url` (base64 of the thumbnail PNG; small — full asset-protocol
serving is a P8 optimization).

---

## 5. Error handling

| Failure | Behaviour |
|---|---|
| Auto-save write fails (perms/disk) | toast "Couldn't save to <folder>"; fall back to a temp PNG; capture still copied + HUD opens. Never lost. |
| Thumbnail generation fails | non-fatal; row stores `thumb_path = NULL`; the card shows a placeholder tile. |
| DB insert fails | log + toast; the saved file still exists on disk. |
| `captures_list` fails (DB locked) | Library shows its empty / error state; retries on next `capture-saved`. |
| Open / Reveal / Copy fails | toast; no state change. |
| Delete: file removal fails | still soft-delete the row (card disappears); log the file error. |

---

## 6. Testing

**Rust unit tests (headless, TDD):**
- `thumb::thumb_dimensions` — aspect-preserving downscale; no upscaling past the source;
  square + wide + tall cases.
- `db` against an in-memory rusqlite (`Connection::open_in_memory`): `insert_capture` returns an
  id; `list_captures` returns newest-first and excludes soft-deleted; `soft_delete` hides a row.
- `paths` (existing) already cover filename/dedupe/save-dir.

**Manual (human at screen — folds into P2–P4 acceptance):**
- Capture with auto-save on → file appears in `Pictures\Glint`; the Library shows it instantly.
- Card actions: Open launches the viewer; Reveal selects it in Explorer; Copy pastes the image;
  Delete removes the card + file; dragging a card drops the PNG into another app.
- Toggle auto-save off → new captures stop auto-saving; the HUD Save adds them; toggle persists
  across restart. Toggle auto-copy off → the clipboard is not touched on capture.
- `.glint\latest.png` still updates each capture.

---

## 7. New dependencies

- **`rusqlite`** (with the `bundled` feature) — Rust-owned access to the `captures` table; no
  system SQLite dependency. No new JS deps (drag + plugin-sql already present). Open / Reveal use
  `std::process::Command` (`cmd /C start` and `explorer /select,`), so no shell/opener plugin is
  pulled in.

---

## 8. Risks & mitigations
- **Two SQLite libraries, one file** — single-user, ~one write per capture; `busy_timeout=5000`
  on the Rust side absorbs the rare lock. Journal mode left untouched to avoid fighting plugin-sql.
- **Schema race on a fresh install** — the plugin-sql migration creates the tables at main-window
  boot (always before the first user-triggered capture); Rust's `CREATE TABLE IF NOT EXISTS` is a
  safe net, never a conflicting `CREATE TABLE`.
- **Thumbnail data-URL weight** — thumbnails are small (≤ 480 px); fine for early libraries. If a
  library grows large, switch the grid to the asset protocol (P8); the schema already stores
  `thumb_path`.
- **Duplicate saves from the HUD** — avoided by the Save↔Reveal swap keyed on `LastCapture.saved`.
</content>
