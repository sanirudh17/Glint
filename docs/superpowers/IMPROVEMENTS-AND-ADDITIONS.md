# Glint — Improvements & Additions (Post-Core CleanShot Parity)

**Status:** standing backlog. Not scheduled — this is the pool we draw from *after* the
core app is finished, to close the remaining gaps between Glint and the CleanShot X
experience.

**Last reviewed:** 2026-07-02 (against `master` after Phase 11 — Recording FX).

This document is a grounded audit of what exists today plus the implementable gaps and
new features worth adding. Every item was checked against the code, not assumed.

---

## Binding constraints (unchanged — these gate every item below)

- **Local-first only.** Everything stays on device. No cloud, no upload, no accounts, no
  network calls. This permanently excludes CleanShot's cloud/share-link/team features.
- **Single-user.** No login, no auth of any kind.
- **Recorder isolation (sacred).** `recorder/*` imports nothing from `capture/`, `editor/`,
  `overlay/`, `ocr/`; `ocr/` imports nothing from `recorder/`. Any recorder-area item must
  honor this.
- **Build cadence.** brainstorm → spec → plan → build → green-gate → at-screen → merge to
  `master`, on `phase-N-*` branches.

**Effort key:** S = ~a day · M = a few days · L = a phase of its own.
**Impact key:** ★★★ signature CleanShot feel · ★★ clear quality lift · ★ nice-to-have.

---

## Current state snapshot (what already exists)

- **Capture:** area / window / fullscreen; frozen-overlay selection; 8× **loupe** with pixel
  grid, hex readout + colour swatch; crosshair; live dimensions badge; overlay pre-warm.
- **Annotation editor:** 12 tools (select, arrow, line, rect, ellipse, text, pen, highlight,
  blur, step, eraser, crop); single-key tool shortcuts; undo/redo; Ctrl+S; delete-selected;
  numbered steps (auto-increment); partial freehand eraser; style bar (colour, stroke width,
  font size); `.glint` project save/open.
- **Frame / backgrounds:** enable/disable; solid **or** gradient (16 presets) **or**
  transparent background; padding, corner radius, shadow, aspect ratio (auto/1:1/16:9/4:3);
  crop folded into the composition.
- **Post-capture:** floating HUD (copy, copy-path, save, reveal, drag-out, dismiss);
  after-capture behaviours in settings (auto-save, auto-copy, open-in-editor).
- **Pin:** pin-to-screen from last capture / library; save, copy, close, right-click menu.
- **Recording:** region / fullscreen; system + mic audio (live mute); webcam bubble (live
  toggle); **Recording FX** (click ripples, keystrokes, cursor spotlight, cursor style);
  pause/resume with segment concat; post-recording HUD; trim window.
- **OCR (Capture Text):** live text capture; extract from a library image or the last
  capture; region OCR; review panel; copy (Tesseract, local).
- **Library:** grid, search, filter by kind (all / screenshots / recordings).
- **Settings:** General, Appearance (theme + accent), Capture, Auto-save, Storage, Hotkeys
  (5 configurable), Recording.
- **Shell:** tray (Capture/Record submenus, Settings, Quit); 5 global hotkeys; Explorer
  "Open in Glint" verb (self-healing, HKCU-only); single-instance file open.

---

## Out of scope (project-wide — do not add)

Cloud / upload / share links, teams/collaboration, login/auth, any web backend or network
call, scrolling capture, GIF recording/export, AI/LLM features, QR/barcode scanning.

---

## A. Annotation editor — workflow

Shortcuts, undo/redo, delete, and Ctrl+S already exist. The remaining gaps are the
"power-user" interactions that make CleanShot feel fast.

