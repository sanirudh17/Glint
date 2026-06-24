# Phase 7 — "Pin to Screen" — Design

**Status:** Design approved (brainstorming gate passed 2026-06-24). Next: writing-plans.
**Branch:** `phase-7-pin-to-screen` (off `master`).
**Roadmap:** ROADMAP.md → Phase 7.

## Goal

Pin a capture as a floating, always-on-top window that stays on screen while you work
elsewhere — CleanShot's signature "Pin to Screen". You can move it, resize it, fade it,
save it, and close it. Multiple pins can coexist; they live only for the session.

## Constraint fit

- **Local-first:** no network, no upload, no accounts — in-memory image bytes + local file read/write only. ✓
- **Single-user / no-auth.** ✓
- **Recorder isolation:** touches only the capture/library/image path — zero recorder/ffmpeg/scap coupling. ✓
- **Visible feedback:** the pin window appearing IS the feedback; right-click actions confirm via toast/inline flash. ✓

## Decisions locked at brainstorming

1. **Entry points:** the post-capture **HUD Pin button** (already stubbed) + a **Library** "Pin to screen" action (card hover button + right-click). NOT the editor.
2. **Interactions:** move (drag), resize (**both** scroll-to-scale AND hover corner handles, aspect locked), close, **adjust opacity**, **save to Library**, **copy to clipboard**. (Copy was added post-review at the user's discretion — near-zero cost since `clipboard::copy_image` already exists and is reused by `editor_copy`; completes the right-click menu naturally.)
3. **Resize:** both scroll-to-scale and corner drag handles.
4. **Persistence:** **ephemeral** — pins live only for the current session; quitting/closing clears them. No on-disk pin state.
5. **Action UI:** a **right-click context menu** (Copy · Save to Library · Opacity ▸ · Close) plus a hover **×** for quick close.

## Architecture (Approach A — mirror the HUD/overlay pattern)

One borderless `WebviewWindow` per pin, backed by a Rust pin registry. Chosen over (B) a single
window managing many pin elements (fights Tauri's one-window-per-floating-thing model and
per-pin always-on-top/drag) and (C) passing image data through the URL (large data in URLs is
fragile; the codebase already has the clean Rust-state-fetch pattern from HUD/overlay).

### Pin window
- Borderless, transparent, always-on-top, `skip_taskbar` (like the HUD), resizable.
- Unique label `pin-<n>` (monotonic counter). Multiple coexist.
- New pins **cascade** (small fixed offset per pin) so they don't stack exactly.
- Initial inner size = the image's natural CSS size, **capped to ~40% of the monitor**
  (whichever is smaller), aspect-locked.
- **Ephemeral:** state is in-memory only (`PinState`); closing the window or quitting Glint
  clears it. No restore-on-launch.
- **Interactive window (NOT focus-less).** Unlike the HUD, a pin must receive pointer/wheel/
  context-menu events and may take focus when clicked, so it is built `focused(false)` (don't
  steal focus on creation) but is otherwise a normal interactive window. This also avoids the
  documented WebView2 occlusion-suspend gotcha (which only affects a focus-less, repeatedly
  hidden-and-reshown window): a pin is built once and stays visible until closed, never hidden/
  reshown, so it is safe.

### Rust pin registry
- `PinState(Mutex<HashMap<String, PinData>>)` where `PinData { png: Vec<u8>, width: u32, height: u32 }`.
- A monotonic counter (e.g. `AtomicU64`) generates unique labels `pin-<n>`.
- Managed in `lib.rs` like `EditorState`/`PendingOpen`.

### Commands
- `pin_create_from_last(app, last, pins) -> Result<(), String>` — pins the most recent capture
  (HUD path): pull PNG + dims from `LastCaptureState` (as `editor_open_from_last` does), store
  in `PinState`, build + position + show the window.
- `pin_create_from_capture(app, db, pins, id) -> Result<(), String>` — pins a Library capture by
  id: resolve the path, read + decode → re-encode PNG, store, build window. (Mirrors
  `editor_open_capture`.)
- `pin_data(pins, window) -> Result<PinDataDto, String>` — the pin webview calls this on mount;
  returns `{ image_data_url, width, height }` for the **current window's label**. (Mirrors
  `getHudData`/`editor_source`.)
- `pin_save(app, db, pins, window) -> Result<String, String>` — write this pin's PNG as a NEW
  Library capture (reusing the `editor_save`/`hud_save` write+thumb+insert+emit path); returns
  the saved path.
- `pin_copy(pins, window) -> Result<(), String>` — copy this pin's image to the clipboard,
  decoding the stored PNG and reusing `crate::clipboard::copy_image` (exactly as `editor_copy`).
