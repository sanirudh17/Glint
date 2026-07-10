# Phase 29 — App-wide UI/UX pass

**Date:** 2026-07-10
**Status:** Design — pending user review
**Base branch:** `master` (per project convention; sub-phase branches `phase-29-*`)

## Overview

The last UI-focused phase before packaging. A visual + interaction pass across the
main-window surfaces, plus one functional correctness fix (library ↔ filesystem
delete-sync) and one editor capability (zoom/fit). Colours, fonts, and the overall
"ink-on-glass / instrument-grade" aesthetic (`tokens.css`) are **kept** — this is
about layout, structure, finish, and a few targeted additions.

**Guiding principle (from research + user direction): subtraction, not accretion.**
CleanShot X — the reference the user admires — has no dashboard at all; its only
"home" is a clean History grid. Praised tools (Captr, QuickShot) win by removing
chrome. So every screen here should feel *practical and minimal, never crowded*. No
stat tiles, no bento, no decorative panels.

## Non-goals

- No colour/type/token palette change (accent stays `#5B7CFA`, substrate stays
  near-black). No gradients/glow (existing rule holds).
- No annotator captures-history sidebar (explicitly declined — overlaps the Library,
  adds permanent chrome).
- No change to the floating-toolbar-vs-left-rail structure of the editor (the left
  rail suits Glint's 14 tools better than a horizontal float).
- No recorder-UI redesign beyond adopting the shared rounded-button radius.
- No packaging/distribution work (that is the following phase).

---

## 1. Design foundation — rounded buttons (`--r-btn`)

**Problem:** buttons across the app use `--r1` (4px), which reads sharp. The user
liked the 8px buttons in the approved dashboard mockup.

**Change:** add a single global token `--r-btn: 8px` in `tokens.css` (theme-independent
`:root`) and repoint every *rectangular pressable button* at it:

- `.g-btn` (Button primitive) — `ui.css:20`
- `.cap-btn` (Library/Home capture-card actions) — `library.css`
- `.editor-tool` and editor top-bar buttons (`.editor-export-btn`, Frame) — `editor.css`
- HUD action buttons — `hud.css`
- Recorder **control bar / video overlay** buttons + trim controls — `recorder.css`, `trim.css`
- Pin window buttons — `pin.css`

**Leave alone:** circular icon buttons (`border-radius:50%`), the 10px icon-button
variant (already rounded and consistent), window-control buttons (`.g-winctl-btn`,
their own small radius), inputs/cards/kbd (not buttons). Nav-rail items keep `--r2`.

**Rationale for one token:** a future tweak is a one-line change; consistency is
guaranteed. Tests: none (pure CSS); verify visually across surfaces.

---

## 2. Dashboard (Home) — Concept A "Quiet launcher"

Approved direction. Replaces today's four stacked sections (Quick-start row, Recent
grid, Recent-projects list, Shortcuts card) with a calm launcher.

**Structure (top → bottom):**

1. **New capture** — a `label` eyebrow ("New capture") + one row of actions:
   - `Capture Area` — **primary** (accent) button
   - `Window`, `Fullscreen`, `Record`, `Capture Text` — neutral/subtle buttons
   - `Open Project` — a **ghost** (borderless) button at the end of the row, visually
     secondary (it opens an existing `.glint`, not a capture).
2. **Recent** — a `label` eyebrow + `View all in Library →` link on the right, over a
   **responsive auto-fill grid** (`repeat(auto-fill, minmax(180px, 1fr))`) capped at
   the newest ~10 captures, filling roughly two rows on a normal window. Reuses the
   existing `CaptureCard`.
3. **Resume** — *conditional*: only rendered when `getRecentProjects()` returns ≥1. A
   small `label` eyebrow + up to 3 recent `.glint` projects as subtle inline chips
   (`↩ <name>`). Hidden entirely (no empty section) when there are none. Replaces the
   old full Recent-Projects list.

