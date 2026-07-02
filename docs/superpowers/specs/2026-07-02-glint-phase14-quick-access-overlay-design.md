# Glint — Phase 14: Quick Access Overlay (design)

**Date:** 2026-07-02
**Branch:** `phase-14-quick-access-overlay` (merges to `master`)
**Status:** approved design → implementation plan next

## Goal

Evolve the single post-capture HUD into an **accumulating corner tray**: each new
capture joins a vertical stack in the bottom-left, and every card is independently
actionable (Copy, Copy-path, Save/Reveal, Annotate, Extract-text, Pin, Drag,
Delete), plus a tray-level **Clear all**. The stack caps at 5 (oldest drops), lives
in memory only (cleared on quit), and grows/shrinks the window as cards come and go.

## Binding constraints (unchanged)

- **Local-first:** no cloud, no upload, no accounts, no network calls.
- **Single-user:** no auth of any kind.
- **Recorder isolation (SACRED):** untouched. This phase spans
  `capture`/`editor`/`hud`/`pin`/`ocr`, which are already mutually coupled;
  `recorder/*` and `ocr → recorder` are not touched. The green gate re-verifies.
- **Window rules:** build webviews off the main thread; window-targeted events use
  `emit_to` (never global `emit`); a capability edit needs a forced recompile.

## Non-goals (explicitly out)

- **E2 after-capture auto-destination config** (settings to auto-pin/annotate/OCR
  on capture) — a separate settings surface; deferred.
- **Persisting the tray across app restarts** — in-memory only.
- **Reordering cards by drag; multi-select across cards.**
- **A brand-new window/label** — we evolve the existing `hud` window in place to
  avoid capability/label churn.

## Current state (what we build on)

- `LastCapture { path, width, height, rgba, saved }` +
  `LastCaptureState(Mutex<Option<LastCapture>>)` — one result at a time
  (`capture/mod.rs`).
- `finish_commit` (`capture/commands.rs`) writes the PNG (Pictures\Glint if
  auto-save, else `app_local_data_dir/tmp/glint-<ts>.png`), sets `LastCapture`,
  then calls `crate::hud::open`.
- HUD commands read `LastCaptureState`: `hud_data` (encodes full PNG→data URL),
  `hud_copy` (uses in-memory `rgba`), `hud_copy_path`, `hud_save` (file-copies
  `path`→Pictures), `hud_reveal`, `hud_dismiss` (closes the window).
- `editor_open_from_last` (`editor/commands.rs:56`), `pin_create_from_last`
  (`pin.rs:125`), `ocr_extract_last` (`ocr/commands.rs:55`) each read
  `LastCaptureState`.
- `hud.rs` builds a fresh 244×172 bottom-left window per capture, torn down on the
  next capture / dismiss. It is `focused(false)`, `transparent(true)`,
  `always_on_top`, `skip_taskbar`.
- Frontend: `HudApp` (route `#/hud`) renders one card; `HudActions` is the hover
  toolbar; `hudIpc.ts` wraps the commands; `hud.json` capability =
  `["core:default", "drag:default"]` on window `["hud"]`.

## Backend

### Tray store (new source of truth)

New module `capture/tray.rs`:

```rust
#[derive(Clone, Serialize)]
pub struct TrayItem {
    pub id: u64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub saved: bool,       // true → path is a Library file (never delete on drop)
    pub thumb: String,     // small base64 PNG data URL for the card (not full-res)
}

#[derive(Default)]
pub struct TrayStore {
    items: Vec<TrayItem>,  // newest last
    next_id: u64,
}

pub const TRAY_CAP: usize = 5;

impl TrayStore {
    /// Push a new item (assigns the id). Returns the dropped-oldest item when the
    /// push exceeds TRAY_CAP, so the caller can clean up its temp file.
    pub fn push(&mut self, path, width, height, saved, thumb) -> (u64 /*new id*/, Option<TrayItem> /*evicted*/);
    pub fn list(&self) -> Vec<TrayItem>;          // newest last (UI renders bottom-anchored)
    pub fn get(&self, id: u64) -> Option<TrayItem>;
    pub fn remove(&mut self, id: u64) -> Option<TrayItem>;
    pub fn clear(&mut self) -> Vec<TrayItem>;     // returns removed items for cleanup
    pub fn is_empty(&self) -> bool;
}

pub struct TrayState(pub Mutex<TrayStore>);
```

`TrayStore` is a plain struct (no Tauri types) so its logic is unit-tested in
isolation. Wrapped in `TrayState`, registered with `.manage(...)` in `lib.rs`.

