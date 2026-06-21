# Glint Phase 2 — Screenshots: Design

> Freeze-frame screenshot capture for Windows. Tauri v2 (Rust tray-core) +
> React/TypeScript overlay. No cloud, no accounts, no network. Builds on the Phase 1
> app shell (tray, hotkeys, SQLite, design system).

Status: **approved 2026-06-21** (design). Parent: `2026-06-20-glint-architecture-and-phase0-design.md`.
Spec → plan → subagent-driven build → green-gate, per the phase-by-phase cadence.

---

## 1. Goal & scope

Press a hotkey (or use the tray "Capture ▸" submenu) → the screen **freezes** → select a
region against the frozen image with a premium overlay → the result is **cropped and copied
to the clipboard**, with a confirmation toast.

**In scope (P2):**
- Three capture modes, all sharing one freeze-frame overlay:
  - **Area** — drag a rectangle; resize via 8 handles; move the whole selection.
  - **Fullscreen** — the whole monitor is the selection; Enter or click confirms.
  - **Window** — hovering auto-highlights the detected window under the cursor; click confirms.
- Premium overlay chrome: dimmed surround with the selection "punched through", crosshair
  guides, live **W×H** dimensions badge, and a magnifier **loupe** (≈8× zoom of the frozen
  pixels around the cursor with the **hex colour** of the centre pixel).
- Per-monitor DPI correctness (logical↔physical mapping). Built on a per-monitor overlay
  architecture; **tuned and tested on a single monitor** for this phase.
- Output: crop the frozen image → PNG → **copy to clipboard** + write a temp working file →
  emit `capture-complete`. P2 shows a "Copied to clipboard" toast.

**Explicitly NOT in scope (later phases):**
- Freehand / lasso selection (later phase).
- Post-capture HUD (P3), drag-out & copy-as-path (P3), `latest.png` mirror (P3).
- Auto-save, file naming, `captures` history / Library population (P4).
- Annotation editor (P5), recording (P6), scrolling capture, OCR (P7).
- Multi-monitor *tuning* (architecture is built multi-monitor-ready; only single-monitor is
  exercised now).

---

## 2. Architecture

### 2.1 Ownership — capture lives in tray-core
The entire capture pipeline runs in **tray-core (Rust)**, independent of the main window.
Pressing the hotkey while Glint is hidden in the tray still captures. Triggers
(`shortcuts.rs` closures, tray "Capture ▸" submenu) call `capture::begin(mode)` **directly
in Rust** — they do **not** round-trip through the main webview. (Phase 1's
`shortcut-fired → toast` wiring is replaced for the three capture actions only; `record` and
settings actions are untouched.)

### 2.2 Freeze-frame flow
1. Trigger → `capture::begin(mode)`.
2. `xcap` grabs the target monitor's pixels **instantly** into an in-memory RGBA image; the
   padded GPU row-stride is removed into a packed buffer (the Phase 0 spike flagged this for
   full-display grabs). The frozen image is written to a temp PNG.
3. Rust opens a **transparent, borderless, always-on-top, fullscreen** overlay
   `WebviewWindow` covering the monitor, routed to `#/overlay`, showing the frozen PNG as a
   full-bleed background. The screen *looks* live but is frozen — windows and the cursor
   moving underneath do not change what is selected.
4. React drives the mode UX and, on confirm, sends the chosen rectangle (in **logical/CSS
   pixels**, relative to the monitor) back to Rust, which maps it to physical pixels.
5. Rust crops the frozen image to that rect → final PNG → copies to the clipboard
   (`arboard`) + writes a temp working file → emits `capture-complete { path, width,
   height }` → all overlay windows are torn down. P2: the main app shows a toast.

### 2.3 Per-monitor overlay architecture
The architecture enumerates monitors and opens **one overlay window per monitor**. For this
phase only the primary monitor is exercised, but the code path is multi-monitor-shaped:
overlays are keyed by a `monitorId`, and `capture_commit` carries the `monitorId` so the
crop uses the correct frozen image and scale factor. A single spanning overlay was rejected
(transparency across mixed-DPI monitors is unreliable on Windows).

### 2.4 Recorder isolation (sacred constraint)
The capture path has **zero** compile-time or run-time dependency on ffmpeg or the recorder
module — `xcap` only. A recording problem cannot affect screenshots.

### 2.5 Platform abstraction
Native capture sits behind a small Rust trait (`ScreenCapturer`) with a Windows
implementation backed by `xcap`, keeping `#[cfg(windows)]` out of the orchestration and crop
logic. A non-Windows impl can slot in later; it is neither built nor tested now.

---

## 3. Components

### 3.1 Rust (tray-core) — new modules
- **`capture/frozen.rs`** — `ScreenCapturer` trait + `xcap` Windows impl. Grabs a monitor to
  packed RGBA, writes the temp PNG, returns `FrozenFrame { monitor_id, width, height,
  scale_factor, path }`.
- **`capture/crop.rs`** — **pure, unit-tested**: crop a rect from an RGBA buffer; map overlay
  logical coords → physical pixels via `scale_factor`; clamp rects to monitor bounds; reject
  degenerate (zero-area) rects.
- **`capture/windows_enum.rs`** — enumerate top-level windows with bounds, z-order, title and
  owning-app name (drives Window mode; also the source of future capture metadata). Backed by
  `xcap`'s window API.
- **`capture/mod.rs`** — orchestration: `begin(mode)`, `commit(rect, monitor_id)`,
  `cancel()`; owns the frozen-frame + overlay-window lifetime.