| # | Item | Why (CleanShot parity) | Effort | Impact |
|---|------|------------------------|--------|--------|
| A1 | **Duplicate** (Ctrl+D) selected annotation | Core editing gesture; missing today | S | ★★ |
| A2 | **Copy / cut / paste** annotations (in-doc) | Expected; pairs with A1 | S | ★★ |
| A3 | **Multi-select** + group move / delete / duplicate (shift-click + marquee) | Today only one `selectedId`; group ops are a big ergonomics jump | M | ★★★ |
| A4 | **Arrow-key nudge** (1px / 10px with Shift) for selection | Precision placement | S | ★★ |
| A5 | **Z-order controls** — bring forward / send back | Only creation order today | S | ★★ |
| A6 | **Per-tool style memory** (red arrow → next arrow red, not next rect) | Single shared `style` today; CleanShot remembers per tool | S | ★★ |
| A7 | **Select-all / deselect / escape** conventions | Minor completeness | S | ★ |

## B. Annotation editor — tool depth

The model carries only `{color, strokeWidth, fontSize}`. Adding a few style fields unlocks
most of CleanShot's look.

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| B1 | **Fill + fill opacity** for rect / ellipse (currently stroke-only) | Most-noticed shape gap | M | ★★★ |
| B2 | **Dashed / dotted stroke** styles | Common annotation style | S | ★★ |
| B3 | **Arrowhead styles** (size, filled/outline, start/end) | Arrows are the #1 tool | S | ★★ |
| B4 | **Drop-shadow** on annotations | Legibility over busy backgrounds | S | ★ |
| B5 | **Text callouts** — bold/weight, filled text background, font family, alignment | Text tool is bare today | M | ★★★ |
| B6 | **Richer colour control** — palette + custom picker + recent colours | `palette.ts` exists to build on | M | ★★ |
| B7 | **Counter/step styling** — colour, filled vs outline | Polish for the step tool | S | ★ |
| B8 | **Line/arrow constrain** to 45° with Shift while drawing | Expected precision behaviour | S | ★★ |

## C. Presentation — backgrounds & frame

The frame system is strong. These are the visible CleanShot signatures still missing.

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| C1 | **Window-frame chrome** — wrap the shot in a fake macOS / Windows / browser window (title bar, traffic lights, URL bar) | Arguably CleanShot's most recognizable look | L | ★★★ |
| C2 | **Custom solid-colour picker** for background | Presets only today | S | ★★ |
| C3 | **Custom gradient** (pick stops + angle) | Complements the 16 presets | M | ★ |
| C4 | **Image / wallpaper backgrounds** (local files) | CleanShot desktop-wallpaper look; must stay local | M | ★★ |
| C5 | **Auto-balance / inset controls** (asymmetric padding, position) | Fine framing control | S | ★ |

## D. Capture flow

Already close to CleanShot. Gaps are small, discrete additions.

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| D1 | **Standalone colour picker** action (eyedropper that copies hex; loupe UI already exists) | The loupe shows hex only mid-selection; a dedicated picker is a CleanShot staple | S | ★★ |
| D2 | **Self-timer / capture delay** (e.g. 3s / 5s) | Capture transient UI (menus, hovers) | S | ★★ |
| D3 | **Repeat last region** ("capture same area again") | Frequent workflow | S | ★★ |
| D4 | **Freeze-screen toggle** for area capture (already frozen — expose as an option?) | Parity with CleanShot's freeze setting | S | ★ |
| D5 | **Multi-monitor selection niceties** (verify current behaviour; per-monitor loupe/scale) | Ensure correctness on mixed-DPI setups | M | ★★ |

## E. Post-capture experience

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| E1 | **Quick Access Overlay** — a small corner tray that *accumulates* recent captures to act on later (annotate / copy / drag / pin / delete), instead of one HUD at a time | Signature CleanShot workflow; the single biggest post-capture gap | L | ★★★ |
| E2 | **After-capture destination config** (extend existing auto-save/copy/open with "pin", "annotate", "OCR") | Build on settings that already exist | S | ★★ |
| E3 | **HUD: quick-annotate button** straight to editor | Shortens the common path | S | ★★ |

## F. Pin to screen

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| F1 | **Opacity control** on a pin | CleanShot pins fade to reference | S | ★★ |
| F2 | **Click-through toggle** | Use a pin as an overlay reference while working | S | ★★ |
| F3 | **Resize** a pin (scale the floating image) | Expected | S | ★ |

