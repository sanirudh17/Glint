# Glint — Phase 13: Window-frame chrome (design)

**Date:** 2026-07-02
**Branch:** `phase-13-window-chrome` (merges to `master`)
**Status:** approved design → implementation plan next

## Goal

Wrap the framed screenshot in a fake application window — the CleanShot-style
"designed mockup" look, but **OS-neutral** (no macOS traffic lights, no Windows
caption buttons). Two chrome styles:

- **Window** — a clean title bar with an optional centered title, **no buttons**.
- **Browser** — a title bar rendered as an address bar: a lock glyph + editable
  URL in a rounded pill, with back/forward chevrons and a reload glyph.

Each in **light** and **dark**. Chrome is an extension of the existing frame
system: pure layout math in `composition.ts`, Konva rendering in
`EditorStage.tsx`, controls in `FramePanel.tsx`, persisted in the `.glint` doc
via `SerializedDoc.frame`.

## Binding constraints (unchanged)

- **Local-first:** no cloud, no upload, no accounts, no network. The URL field is
  cosmetic text only — nothing is fetched or validated against a network.
- **Single-user:** no auth of any kind.
- **Recorder isolation:** untouched. This phase is editor-only
  (`capture`/`editor` coupling already exists; `recorder`/`ocr` are not touched).

## Design rationale — why no window buttons

Window-frame beautifiers are a design/mockup convention (a picture frame), not a
claim about the host OS. The macOS traffic lights are the industry-standard look,
but for a Windows app they can read as counterintuitive, so this phase drops
**both** the macOS dots and the Windows caption buttons in favor of a clean,
button-less titled window. The Browser style keeps only affordances common to
every browser (address pill, back/forward, reload), which carry no OS association.

## Non-goals (explicitly out)

- **macOS traffic-light dots** and **Windows caption buttons** — dropped by
  design (see rationale). No window-control buttons of any kind.
- **Image / wallpaper backgrounds (C4)** — highest-impact leftover but not *easy*
  (file picker + path-vs-embed persistence decision). Headline for a follow-up
  presentation phase, not this one.
- **Custom gradient editor (C3)** — self-contained but low impact.
- **Inline-on-canvas editing** of the title/URL — edited in the side panel only.
- **A browser tab strip** — the Browser style is a single address-bar row, not a
  multi-tab chrome.

## Model

Add one field to `FrameConfig` (in `useEditorStore.ts`):

```ts
export interface WindowChrome {
  style: "none" | "window" | "browser";
  theme: "light" | "dark";
  title: string; // centered title text (Window style). Empty → no title drawn.
  url: string;   // address-bar text (Browser style). Empty → empty pill.
}

export interface FrameConfig {
  // …existing: enabled, background, padding, radius, shadow, aspect
  chrome: WindowChrome;
}
```

- `DEFAULT_FRAME.chrome = { style: "none", theme: "light", title: "", url: "" }`.
- `mergeFrame` defaults `chrome` for legacy docs that lack it (so old `.glint`
  files still hydrate): `chrome: { ...DEFAULT_FRAME.chrome, ...(f.chrome ?? {}) }`.
- `freshFrame()` deep-clones `chrome` so resets never share a reference.
- Chrome persists automatically: it's inside `frame`, which is already part of
  `SerializedDoc` and export.

### Auto-enable the frame

Selecting a chrome style (`window`/`browser`) while `frame.enabled === false`
also sets `enabled: true`. Rationale: chrome is part of the screenshot card; a
user who picks "Window" and sees nothing happen would be confused. Selecting
`none` leaves `enabled` as-is (does not turn the frame off).

### Smart default title (Window style)

When switching to the **Window** style with `title === ""`, prefill it with the
capture / project name (`projectName` if set, else a sensible fallback). Still
fully editable and clearable afterward. Implemented in the control handler (not
the model) so the pure model stays free of app state. The Browser style does not
use `title`.

## Layout math (`composition.ts`)

The chrome bar is a fixed-height band **above** the image, part of the same
rounded card. Add the layout-relevant field to `FrameLayoutInput` (theme/title/
url are visual-only and excluded):

```ts
export interface FrameLayoutInput {
  enabled: boolean;
  padding: number;
  radius: number;
  shadow: number;
  aspect: AspectId;
  chromeStyle: "none" | "window" | "browser"; // NEW
}
```

`Layout` gains one field:

```ts
export interface Layout {
  // …existing
  chromeH: number; // height of the chrome band above the image (0 when none)
}
```

Computation (only when `frame.enabled`):

- `barH = clamp(round(contentW * BAR_RATIO), BAR_MIN, BAR_MAX)` — a single bar
  row. Constants tuned at-screen (same way the shadow was), roughly
  `ratio ≈ 0.045`, `min ≈ 28`, `max ≈ 120` (px in composition space).
- `chromeH = 0` when `chromeStyle === "none"`, else `barH` (both Window and
  Browser are a single-row bar; they differ only in what is *drawn* in the bar,
  not its height).
- The **card** (the shadow-casting rounded rect that used to wrap just the image)
  now wraps `chromeH + contentH`:
  - card top-left = `(contentX, contentY - chromeH)`
  - card size = `contentW × (chromeH + contentH)`
- `contentY` (image top) is pushed **down** by `chromeH`; `compositionH` grows by
  `chromeH`; `compositionW` is unchanged (chrome adds height, not width).
  `paddingPx`, aspect handling, `contentX`, and crop are unchanged except they
  account for the taller card when centering / fitting an aspect.