- **`overlay.rs`** — build and tear down the per-monitor transparent overlay
  `WebviewWindow`(s); guarantees teardown of **all** overlays on commit/cancel/error.
- **`clipboard.rs`** — `arboard` RGBA-image → Windows clipboard.

### 3.2 Frontend — new overlay app
Rendered only inside the overlay webview at `#/overlay` (frozen PNG as full-bleed background,
loaded via the Tauri asset protocol — not a giant IPC payload). Reuses Phase 1 design tokens.
- **`SelectionLayer`** — dimmed surround with the selection punched through; drag-to-create;
  8 resize handles; move-by-drag.
- **`Loupe`** — a canvas sampling the frozen image ≈8× around the cursor, with the centre
  pixel's **hex colour** label.
- **`Crosshair`** — full-width/height guide lines tracking the cursor.
- **`DimensionsBadge`** — live **W×H** in physical pixels, repositioning to stay on-screen.
- **Mode controllers** — Area / Fullscreen / Window behaviours over the shared overlay.

---

## 4. Data flow & contracts

| Direction | Mechanism | Payload |
|---|---|---|
| Trigger → Rust | `shortcuts.rs` / tray submenu → `capture::begin` | `mode: "area" \| "fullscreen" \| "window"` |
| Rust → overlay | overlay window URL + asset protocol | `#/overlay?monitor=<id>`; frozen PNG via asset URL |
| Overlay → Rust | `capture_commit` command | `{ rect: { x, y, w, h }, monitorId }` (logical/CSS px; Rust maps to physical) |
| Overlay → Rust | `capture_cancel` command | — |
| Rust → app | `capture-complete` event | `{ path, width, height }` |

- For **Window** mode, the overlay receives the enumerated window-rect list (z-ordered) on
  launch and hit-tests under the cursor locally; no per-move IPC.
- **No `captures` table writes in P2.** The clipboard + temp PNG are the only outputs. Library
  remains empty until P4.
- New Tauri commands (`capture_commit`, `capture_cancel`) are **app-defined** via
  `generate_handler!` and need no ACL permission. The overlay window is covered by an
  appropriate capability (extend the `main`-window capability to the `overlay` window, or add
  an `overlay` capability granting `core:default` + the capture commands; asset protocol for
  the temp dir is enabled for the overlay).

---

## 5. DPI & coordinate model

- `xcap` returns the monitor image in **physical pixels**.
- The overlay window covers the monitor in **logical** coordinates; the frontend reports
  cursor/selection in CSS pixels.
- `capture/crop.rs` maps logical → physical with the monitor's `scale_factor` (e.g. 1.25,
  1.5) so the crop lands on exact physical pixels. The dimensions badge reports **physical**
  W×H (what the saved image actually is).
- Rects are clamped to `[0, width] × [0, height]`; zero-area selections are rejected (no
  crop, overlay stays open).

---

## 6. Error handling

| Failure | Behaviour |
|---|---|
| `xcap` grab fails | toast "Couldn't capture screen"; no overlay; no crash; logged. |
| Overlay window spawn fails | log, tear down any partial overlays, abort capture cleanly. |
| Esc / focus-loss / second trigger | tear down **all** overlay windows; no orphaned always-on-top windows. |
| Zero-area / degenerate selection | ignored; overlay stays open. |
| Clipboard write fails | non-fatal: temp PNG still written; toast a warning. |
| Window-enum fails (Window mode) | fall back to Area behaviour; log. |

---

## 7. Testing

**Rust unit tests (headless, CI-able):**
- Crop correctness (interior rect, edge rect, full-frame).
- Logical→physical mapping at scale factors 1.0 / 1.25 / 1.5 / 2.0.
- Rect clamping to monitor bounds; rejection of zero-area rects.
- Window hit-testing (topmost window under a point, z-order respected).
- Temp-path / file-naming determinism.

**Manual (human at the screen — part of the Phase 2–4 acceptance test):**
- Hotkey freezes the screen; overlay appears; loupe shows correct zoom + hex; dimensions
  badge tracks the drag.
- Area / Fullscreen / Window each produce the expected crop on the clipboard (paste into an
  image app to confirm exact pixels, no colour swap).
- Esc cancels with no leftover overlay window; second hotkey while an overlay is open behaves
  sanely.

---

## 8. New dependencies (local-only, no network)

- **`xcap`** — still capture of monitors + window enumeration (the stills sibling of the
  `scap` proven in the Phase 0 spike).
- **`arboard`** — robust Windows image clipboard.

Both are established, offline, single-user-friendly crates. No change to the local-first
invariant (zero network egress).

---

## 9. Risks & mitigations

- **Overlay spawn latency** — opening a webview adds tens of ms before the frozen image
  shows. Mitigation: grab + write the temp PNG first, keep the overlay HTML minimal, load the
  frozen image via the asset protocol. Acceptable for P2; revisit if it feels slow.
- **`xcap` buffer stride** — full-display grabs return padded rows; `frozen.rs` de-strides
  into a packed buffer before encoding (carried forward from the spike).
- **Transparent always-on-top window teardown** — a missed teardown leaves an invisible
  click-blocking window. Mitigation: a single `overlay::teardown_all()` invoked on every exit
  path (commit, cancel, error), plus a guard against double-`begin`.
- **Mixed-DPI multi-monitor** — not exercised this phase; the per-monitor architecture and
  the explicit `scale_factor` mapping keep it from being a rewrite later.