## G. Recording & trim

FX, audio, webcam, trim all exist. Remaining are quality/config items (some already
tracked as deferred recorder follow-ups).

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| G1 | **Export quality / resolution options** (downscale, target size) | Shareable file sizes | M | ★★ |
| G2 | **Codec / fps settings** (H.265/AV1, true 60 fps via `ddagrab`) *(deferred)* | Already parked | L | ★ |
| G3 | **Webcam device picker** *(deferred)* | Multiple cameras | S | ★ |
| G4 | **Mic RAW capture** for fuller voice *(deferred)* | Voice quality | M | ★ |
| G5 | **Independent webcam layer** — reposition/resize/remove webcam *after* recording *(deferred; needs a separate webcam track — big change)* | CleanShot-style post-edit | L | ★★ |
| G6 | **Trim follow-ups** — clip reordering, redo, audio waveform, fades/speed *(deferred)* | Deepen the trim editor | M | ★ |
| G7 | **Configurable countdown length** (0 / 3 / custom) | Some users want no countdown | S | ★ |

## H. OCR

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| H1 | **Language selection** (Tesseract supports many packs) | Non-English capture | S | ★ |
| H2 | **Preserve layout / columns** option | Better paste fidelity | M | ★ |

## I. Library

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| I1 | **Favorites / star** + a favorites filter | Fast recall | S | ★★ |
| I2 | **Sort options** (date / size / kind) | Only implicit order today | S | ★ |
| I3 | **Bulk select + delete / drag** | Housekeeping at scale | M | ★★ |
| I4 | **Quick-look preview** (space to preview large) | Faster browsing | M | ★ |
| I5 | **Rename** a capture (display name; file stays) | Organisation | S | ★ |

## J. Settings & hotkeys

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| J1 | **More hotkeys** — Capture Text, Pin last, Stop recording, Repeat-last-region, colour picker | Only 5 today; several actions have no hotkey | S | ★★ |
| J2 | **Quick-actions / after-capture config UI** | Surface E2 in settings | S | ★★ |
| J3 | **Per-tool default styles** settings (pairs with A6) | Consistent look | S | ★ |

## K. Cross-cutting (product polish)

| # | Item | Why | Effort | Impact |
|---|------|-----|--------|--------|
| K1 | **Installer + auto-update** (local/self-hosted update, no accounts) | Distribution; must avoid cloud-account coupling | L | ★★ |
| K2 | **First-run onboarding** (grant permissions, set hotkeys, quick tour) | Adoption | M | ★ |
| K3 | **Accessibility pass** (focus order, ARIA, contrast on overlays) | Quality baseline | M | ★ |
| K4 | **Performance pass** (capture-open latency, editor with many annotations, large-image memory) | Snappiness | M | ★★ |

---

## Suggested sequencing (most CleanShot-feel first)

1. **Editor depth & workflow** (B1–B5, A1–A6) — touches every annotation session; the
   clearest quality jump. *One phase.*
2. **Presentation** (C1 window-frame chrome, C2–C4 backgrounds) — the most *visible*
   CleanShot signature. *One phase.*
3. **Quick Access Overlay** (E1, E2) — signature post-capture workflow; a larger,
   standalone piece. *One phase.*
4. **Smaller wins, batched** — D1 colour picker, D2 timer, D3 repeat-region, F1–F3 pin
   controls, I1/I3 library favorites + bulk, J1 hotkeys. *One phase, or folded into slack.*
5. **Recording/trim depth** (G1, G5, G6) and **cross-cutting** (K1 installer, K4 perf) as
   capacity allows.

## Quick wins (high impact ÷ effort — good slack-time picks)

A1 duplicate · A4 nudge · A6 per-tool style memory · B2 dashed · B3 arrowheads · B8 45°
constrain · C2 custom bg colour · D1 colour picker · D3 repeat-last-region · F1/F2 pin
opacity + click-through · I1 favorites · J1 more hotkeys.
