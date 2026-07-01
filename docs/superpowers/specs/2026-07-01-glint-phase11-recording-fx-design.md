# Glint — Phase 11: Recording FX (clicks · keystrokes · cursor)

**Date:** 2026-07-01
**Status:** Approved design — ready for implementation plan
**Branch:** `phase-11-recording-fx` (merges to `master`)

## Goal

Add CleanShot X-style **recording polish** — visual effects baked into a screen
recording at capture time:

1. **Click visualization** — an expanding ring/ripple at each mouse click.
2. **Keystroke overlay** — pressed keys shown as key-cap chips in a fixed
   bottom-center strip (the CleanShot / tutorial-video convention).
3. **Cursor emphasis** — a soft **spotlight** halo tracking the cursor, plus
   **hide** (replace the real cursor) and **size** (enlarge the recorded cursor)
   options.

These are the deferred "CleanShot video-polish" items noted in `ROADMAP.md`. All
three collapse into **one shared mechanism**, so they ship together as a single
cohesive phase.

## Constraints (project-wide, unchanged)

- **Local-first, single-user.** No cloud, upload, accounts, auth, or network calls.
- **Recorder isolation (SACRED).** All new Rust lives under `recorder/`; it imports
  **nothing** from `capture/`, `editor/`, `overlay/`, `ocr/`. The ffmpeg/gdigrab/
  WASAPI encode pipeline stays intact (the only pipeline touch is an optional
  `-draw_mouse 0` gdigrab arg, which is recorder-internal).
- **Visible feedback.** Every toggle gives immediate on-screen feedback.

## Core mechanism — on-screen FX overlay captured by gdigrab

The recorder captures the screen via **gdigrab**, which records **whatever is
composited on screen**. This is the same trick that made the Phase 8 R3 webcam
bubble work with **zero** changes to the ffmpeg pipeline: an on-screen window that
is *not* excluded from capture is recorded for free.

**Chosen approach (A):** a single transparent, **click-through**
(`WS_EX_TRANSPARENT | WS_EX_LAYERED`), always-on-top, focus-less overlay window
(`rec-fx`) covering the recording area and **not** excluded from capture. A
full-area `<canvas>` on it draws all three effects; gdigrab records them as part of
the screen.

Approaches considered and rejected:

- **B. ffmpeg `overlay` filter compositing a second generated stream** — heavily
  rewrites the sacred encode pipeline and needs a synced effects stream. Rejected.
