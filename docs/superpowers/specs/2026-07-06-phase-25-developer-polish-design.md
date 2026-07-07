# Phase 25 — Developer Polish (Design Spec)

**Date:** 2026-07-06
**Base branch:** `master` (feature branch: `phase-25-developer-polish`)
**Status:** Approved for planning

## Purpose

Glint is at near-parity with CleanShot X. This phase adds four focused,
low-risk features chosen specifically for a **developer-oriented** screenshot/
recording tool — things a developer reaches for when capturing code, errors,
and UI, and when sharing repros into PRs, issues, and chat.

Explicitly **out of scope** (decided, not deferred): GIF export, scrolling
capture, cloud upload / share links. These do not fit a local-first developer
workflow or have a poor effort-to-value ratio on Windows.

## Features

### 1. Redact tool (editor) — solid + pixelate

Obscure sensitive content (API keys, tokens, `.env` values, credentials,
customer data) before pasting a screenshot into a PR/issue/chat.

- **Model:** new `ToolId` `"redact"`. A box annotation shaped like the existing
  blur `BoxAnno`. New style field `redactStyle: "solid" | "pixelate"`, default
  `"solid"`.
- **Render:**
  - *Solid* → an opaque Konva `Rect` (default black; recolorable via the
    existing `color` style). The underlying pixels are **not** present in the
    exported image — true, non-recoverable redaction. This is the primary,
    secure default.
  - *Pixelate* → mirrors the existing `BlurRegion` implementation exactly
    (`AnnotationNode.tsx`): a cached copy of the base image clipped to the rect,
    with `Konva.Filters.Pixelate` and a chunky `pixelSize` (~12–16) instead of
    `Konva.Filters.Blur`.
- **UI:** new tool-rail button (icon: `EyeOff` or `SquareAsterisk`), keyboard
  shortcut **K**. When a redact shape is selected, the inspector shows a
  `Solid ⁄ Pixelate` segmented toggle.
- **Export:** bakes through the existing Konva-stage flatten (same path blur
  uses). **No backend change.**

### 2. Delayed capture (self-timer) — area, window, fullscreen

Capture transient UI that vanishes when the capture overlay steals focus —
hover states, tooltips, open dropdowns, right-click menus.

- **Trigger:** three new **hotkey actions** — `capture_area_delayed`,
  `capture_window_delayed`, `capture_fullscreen_delayed` — registered alongside
  the existing capture hotkeys. Normal (instant) captures are unchanged. The
  delayed variants are optional bindings (may ship unbound by default).
- **Duration:** one shared setting `capture_delay_secs` (default **5**; options
  3 / 5 / 10) in Settings → Capture. All three delayed actions read it.