**Memory:** items hold only the small `thumb` (generated once at commit via the
existing `crate::capture::thumb::make_thumb(rgba, w, h, ~240)` → base64). Full
pixels are re-read from `path` (decode PNG via the `image` crate) **only** when an
action needs them — so a 5-deep tray stays cheap regardless of capture size.

### Commit path

In `finish_commit`, after writing the PNG and setting `LastCapture` (kept as the
newest-mirror for the existing `…_from_last` hotkeys), also:
1. Build the card thumb (`make_thumb` on `cropped` → base64 data URL).
2. `let (id, evicted) = tray_state.push(path_str, w, h, saved, thumb);`
3. If `evicted` is `Some` and `!evicted.saved`, delete its temp file.
4. `crate::hud::ensure_open(app)` — build the window if absent, else
   `emit_to("hud", "tray-updated", ())` so the live tray refetches.

The `open_in_editor` branch is unchanged (still bypasses the tray straight into
the editor). The deferred Library/mirror bookkeeping thread is unchanged.

### Per-item commands (new; camelCase JS keys → snake_case params)

All resolve the item via `TrayState.get(id)`:

- `tray_list() -> Vec<TrayItem>` — cards to render.
- `tray_copy(id)` — decode PNG at `path` → `clipboard::copy_image`.
- `tray_copy_path(id)` — `clipboard::copy_text(path)`.
- `tray_save(id) -> String` — if `saved`, no-op returning `path`; else file-copy to
  Pictures\Glint (mirror `hud_save`: Library thumb + DB row + `capture-saved`),
  then mark the item `saved` with the new path. Returns the destination.
- `tray_reveal(id)` — reveal `path` in Explorer.
- `tray_pin(id)` — pin from `path` (see refactor below); off-thread.
- `tray_annotate(id)` — open the editor from `path`; off-thread.
- `tray_extract_text(id)` — OCR the image at `path`; off-thread.
- `tray_dismiss(id)` — `remove(id)`; if the removed item was `!saved`, delete its
  temp file; if the store is now empty, close the window; else emit `tray-updated`.
- `tray_clear()` — `clear()`, delete each removed `!saved` temp file, close window.
- `tray_resize(height)` — set the window's logical size (fixed width, given height)
  and reposition **bottom-left-anchored** using monitor scale/position (the same
  math `hud::open` already does), so the stack grows upward with its bottom edge
  pinned. Called by the frontend's ResizeObserver.

### Shared-helper refactor (DRY, minimal churn)

Two kinds of existing commands read `LastCaptureState`:

1. **`…_from_last` (kept — power hotkeys):** `editor_open_from_last`,
   `pin_create_from_last`, `ocr_extract_last` stay (the tray hotkeys / "pin last"
   still use them). Extract a path/dims-based core from each
   (`open_editor_for_png(app, png_bytes, w, h)`, `pin_from_path(app, path)`,
   `ocr_for_path(app, path)`) that both the `…_from_last` command (passing
   `LastCapture.path`) and the new `tray_annotate/pin/extract_text(id)` call. No
   behavior change to the existing commands.
2. **Single-item `hud_*` (removed — superseded by `tray_*`):** `hud_data`,
   `hud_copy`, `hud_copy_path`, `hud_save`, `hud_reveal`, `hud_dismiss` are
   deleted; their logic moves into the per-id `tray_*` equivalents
   (`copy_image_from_path`, `save_file`, `reveal`, etc.). No dead single-item
   commands remain.

### Window (`hud.rs` evolves)

- Rename the fixed per-capture builder to `ensure_open(app)`: if the `hud` window
  exists, no-op (content updates arrive via `tray-updated`); else build it exactly
  as today (off-thread, `focused(false)`, transparent, always-on-top,
  skip-taskbar) but **without a fixed content height** — it opens small and the
  first `tray_resize` sizes it. It is **not** torn down on the next capture
  anymore; it persists and stays continuously visible (never hidden/re-shown),
  sidestepping the WebView2-suspension issue documented in `hud.rs`.
- `begin_restoring` (`capture/mod.rs`) currently calls `crate::hud::teardown(app)`
  at the start of every capture — **remove that** so an in-progress tray survives a
  new capture (the new item is appended instead).
- `teardown(app)` stays (used by `tray_dismiss`/`tray_clear` when the tray empties,
  and on app exit).

### Capability

`hud.json` gains window mutation perms for the tray's self-resize:
`core:window:allow-set-size`, `core:window:allow-set-position` (add
`core:window:allow-inner-size`/`allow-scale-factor` only if needed for the
measure). A capability edit requires a forced recompile.

## Frontend

