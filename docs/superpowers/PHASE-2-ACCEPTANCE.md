# Glint Phase 2 — Screenshots: Acceptance

Branch: `phase-2-screenshots` · Plan: `plans/2026-06-21-glint-phase2-screenshots.md` ·
Spec: `specs/2026-06-21-glint-phase2-screenshots-design.md`

Status: **automated gate PASS** · **manual acceptance pending (human at the screen)**

---

## Automated gate (CI-able, run 2026-06-21)

| Check | Command | Result |
|---|---|---|
| Rust unit tests | `cargo test` | **16 passed**, 0 failed, 2 ignored (real-capture smoke) |
| Rust lint | `cargo clippy --all-targets` | **clean** (0 warnings) |
| TS typecheck | `npx tsc --noEmit` | **clean** |
| Frontend build | `npx vite build` | **clean** (1841 modules) |

Tested pure logic: logical→physical scaling (1.0/1.5), rect clamp (interior/overflow/
zero-area reject), row de-padding, RGBA crop, window hit-test (topmost wins / point
outside), PNG encode round-trip, capture-mode parse. The `#[ignore]` tests exercise
real `xcap` monitor/window grabs and run only on a machine with a display.

---

## Architecture invariants (verified by inspection / cluster review)

- **Recorder isolation:** the capture path pulls only `xcap`, `image`, `arboard`,
  `base64` — **zero** ffmpeg / scap / windows-capture dependency. (`xcap 0.9.6` uses
  `windows 0.62.2` directly, independent of the P6 `windows-capture=1.4.4` pin.)
- **Capture in tray-core:** hotkeys (`shortcuts.rs`) and the tray "Capture ▸" submenu
  call `capture::begin` directly in Rust — no round-trip through the main webview, so
  capture works with the main window hidden/closed.
- **No `captures` table writes** in P2 (that is P4). Output is clipboard + temp PNG only.
- **Coordinate model:** overlay reports logical/CSS px; Rust maps to physical via the
  monitor `scale_factor`; the dimensions badge / loupe report physical px.
- **Teardown:** every exit path (commit / cancel / error / re-trigger) calls
  `overlay::teardown_all` — no orphaned always-on-top window.

---

## Manual acceptance (human at the screen — `npm run tauri dev`)

The GUI cannot be driven headlessly; these require a person. Tick as verified:

- [ ] **Area:** hotkey freezes the screen → overlay appears → drag a rectangle.
      Dimmed surround with the selection punched through; 1px accent border; 8 handles
      resize; dragging inside moves it.
- [ ] **Loupe:** follows the cursor while aiming/dragging; pixels are crisp (no blur);
      the hex readout matches the pixel under the centre cell (check against a known
      colour swatch).
- [ ] **Dimensions badge:** tracks the drag live; reads **physical** px (e.g. on a 150%
      display a 100×100 logical drag shows 150×150); flips to stay on-screen near edges.
- [ ] **Crosshair:** two guide lines track the cursor before a selection exists; hidden
      once a selection is drawn.
- [ ] **Commit (Area):** Enter or double-click → toast "Copied to clipboard · W×H".
      Paste into Paint → exact region, **no red/blue colour swap**.
- [ ] **Fullscreen:** hotkey → accent frame + hint → Enter/click → whole monitor on the
      clipboard (paste-test).
- [ ] **Window:** hotkey → hover highlights the window under the cursor (dim around it,
      accent trace, physical dims) → click captures exactly that window.
- [ ] **Esc** cancels from any mode with **no leftover overlay window** (desktop fully
      clickable afterwards).
- [ ] **Re-trigger:** pressing a capture hotkey while an overlay is already open behaves
      sanely (old overlay torn down, fresh freeze).
- [ ] **Tray path:** capture works from the tray "Capture ▸" submenu with the main
      window closed to tray.
- [ ] **Temp PNG** exists under `%LOCALAPPDATA%\com.glint.app\tmp\glint-<ts>.png`.
- [ ] **Log clean** (`%LOCALAPPDATA%\com.glint.app\logs\glint.log`): no panics, no
      SQL/ACL denials.

### Known P2 boundaries (by design, not bugs)
- Single-monitor tuned (per-monitor architecture built but only primary exercised).
- No post-capture HUD, drag-out, copy-as-path, or `latest.png` mirror yet → **Phase 3**.
- No auto-save / Library row yet → **Phase 4**. The Library stays empty.
- No freehand/lasso selection (deferred to a later phase).