- **Flow:** hotkey → show an on-screen countdown (reuse the recorder
  `Countdown` component pattern — non-focus-stealing, visible feedback per the
  project's always-visible rule) → on zero, run the normal capture `begin` for
  the chosen mode. The mode is already a parameter of the capture launch, so the
  countdown + delayed-begin logic is written once and parameterized by mode.
- **Non-goal:** none within delayed capture — all three modes are in scope.

### 3. Video resolution + quality presets (recording)

Keep recordings under issue-tracker upload limits (GitHub ~10–25 MB) without an
external re-encode.

- **Settings (Settings → Recording), two independent dropdowns:**
  - `record_resolution`: **Original / 1080p / 720p**. Non-Original adds an
    encoder-independent `scale=-2:1080` (or `720`) ffmpeg filter. Original adds
    no filter.
  - `record_quality`: **High / Medium / Low**. Maps to a **per-encoder quality
    flag**, because Glint selects the encoder at runtime (NVENC → QSV → AMF →
    libx264):
    - libx264 → `-crf`
    - NVENC → `-cq`
    - QSV → `-global_quality`
    - AMF → `-qp`
    The mapping is a small pure function: `(encoder, quality) -> flag+value`,
    table-tested across all four encoders.
- **Backend:** thread both settings through the ffmpeg argument builder in
  `recorder/`. Entirely within recorder isolation — no coupling to
  capture/editor/overlay/ocr.

### 4. Spotlight tool (editor) — rect + ellipse, single region

Dim the whole screenshot except one focused region — "look at this UI element /
this line / this config row" for docs and PR screenshots.

- **Model:** new `ToolId` `"spotlight"`. A box annotation with:
  - `region: "rect" | "ellipse"` (default `"rect"`).
  - dim strength via the existing `fillOpacity` style (default ~0.6).
- **Render:** a full-canvas semi-opaque black layer covering
  `baseWidth × baseHeight`, with the focus region punched out via a
  `globalCompositeOperation: "destination-out"` shape inside the group — a
  `Rect` or an `Ellipse` per `region`. Everything outside dims; the region stays
  bright.
- **UI:** tool-rail button (icon: `Focus`), keyboard shortcut **F**. Inspector
  exposes a shape toggle (`Rect ⁄ Ellipse`) and the dim slider (reusing the
  fill-opacity control).
- **Single region** is the design. Stacking two spotlights is a rare edge that
  simply double-draws (double-dim) — acceptable and not specially handled.
- **Export:** bakes through the existing flatten. **No backend change.**

## Deferred (next phase base): multi-region spotlight

Multiple simultaneous bright regions is **not** included here because it breaks
the uniform per-annotation render model: independent per-annotation dim layers
conflict (one region's bright hole gets re-dimmed by another's overlay, and dim
stacks to double-dark). The correct implementation needs **one shared dim layer
that punches all holes at once**, plus custom hit-testing to select/drag/delete
an individual hole.

**Documented clean path for the follow-up phase:** model a single `spotlight`
annotation that holds an **array of regions** → renders as one dim layer with N
cutouts (one node in the annotation loop, preserving render isolation). The only
real work is the interaction layer (adding/moving/removing individual regions
and their resize handles). This spec's single-region `spotlight` model is
forward-compatible with that (a one-element region array).

## Architecture notes

- **Editor tools (1, 4):** pure frontend. New `ToolId`s + annotation
  fields in `src/editor/model.ts`, render nodes in
  `src/views/editor/AnnotationNode.tsx` (siblings of `BlurRegion`), tool-rail
  entries in `ToolRail.tsx`, inspector controls, and draft-draw wiring in
  `EditorStage.tsx`. Both bake via the existing stage flatten — no Rust changes.
- **Delayed capture (2):** new hotkey actions + one setting; countdown →
  existing capture `begin(mode)`. Touches the hotkey registry, Settings →
  Capture UI, and the capture launch path. Lives in `capture/` + `settings/`;
  no editor/recorder coupling.
- **Video presets (3):** two settings + ffmpeg arg builder changes, fully
  inside `recorder/`. Respects recorder isolation (recorder imports nothing from
  capture/editor/overlay/ocr).

## Testing

- **Frontend unit (vitest):**
  - redact: `redactStyle` default `"solid"`; toggle solid↔pixelate.
  - spotlight: `region` default `"rect"`; shape toggle; default dim opacity.
  - settings: `capture_delay_secs` round-trips (default 5); `record_resolution`
    and `record_quality` round-trip.
  - quality→encoder-flag mapping: pure function, table-tested across
    libx264/NVENC/QSV/AMF × High/Medium/Low.
  - resolution→scale-filter arg (Original = no filter; 1080p/720p correct).
- **Rust (cargo test):** ffmpeg arg builder emits the correct `scale` filter and
  per-encoder quality flag for each resolution/quality/encoder combination.
- **Manual at-screen acceptance:** redact (solid hides pixels in export;
  pixelate looks right), delayed capture for all three modes with countdown,
  recording honors resolution/quality, spotlight rect + ellipse with adjustable
  dim.

## Green gate (must pass before merge)

- From `glint/src-tauri`: `cargo clippy --all-targets` (0 warnings) + `cargo test`
- From `glint`: `npx tsc --noEmit` + `npx vitest run`
- Merge into `master` with `--no-ff` after at-screen acceptance.

## Defaults chosen (adjustable)

- Editor shortcuts: **K** (redact), **F** (spotlight).
- Default capture delay: **5s** (options 3 / 5 / 10).
- Solid redact default color: **black**. Pixelate `pixelSize` ~12–16.
- Spotlight default dim opacity ~0.6.