**Empty state (zero captures):** the New-capture actions stay at top; the Recent
region shows the existing `EmptyState` primitive centered ("No captures yet — your
screenshots and recordings will appear here.").

**Removed from Home:** the Keyboard-shortcuts card (shortcuts already live in
Settings → Hotkeys; Home shouldn't duplicate reference material). The
`parseHotkey`/`HOTKEY_*` code and the shortcuts `<section>` are deleted from
`HomeView.tsx`.

**Files:** `HomeView.tsx` (restructure JSX + drop shortcuts logic), `home.css`
(rework layout — actions row, responsive recent grid, resume chips, ghost button).
Data hooks (`listCaptures`, `getRecentProjects`, `capture-saved` listener) are reused
as-is; `RECENT_LIMIT` bumps to ~10.

**Tests:** none new (presentational). `tsc` + existing vitest must stay green.

---

## 3. Sidebar (NavRail) — expandable / collapsible

**Problem:** the rail is permanently icon-only (52px). The user wants it toggleable
with a button, animating in **one smooth horizontal motion**, not a jump.

**Behaviour:**
- A **toggle button** pinned at the **bottom** of the rail (chevron: `»` when
  collapsed → expand, `«` when expanded → collapse).
- Collapsed = today's 52px icon rail. Expanded = `--nav-w-expanded: 200px` showing
  `icon + label` per item (Home / Library / Settings).
- State persists in `localStorage` (`glint:nav-expanded`), read on mount so it
  survives reloads. Lives in the main window only (the shell).

**Animation (the crux — must be seamless, no reflow jank):**
- The rail's `width` transitions between `--nav-w` and `--nav-w-expanded` over
  `--dur-slow` (240ms) with `--ease`. Width is the single animated property → one
  continuous horizontal motion; the content area (`flex:1`) follows naturally.
- Labels are always in the DOM; they fade via `opacity` (0→1) + a small `translateX`,
  and `white-space:nowrap` + `overflow:hidden` on the item prevents text wrapping
  mid-animation (which is what causes the "jumping"). No `display:none` toggling
  (that snaps).
- Tooltips (`Tooltip` on each item) are **disabled when expanded** (label is visible)
  and enabled when collapsed.
- The active-item left-edge indicator bar keeps working in both states.

**Files:** `NavRail.tsx` (state, toggle button, render labels, conditional tooltip),
`shell.css` (`.g-nav-rail` width transition, expanded modifier, label styles,
toggle-button styles), `tokens.css` (`--nav-w-expanded`). Small local state or a tiny
`useNavExpanded` hook; no global store needed.

**Tests:** a pure unit test for the persistence helper (read/default/write) if it's
extracted; otherwise none (DOM/animation not unit-testable in node vitest).

---

## 4. Library — visual polish (look, not functionality)

Explicitly **look only**. Keep search + kind filter + grid + all card actions.

**Changes:** tighten the header/toolbar (search + Select) alignment and spacing;
refine the grid rhythm (consistent gaps, hover finish on cards); adopt `--r-btn` on
card action buttons; ensure the empty state is centered and calm; optional subtle
result count next to the "Library" eyebrow. No changes to `listCaptures`, filtering,
or `CaptureCard` behaviour.

**Files:** `library.css` (primary), `LibraryView.tsx` (only if markup tweaks are
needed for spacing/count). **Tests:** `search.ts` unit tests stay green; no new.

---

## 5. Settings — polish (discretion)

Structure is already sound (left vertical tabs + right panel). Keep it; refine finish.

**Changes:** consistent section spacing and vertical rhythm; refined active-tab
treatment on the left sub-nav; adopt `--r-btn` on buttons within panels; ensure
`Section`/`Field`/`Switch`/`Select` primitives read consistently. No new settings, no
restructure of `NAV_ITEMS` or panels.

**Files:** `settings.css` (primary), individual `settings/*.tsx` only for spacing
markup if needed. **Tests:** none new.

---

## 6. Library ↔ filesystem delete-sync (functional fix)

**Problem:** captures live in SQLite. When a file is deleted in Explorer/OS, the DB
row survives, so the Library still shows it; clicking any action errors "This file is
no longer on disk…" — clutter. The reverse (delete in Library → remove file) already
works (`capture_delete` calls `remove_file`), so only the OS→Library direction is broken.

**Fix — two layers:**

### 6a. Reconcile-on-load (guaranteed baseline, no new dependency)
`captures_list` becomes `#[tauri::command(async)]` and reconciles before returning:
1. Read rows under the DB lock (as today), then **release the lock**.
2. Off-lock, `std::path::Path::exists()` each row's `path`; collect the ids whose file
   is gone.
3. Re-take the lock, `soft_delete` each missing id (reuse existing `soft_delete`).
4. Return only the survivors (respecting `limit`).

Cost: one `stat` per row, off-lock, async — a few ms for a large library, trivial for
Home's ~10. This guarantees ghost rows never appear once the Library/Home mounts or
re-fetches (both already reload on the `capture-saved` event).

### 6b. Live filesystem watcher (completeness for an already-open Library)
Add the `notify` crate. On app setup, spawn a debounced recursive watcher on the
captures directory (from settings/`paths`). On a remove/rename-away event for a file
that matches a live capture row: `soft_delete` it and `emit`/`emit_to` a
`capture-saved` (or new `captures-changed`) event so open Library/Home windows refresh
live — consistent with Glint's "immediate visible feedback" rule. Watcher runs on its
own thread; errors are logged, non-fatal.

**Decision:** ship **6a** as the core fix (fully resolves the reported bug on
load/refresh with zero new deps); ship **6b** for live updates while a window is open.
If the `notify` dependency proves fussy at build time, 6a alone still closes the bug
and 6b can be deferred.

**Files:** `capture/commands.rs` (`captures_list` async + reconcile helper), possibly
a new `capture/watch.rs` (watcher), `lib.rs` (spawn watcher in setup), `Cargo.toml`
(`notify`). Frontend unchanged (already listens for the refresh event).

**Tests:** rusqlite unit test — insert rows, point some paths at nonexistent files,
run the reconcile helper, assert missing rows are soft-deleted and survivors returned.
Watcher is integration-only (manual verification).

---

## 7. Annotator — zoom/fit + toolbar polish

Approved scope: **add zoom/fit**, **polish toolbar visuals**. Layout unchanged (left
rail + top bar). No captures sidebar.

### 7a. Zoom / fit / pan
- Stage `scale` + `position` state (local to `EditorStage` or in `useEditorStore`).
- **Scroll-to-zoom** centered on the cursor; **pan** by drag while zoomed (space-drag
  or middle-mouse — space-drag is standard and keyboard-discoverable).
- **Zoom control UI** at the bottom-right of the canvas: `−  <pct>%  +  · Fit · 100%`,
  matching the references' `86% / Fit / 100%`. Adopt `--r-btn`.
- **Keyboard:** `Ctrl +` / `Ctrl -` zoom, `Ctrl 0` = Fit-to-window, `Ctrl 1` = 100%.
  Wire into the existing `EditorView` keydown handler (respect its text-entry guard).
- **Correctness (the risk):** all drawing/hit math must go through
  `stage.getRelativePointerPosition()` (already scale/position-aware) so annotations
  land under the cursor at any zoom. Audit `EditorStage` pointer handlers; if any use
  raw `getPointerPosition()`, convert them. Selection/transform handles must remain
  correct under scale. This is the one part warranting a careful review pass.

### 7b. Toolbar polish
- Tool rail: consistent spacing, clearer active state, `--r-btn` on the (rectangular)
  tool buttons, tidy separator + undo/redo/clear grouping.
- Top bar (`ProjectBar` / `StyleBar` / Frame / `ExportBar`): align heights, spacing,
  and rounded buttons for a cohesive strip.

**Files:** `EditorStage.tsx` (scale/pan + pointer audit), a new
`editor/ZoomControl.tsx`, `EditorView.tsx` (zoom keybinds), `editor.css` (zoom control
+ toolbar polish), `ToolRail.tsx`/`StyleBar`/`ExportBar` (visual only). **Tests:** a
pure unit test for the zoom-math helper (clamp, zoom-at-point, fit calc) if extracted.

---

## Suggested sequencing (each a `phase-29-*` branch → `--no-ff` merge into `master`)

Ordered low-risk → high-risk, each independently shippable and at-screen verifiable:

1. **29a — Foundations + Dashboard:** `--r-btn` token + app-wide button roundness, then
   Home → Concept A. (Visual, self-contained, immediately visible.)
2. **29b — Sidebar expand/collapse.** (Isolated interaction + animation.)
3. **29c — Library + Settings polish.** (Pure CSS finish.)
4. **29d — Delete-sync** (reconcile-on-load, then watcher). (Functional; own tests.)
5. **29e — Annotator zoom/fit + toolbar polish.** (Most technical; reviewer pass on the
   pointer/scale math per the review-cadence preference.)

Each sub-phase ends with the green gate before merge.

## Green gate (every sub-phase)

- From `glint/`: `npx tsc --noEmit` and `npx vitest run`.
- From `glint/src-tauri/`: `cargo clippy --all-targets` and `cargo test` (29d especially).
- At-screen acceptance by the user before each `--no-ff` merge.

## Risks

- **Zoom pointer math (7a)** — the real risk; a missed raw-pointer call makes
  annotations land off-cursor when zoomed. Mitigation: audit every pointer handler,
  extract + unit-test the transform helper, reviewer subagent on this sub-phase only.
- **Sidebar animation jank (3)** — animating anything but `width` (or toggling
  `display`) causes the "jump". Mitigation: animate `width` only; fade labels via
  opacity; `nowrap`.
- **`notify` watcher (6b)** — new native dependency; could be noisy or platform-fussy.
  Mitigation: 6a is the standalone fix; 6b is additive and deferrable.
- **Reconcile perf (6a)** — stat-per-row. Mitigation: off-lock + async; negligible at
  realistic library sizes.