- **`hudIpc.ts`** grows the typed `tray_*` wrappers and a `TrayItem` type
  (`{ id, path, width, height, saved, thumb }` — `path` is included so the card's
  drag handle can `dragOut(path)`); keeps `dragOut`. The old single-item wrappers
  (`getHudData`, `hudCopy`, `hudCopyPath`, `hudSave`, `hudReveal`, `hudDismiss`)
  are removed — every action is now per-id via `tray_*`.
- **`TrayApp`** (evolves `HudApp`, still route `#/hud`): fetches `tray_list()` on
  mount and on every `tray-updated` event; renders the cards newest-at-bottom;
  runs a ResizeObserver over the stack and calls `tray_resize(heightPx)` whenever
  the measured height changes; shows a `Clear all` affordance when `items.length >= 2`;
  Esc dismisses the whole tray (`tray_clear`).
- **`TrayCard`** (extracts today's single-card markup from `HudApp`): one thumbnail
  (drag handle → `dragOut(item.path)`), the viewfinder ticks, dimensions, a
  per-card Delete (×) → `tray_dismiss(id)`, the hover `HudActions` toolbar wired to
  `tray_*(id)`, and its own inline status line. `HudActions` is reused as-is (its
  `HudAction` union already covers copy/copy-path/save/annotate/extract-text/pin).
- **`hud.css`** grows a `.tray-stack` (vertical flex, gap, bottom-anchored) wrapping
  the existing card styles; the card keeps its current look so each still reads as
  the familiar HUD.

## Data flow

Capture commits → push `TrayItem` (+ mirror `LastCapture`) → `ensure_open` builds
the window or `emit_to("hud", "tray-updated")` → `TrayApp` refetches `tray_list()`
→ renders cards → ResizeObserver → `tray_resize(h)` → window resized bottom-anchored.
Per-card action → `tray_*(id)` → backend resolves the item, runs the shared helper
→ card flashes its own inline confirmation (the tray owns feedback; main may be
hidden).

## Testing

Rust unit tests on `TrayStore` (pure, no Tauri):
- `push` assigns increasing ids; the 6th push returns the evicted oldest and the
  store holds exactly `TRAY_CAP`.
- `list` returns newest-last order.
- `remove(id)` drops the right item and returns it; unknown id → `None`.
- `clear` empties and returns everything.
- eviction/removal of a `saved` item is distinguishable from a temp item (the
  cleanup decision keys off `saved`).

Frontend/window behavior (stacking, resize, per-card actions) is verified
at-screen, consistent with the rest of the HUD/overlay/editor windows.

## Green gate + acceptance

- `npx tsc --noEmit` clean; `npx vitest run` green.
- `cargo build` + `cargo test` green (new `TrayStore` tests included).
- Recorder/ocr isolation greps clean.
- At-screen: take 3–4 captures in a row → cards stack in the bottom-left, newest at
  the bottom; a 6th pushes the oldest off; per-card Copy/Save/Annotate/Pin/Extract/
  Drag/Delete each act on the right shot; Clear all empties + closes; the window
  grows/shrinks smoothly and stays corner-anchored; `open_in_editor` mode still
  bypasses the tray; existing "pin last" hotkey still works.

## Files touched

- Create: `glint/src-tauri/src/capture/tray.rs` (+ `mod tray;` in `capture/mod.rs`).
- `glint/src-tauri/src/capture/commands.rs` — tray push in `finish_commit`; new
  `tray_*` commands; delete the superseded single-item `hud_*` commands (their
  logic moves into `tray_*`).
- `glint/src-tauri/src/capture/mod.rs` — `TrayState`; drop the per-capture
  `hud::teardown` in `begin_restoring`.
- `glint/src-tauri/src/hud.rs` — `ensure_open`; persistent, resizable window.
- `glint/src-tauri/src/editor/commands.rs`, `pin.rs`, `ocr/commands.rs` — extract
  path-based cores; add `tray_annotate`/`tray_pin`/`tray_extract_text` (or route
  them through these modules).
- `glint/src-tauri/src/lib.rs` — `.manage(TrayState)`, register the `tray_*`
  commands, and unregister the deleted single-item `hud_*` commands.
- `glint/src-tauri/capabilities/hud.json` — window set-size/set-position perms.
- `glint/src/lib/hudIpc.ts` — `tray_*` wrappers + `TrayItem` type.
- `glint/src/hud/HudApp.tsx` → tray root; `glint/src/hud/TrayCard.tsx` (new);
  `glint/src/hud/HudActions.tsx` reused; `glint/src/hud/hud.css` — stack layout.

No recorder changes, no new window label, no new capability file.