Key invariant tested: with `chromeStyle === "none"` the output is
**byte-identical** to today (no regression to existing framed exports).

`exportPixelRatio` is unchanged — it already derives from `compositionW`
(unaffected) and the taller `compositionH` flows through automatically. Export
"just works."

## Rendering (`EditorStage.tsx`)

The screenshot "card" becomes **bar + image as one rounded rect**:

1. **Card background + shadow:** one rounded `Rect` at the card box
   `(contentX, contentY - chromeH, contentW, chromeH + contentH)` with
   `cornerRadius = r`, carrying the existing `shadowProps`. This replaces today's
   image-only shadow rect (which becomes the card rect when chrome is on; when
   chrome is off, `chromeH = 0`, so it's the same rect as today).
2. **Chrome band** (only when `chromeStyle !== "none"`), clipped to the card's
   rounded top corners:
   - **Bar fill:** light `#f6f6f6` / dark `#2b2b2b` (theme). A 1px divider line
     between bar and image (`#00000018` light / `#ffffff14` dark).
   - **Window style:** a centered `Konva.Text` title (system sans, `#3c3c3c`
     light / `#e6e6e6` dark). Skipped when `title === ""`. No buttons.
   - **Browser style:** back/forward chevrons `‹ ›` and a reload glyph (small
     Konva line/arc strokes, decorative) at the left, then a rounded **address
     pill** (light `#ffffff` / dark `#1e1e1e`) containing a small lock glyph and
     the `url` text (left-aligned, truncated to the pill width). No title, no
     dots.
3. **Image:** drawn as today but at the pushed-down `contentY`, clipped so only
   its **bottom** corners round (the top edge is square where it meets the bar).
   Implemented with a `roundedRectPath` variant that rounds only the bottom two
   corners; the card rect rounds all four (its rounded top is covered by the bar).

All chrome drawing lives in a small extracted renderer
(`glint/src/views/editor/WindowChrome.tsx`, returning Konva nodes) so
`EditorStage`'s already-long body doesn't absorb it. The annotation layer offset
(`offX/offY`) already derives from `contentX/contentY`, so annotations
automatically sit on the image (below the bar) with no extra work.

## Controls (`FramePanel.tsx`)

A new **"Window"** section:

- Segmented control **None / Window / Browser** (`chrome.style`). Selecting
  Window/Browser auto-enables the frame; selecting Window applies the smart-
  default title.
- **Light / Dark** segmented toggle (`chrome.theme`) — shown when style ≠ none.
- **Title** text input (`chrome.title`) — shown for the Window style.
- **URL** text input (`chrome.url`) — shown for the Browser style.

Reuses existing `frame-row` / `frame-seg` / `frame-label` styles; adds a small
`.frame-input` text-input style (mirroring `.editor-fontsize`). All writes go
through `setFrame({ chrome: { ...frame.chrome, ...patch } })` (chrome is live
tweak state like the rest of the frame — not in undo history). `resetFrame`
already restores `DEFAULT_FRAME`, clearing chrome.

## Testing

Pure-function unit tests (Vitest) in `composition.test.ts`:

- `chromeStyle: "none"` → layout byte-identical to the no-chrome baseline
  (regression guard).
- `window` → `chromeH === barH`; `contentY` shifted down by `chromeH`;
  `compositionH` grew by `chromeH`; `compositionW` unchanged.
- `browser` → same `chromeH === barH` as Window (single-row bar); layout math is
  identical to Window (they differ only in rendering).
- `barH` respects the clamp (tiny image hits `min`, huge image hits `max`).
- Frame **disabled** → `chromeH === 0` regardless of `chromeStyle`.

Store test (`useEditorStore.test.ts`):

- Selecting `window`/`browser` via the setter path auto-enables the frame.
- `mergeFrame` on a legacy doc without `chrome` yields `DEFAULT_FRAME.chrome`.
- `resetFrame` restores `chrome.style === "none"`.

Rendering is verified at-screen (Konva visuals aren't unit-tested), consistent
with the rest of the editor.

## Green gate + acceptance

- `npx tsc --noEmit` clean; `npx vitest run` all green.
- `cargo build` + `cargo test` green (no Rust changes expected, but the gate runs).
- Recorder/ocr isolation greps clean (untouched, verified).
- At-screen acceptance: Window + Browser, light + dark, title + URL; export a PNG
  and confirm chrome bakes in at native resolution; reopen a saved `.glint` and
  confirm chrome round-trips; confirm annotations land on the image (not the bar);
  confirm frame-off / chrome-none is visually unchanged from Phase 12.

## Files touched

- `glint/src/editor/composition.ts` — `chromeStyle` input, `chromeH` output, math.
- `glint/src/editor/composition.test.ts` — chrome layout tests.
- `glint/src/editor/useEditorStore.ts` — `WindowChrome` type, `chrome` field,
  defaults, `mergeFrame`, `freshFrame`, auto-enable in the setter path.
- `glint/src/editor/useEditorStore.test.ts` — auto-enable + merge + reset tests.
- `glint/src/views/editor/EditorStage.tsx` — card = bar+image; wire in chrome.
- `glint/src/views/editor/WindowChrome.tsx` — extracted Konva chrome renderer.
- `glint/src/views/editor/FramePanel.tsx` — Window controls section.
- `glint/src/views/editor/editor.css` — `.frame-input` (+ any chrome-control
  tweaks).

No Rust, no new window, no capability changes.