- `pin_close(app, pins, window) -> Result<(), String>` — close the window and remove its entry
  from `PinState`. Also remove on the window's `Destroyed` event as a safety net (so an
  OS-driven close can't leak a `PinState` entry).

A small shared `build_pin_window(app, label, width, height) -> tauri::Result<()>` helper does the
windowing (size cap, cascade position, `WebviewWindowBuilder` flags, show) so both `pin_create_*`
commands share one window-construction path.

### Frontend
- **Route:** add `/pin` to `router.tsx` as a chrome-free top-level route (outside `AppShell`,
  like `/overlay` and `/hud`) rendering `<PinApp/>`. (`main.tsx` already forces transparent
  background for `#/pin`.)
- **`PinApp` (`src/pin/PinApp.tsx` + `pin.css`):**
  - On mount: `pin_data()` → render the image full-bleed; on failure, close the window (never
    strand an empty pin), mirroring `HudApp`.
  - **Move:** `onPointerDown` on the image (left button, not on a handle) → `getCurrentWindow().startDragging()`.
  - **Resize — scroll:** `onWheel` scales the window inner size (aspect locked) via
    `getCurrentWindow().setSize(new LogicalSize(w, h))`, clamped `[MIN, monitor]`.
  - **Resize — handles:** four corner handles shown on hover; pointer-drag resizes (aspect
    locked) via `setSize`, same clamps.
  - **Opacity:** CSS `opacity` on the `<img>` (window stays transparent). Levels 100/75/50/25%
    from the context menu; default 100%.
  - **Copy:** `pin_copy()` → inline flash / toast "Copied to clipboard".
  - **Save:** `pin_save()` → inline flash / toast "Saved · <name>".
  - **Close:** hover **×** (top corner) + **Esc** + context-menu Close → `pin_close()`.
  - **Context menu:** a custom in-window menu div on `contextmenu` (the window is borderless, so
    we render our own): **Copy**, **Save to Library**, **Opacity ▸ (100/75/50/25)**, **Close**.
    Dismisses on outside click / Esc.
- **HUD wiring:** replace the stubbed `case "pin"` in `HudApp` (`flash("Pinning arrives in Phase 7")`)
  with a call to `pin_create_from_last()` (then the HUD may stay or dismiss — see Edge cases).
- **Library wiring:** add a "Pin to screen" affordance to the capture card (hover button +
  right-click menu) calling `pin_create_from_capture(id)`.
- **IPC wrappers:** a small `src/lib/pin.ts` with typed wrappers for the six commands.

## Data flow

`pin_create_*` → resolve PNG + dims → insert into `PinState[label]` → `build_pin_window` →
`PinApp` mounts → `pin_data()` (keyed by its own window label) → renders. `pin_save` / `pin_close`
are per-label, resolving the label from the calling window.

## Edge cases

- **HUD after pinning:** pinning from the HUD leaves the HUD as-is (consistent with how the HUD's
  other actions behave); the user dismisses the HUD normally. (We do NOT tear down the HUD on pin.)
- **Library file missing:** `pin_create_from_capture` returns a friendly error → toast; no window.
- **Decode failure:** friendly toast, no window.
- **OS-driven window close** (Alt+F4 / taskbar): the `Destroyed` event handler removes the
  `PinState` entry so no bytes leak for the session.
- **Resize clamps:** never smaller than MIN (~80px logical) nor larger than the monitor work area.
- **Multiple monitors:** cascade + cap use the monitor the pin is created on (primary by default).

## Testing

- **Rust units:**
  - `PinState` insert / get-by-label / remove-by-label.
  - label counter produces unique `pin-<n>` values.
  - size-cap math (natural size vs 40%-of-monitor cap, aspect preserved).
- **At-screen:**
  - Pin from the HUD button; pin from the Library (hover button + right-click).
  - Move (drag), resize by scroll, resize by corner handle (aspect locked, clamps hold).
  - Opacity 100/75/50/25 via right-click.
  - Copy to clipboard (paste into another app).
  - Save to Library (appears in Library/Recent Captures).
  - Close via ×, Esc, and context-menu; multiple pins at once; quitting Glint clears all pins.

## Out of scope (this phase)

- **Persistence** across restart (ephemeral by decision).
- **Click-through / ignore-cursor** ("ghost") mode.
- Pinning from the **editor**.
- Annotating a pin in place.

## New dependencies

None — reuses Tauri window APIs, the `image` crate, `base64`, and the existing DB/thumb/save
helpers.