- **C. Post-process compositor** (record raw + input log, composite after) — makes
  effects removable/editable later, but is essentially a mini video editor. Deferred
  (this is the roadmap's "independent layer" future).

**Consequence (accepted):** effects are **baked into the MP4** at capture time —
they cannot be toggled off after recording. This mirrors the webcam bubble's already
accepted trade-off.

## Input source (built once, feeds all three effects)

A recorder-owned **global input listener**:

- Low-level `WH_MOUSE_LL` + `WH_KEYBOARD_LL` hooks installed on a **dedicated thread**
  with a Win32 message pump (`GetMessage` loop). Low-level hooks require a message
  loop on the installing thread.
- Started when recording begins **only if at least one FX is enabled** (privacy: no
  hooks otherwise); torn down on stop via `UnhookWindowsHookEx` + `PostThreadMessage(WM_QUIT)`.
- Hook callbacks **must not block** — they hand events off over a channel; the pump
  thread (or the emitting side) forwards to the overlay via `emit_to("rec-fx", …)`.
- **Mouse-move** (for spotlight / cursor) is throttled to ~60 Hz before emit.

Events forwarded:
- `fx-click` `{ x, y, button }` — physical screen coords + which button.
- `fx-key` `{ vk, down }` — virtual-key code + up/down.
- `fx-cursor` `{ x, y }` — throttled cursor position.

## The three renderers (thin, on the canvas)

- **Click viz** — on `fx-click` down, spawn an expanding ring at (x,y); distinct tint
  for left vs right button; ring animates out over ~500 ms.
- **Keystroke overlay** — a **fixed bottom-center** strip. `fxKeystrokeModel.ts`
  (pure, unit-tested) maps vk → label and assembles held modifier combos
  (e.g. `Ctrl ⇧ S`); chips fade after an idle timeout. Rapid typing collapses so the
  strip stays readable.
- **Cursor spotlight** — a soft radial halo drawn under the cursor, following
  `fx-cursor`.

Coordinate mapping: hooks report **physical** screen coords; the overlay window
covers the recording area; the canvas maps device pixels with DPI (`scale_factor`)
awareness. Multi-monitor: the overlay covers the recording monitor / region.

## Cursor extras — spotlight + hide + size

- **Spotlight** — overlay-drawn; no pipeline change; **live-togglable**.
- **Hide real cursor** — adds `-draw_mouse 0` to the gdigrab input; the overlay draws
  our own pointer instead.
- **Cursor size** (`off | large | xl`) — enlarge the recorded pointer. Also relies on
  `-draw_mouse 0` + drawing our own scaled cursor.

**Live vs start-time rule:**

- **Live-togglable** (overlay-only, instant, no ffmpeg restart): click viz, keystroke
  overlay, spotlight.
- **Start-time only** (touch gdigrab args → would need a segment restart mid-recording):
  cursor **hide** and **size**. Chosen at the region selector; shown as fixed state on
  the control bar.

**Scaled-cursor fidelity (honest caveat):** to keep pointer shape when enlarged, the
overlay captures the live `HCURSOR` (`GetCursorInfo` / `GetIconInfo` / `CopyImage`) and
draws it scaled. This is the fiddliest piece; if it proves unreliable, fall back to a
**stylized enlarged pointer sprite** (fixed arrow shape) rather than block the phase.

## UX wiring (mirrors the webcam / audio pattern exactly)

- **Settings** (new fields, seed the selector chips):
  - `record_click_viz: bool`
  - `record_keystrokes: bool`
  - `record_cursor_spotlight: bool`
  - `record_cursor_hide: bool`
  - `record_cursor_size: "off" | "large" | "xl"`
- **Region selector (`RegionSelect.tsx`)** — FX chips seeded from settings, chosen
  per-recording (same as the webcam/audio chips).
- **Control bar (`ControlBar.tsx`)** — live toggles for clicks / keystrokes / spotlight;
  cursor hide/size shown as fixed (start-time) state.

## Files & modules (all recorder-scoped)

**Rust (under `src-tauri/src/recorder/`):**
- `fx/mod.rs` — FX session lifecycle (owns hook thread + overlay window; started/stopped
  by the recording lifecycle).
- `fx/hooks.rs` — low-level mouse/keyboard hook install + message pump + non-blocking
  event forwarding.
- `fx/window.rs` — build the click-through transparent `rec-fx` overlay **off the main
  thread** (window-build rule).
- `fx/keymap.rs` — pure vk → label mapping (unit-tested).
- `ffmpeg.rs` — conditional `-draw_mouse 0` when cursor hide/size is on (recorder-internal).
- `capabilities/recfx.json` — new **label-scoped** capability for the `rec-fx` window.

**Frontend (under `src/recorder/`):**
- `FxOverlay.tsx` — the `<canvas>` renderer; listens for `fx-*` events.
- `fxRender.ts` — ripple / spotlight / chip-strip draw helpers.
- `fxKeystrokeModel.ts` (+ `.test.ts`) — pure vk→label + combo-assembly + chip lifecycle.
- `/rec-fx` route in `router.tsx`.
- Chips in `RegionSelect.tsx`; toggles in `ControlBar.tsx`; settings UI in Settings.

**New-window checklist (from prior experience):** off-main-thread build **+** a
label-scoped capability **+** a forced recompile after capability edits.

## Isolation & privacy

- `recorder/fx/*` imports nothing from `capture/ editor/ overlay/ ocr/`; the recording
  ffmpeg/gdigrab/WASAPI path is otherwise untouched.
- The keyboard hook is keylogger-shaped code, but stays **local**: events only drive
  on-screen chips, are **never persisted or transmitted**. Upholds "everything stays on
  device."

## Risks to spike first

1. **gdigrab capturing a layered click-through window's pixels** — the whole approach
   rests on this. Verify with a throwaway recording of a drawn-on `rec-fx` overlay
   **before** building the renderers. High confidence (DWM composites layered windows to
   the screen; gdigrab grabs the screen), but load-bearing.
2. **Low-level hook responsiveness** — never block the callback; forward async.
3. **DPI / multi-monitor coordinate mapping** for the canvas.

## Testing

- **Pure units (Vitest):** `fxKeystrokeModel` (vk→label, modifier combos, chip lifecycle),
  any pure render-math helpers in `fxRender`.
- **Rust units:** `fx/keymap.rs` vk→label; `ffmpeg.rs` draw_mouse arg presence/absence.
- **At-screen acceptance:** record with each effect on; confirm clicks ripple, keystrokes
  appear bottom-center, spotlight follows, hide removes the real cursor, size enlarges it;
  confirm live toggles work mid-recording for the overlay effects; confirm clean teardown
  (no lingering overlay, hooks removed) on stop.

## Out of scope (this phase)

- Post-hoc editing/removal of effects (the "independent layer" / compositor future).
- Independent webcam layer repositioning after recording.
- Effect theming/customization beyond sensible defaults (revisit at-screen).
