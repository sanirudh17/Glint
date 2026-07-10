# Phase 29a — Foundations + Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one app-wide rounded-button radius token and rebuild the Home dashboard as Concept A ("Quiet launcher").

**Architecture:** A new theme-independent token `--r-btn: 8px` is added to `tokens.css`; every rectangular pressable button selector is repointed at it (inputs, kbd chips, focus rings, window controls, circular icon buttons, and nav-rail items are intentionally left alone). `HomeView.tsx` is restructured from four stacked sections into a minimal launcher: a New-capture action row, a responsive Recent grid, and a conditional Resume row; the Keyboard-shortcuts card is removed.

**Tech Stack:** React 19 + TypeScript, Zustand, react-router (hash), Vite, CSS custom properties (`tokens.css`). No new dependencies.

## Global Constraints

- Base branch is `master`; this sub-phase branches `phase-29a-foundations-dashboard` and merges back with `--no-ff` only after at-screen acceptance.
- Every commit ends with the trailer, verbatim:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BUYynfpbqZNBgeaPHcGKri
  ```
- No colour/type/palette change. Accent stays `#5B7CFA`. No gradients/glow.
- All radii/spacing/colours come from `tokens.css` variables — never hardcode.
- Green gate before merge: from `glint/` run `npx tsc --noEmit` and `npx vitest run`.
- Aesthetic: minimal, uncrowded, "ink-on-glass". Home ≠ Library (no giant grid, no stats).

---

### Task 1: Add `--r-btn` token and round the Button primitive

**Files:**
- Modify: `glint/src/styles/tokens.css` (add token in the theme-independent `:root` block, near the other radii `--r1..--r3`)
- Modify: `glint/src/components/ui/ui.css:20` (`.g-btn` radius)

**Interfaces:**
- Produces: CSS variable `--r-btn` (value `8px`), consumed by all later button edits.

- [ ] **Step 1: Add the token.** In `tokens.css`, immediately after the `--r3: 12px;` line inside `:root`, add:

```css
  /* Button radius — rounded-rectangle, applied to all pressable buttons */
  --r-btn: 8px;
```

- [ ] **Step 2: Repoint the Button primitive.** In `ui.css`, change the `.g-btn` rule's `border-radius: var(--r1);` (line ~20) to:

```css
  border-radius: var(--r-btn);
```

- [ ] **Step 3: Verify build.** Run from `glint/`: `npx tsc --noEmit` → Expected: no errors. (CSS is not type-checked; this confirms nothing else broke.)

- [ ] **Step 4: Commit.**

```bash
git add glint/src/styles/tokens.css glint/src/components/ui/ui.css
git commit -m "feat(p29a): add --r-btn token, round Button primitive"
# (append the required trailer)
```

---

### Task 2: Sweep remaining button surfaces to `--r-btn`

Repoint every *rectangular pressable button* that still uses `--r1`. **Only buttons.**
Leave inputs, kbd chips, `:focus-visible` ring (`global.css`), window controls
(`.g-winctl-btn`, `shell.css`), nav-rail items (`.g-nav-item`, keep `--r2`), and any
`border-radius:50%` circular icon button untouched.

**Files & exact selectors to change (`var(--r1)` → `var(--r-btn)`):**
- `glint/src/views/library.css` — `.cap-btn` (the card action buttons, ~line 231). **Do NOT** change `.library-search` (input, ~69) or the segmented `Select` container (~216).
- `glint/src/views/editor/editor.css` — the toolbar buttons at ~line 76 and ~86, `.editor-fontsize` is an input (leave), `.editor-tool` (~104), `.editor-export-btn` (~160), and the frame button at ~342 (verify it's a button, not the swatch container). Leave the cheatsheet/panel containers (~217, ~282, ~307, ~369) and `.frame-input` (~335).
- `glint/src/hud/hud.css` — HUD action buttons (grep for the action-button class; repoint its radius).
- `glint/src/recorder/recorder.css` and `glint/src/recorder/trim.css` — the control-bar / video-overlay / trim control **buttons** (grep for button selectors; leave inputs/sliders/containers).
- `glint/src/pin/pin.css` — the pin window action buttons.

- [ ] **Step 1: Audit each file.** For each file above, open it and identify which `--r1` usages are `<button>`-like controls vs inputs/containers. Change only the button selectors' `border-radius: var(--r1);` to `var(--r-btn);`. Use the "leave alone" list above as the guard.

- [ ] **Step 2: Verify build.** From `glint/`: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 3: Visual check.** Launch the app; confirm buttons on Home, Library cards, HUD, recorder bar, and pin window now show rounded (8px) corners while inputs/search fields and the traffic-light window controls are unchanged.

- [ ] **Step 4: Commit.**

```bash
git add glint/src/views/library.css glint/src/views/editor/editor.css glint/src/hud/hud.css glint/src/recorder/recorder.css glint/src/recorder/trim.css glint/src/pin/pin.css
git commit -m "feat(p29a): round all button surfaces app-wide (--r-btn)"
# (append the required trailer)
```

---

### Task 3: Rebuild `HomeView` as Concept A

**Files:**
- Modify (replace): `glint/src/views/HomeView.tsx`
- Modify (rework): `glint/src/views/home.css`

**Interfaces:**
- Consumes: `startCapture` (`lib/captureIpc`), `captureText` (`lib/ocr`), `invoke("recorder_open_region_selector")`, `listCaptures(limit)` → `CaptureItem[]` (`lib/captures`), `getRecentProjects()` → `RecentProject[]`, `openProject`, `pickOpenPath`, `pushRecentProject` (`lib/editor`), `CaptureCard`, `Button`, `EmptyState`, `useAppStore.pushToast`, `useNavigate` (react-router).
- Produces: the Home route UI. No new exports.

- [ ] **Step 1: Replace `HomeView.tsx`** with the Concept A structure:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Crop, AppWindow, Monitor, Video, ImageOff, FolderOpen, ScanText, RotateCcw, ArrowRight } from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { startCapture } from "../lib/captureIpc";
import { captureText } from "../lib/ocr";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { getRecentProjects, openProject, pickOpenPath, pushRecentProject, type RecentProject } from "../lib/editor";
import { CaptureCard } from "./library/CaptureCard";
import "./home.css";

/** Recent captures previewed on the dashboard (newest first). */
const RECENT_LIMIT = 10;
/** Recent .glint projects offered in the conditional Resume row. */
const RESUME_LIMIT = 3;

export default function HomeView() {
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();

  // Recent captures — newest first, capped.
  const [recent, setRecent] = useState<CaptureItem[]>([]);
  const reloadRecent = useCallback(() => {
    listCaptures(RECENT_LIMIT).then(setRecent).catch(() => setRecent([]));
  }, []);
  useEffect(() => { reloadRecent(); }, [reloadRecent]);
  useEffect(() => {
    const p = listen("capture-saved", () => reloadRecent());
    return () => { p.then((un) => un()); };
  }, [reloadRecent]);

  // Recent projects — drives the conditional Resume row.
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const reloadProjects = useCallback(() => {
    getRecentProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => { reloadProjects(); }, [reloadProjects]);

  const onOpenProject = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try { await openProject(path); await pushRecentProject(path); }
    catch { pushToast("Couldn't open the project"); }
  }, [pushToast]);

  const onOpenRecent = useCallback(async (p: RecentProject) => {
    if (!p.exists) { pushToast("That project file is no longer on disk"); reloadProjects(); return; }
    try { await openProject(p.path); await pushRecentProject(p.path); }
    catch { pushToast("Couldn't open the project"); }
  }, [pushToast, reloadProjects]);

  // Not-yet-built tray actions still emit "tray-action" (e.g. some record paths).
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      const msg: Record<string, string> = { record: "Recording arrives in a later phase" };
      pushToast(msg[event.payload] ?? "That action arrives in a later phase");
    });
    return () => { unlisten.then((f) => f()); };
  }, [pushToast]);

  const resumable = projects.slice(0, RESUME_LIMIT);

  return (
    <div className="home-view">
      {/* ── New capture ─────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="nc-label">
        <span className="label home-eyebrow" id="nc-label">New capture</span>
        <div className="home-actions">
          <Button variant="primary" size="md" icon={Crop} onClick={() => startCapture("area")}>Capture Area</Button>
          <Button variant="subtle" size="md" icon={AppWindow} onClick={() => startCapture("window")}>Window</Button>
          <Button variant="subtle" size="md" icon={Monitor} onClick={() => startCapture("fullscreen")}>Fullscreen</Button>
          <Button variant="subtle" size="md" icon={Video} onClick={() => invoke("recorder_open_region_selector")}>Record</Button>
          <Button variant="subtle" size="md" icon={ScanText} onClick={() => captureText()}>Capture Text</Button>
          <Button variant="ghost" size="md" icon={FolderOpen} onClick={onOpenProject}>Open Project</Button>
        </div>
      </section>

      {/* ── Recent ──────────────────────────────────────────── */}
      <section className="home-section home-section--grow" aria-labelledby="rc-label">
        <div className="home-rowhead">
          <span className="label home-eyebrow" id="rc-label">Recent</span>
          {recent.length > 0 && (
            <button className="home-viewall" onClick={() => navigate("/library")}>
              View all in Library <ArrowRight size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="home-empty-wrap">
            <EmptyState icon={ImageOff} title="No captures yet" hint="Your screenshots and recordings will appear here." />
          </div>
        ) : (
          <div className="home-recent-grid" role="list" aria-label="Recent captures">
            {recent.map((c) => (<CaptureCard key={c.id} item={c} onChanged={reloadRecent} />))}
          </div>
        )}
      </section>

      {/* ── Resume (conditional) ────────────────────────────── */}
      {resumable.length > 0 && (
        <section className="home-section" aria-labelledby="rs-label">
          <span className="label home-eyebrow" id="rs-label">Resume</span>
          <div className="home-resume" role="list">
            {resumable.map((p) => (
              <button
                key={p.path}
                className={`home-resume-chip${p.exists ? "" : " home-resume-chip--stale"}`}
                onClick={() => onOpenRecent(p)}
                title={p.exists ? p.path : `${p.path} (missing)`}
              >
                <RotateCcw size={14} strokeWidth={1.75} />
                <span className="home-resume-name">{p.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rework `home.css`.** Replace the file's contents with the Concept A layout below (keeps `.home-view`, `.home-section`, `.home-section--grow`, `.home-recent-grid`, `.home-empty-wrap`; adds `.home-eyebrow`, `.home-actions`, `.home-rowhead`, `.home-viewall`, `.home-resume*`; drops the hotkey/kbd/project styles):

```css
/*
 * Glint — Home view (Concept A "Quiet launcher")
 * Minimal, uncrowded. All values from tokens.css.
 */

.home-view {
  display: flex;
  flex-direction: column;
  gap: var(--s6);
  padding: var(--s7);
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.home-section { display: flex; flex-direction: column; gap: var(--s4); }
.home-section--grow { flex: 1 0 auto; }

/* Eyebrow — mono uppercase label (see .label in global.css). No hairline rule. */
.home-eyebrow { display: block; }

/* New-capture action row */
.home-actions { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }

/* Recent header row: eyebrow left, View-all link right */
.home-rowhead { display: flex; align-items: center; justify-content: space-between; }
.home-viewall {
  display: inline-flex; align-items: center; gap: var(--s1);
  border: none; background: transparent; cursor: pointer;
  color: var(--accent); font-size: var(--fz-sm); font-weight: var(--fw-medium);
  padding: 0; transition: color var(--dur) var(--ease);
}
.home-viewall:hover { color: var(--accent-hover); }

/* Recent grid — responsive auto-fill, ~two rows on a normal window */
.home-recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--s4);
  align-content: start;
}

/* Empty state wrapper — centered in the grow region */
.home-empty-wrap {
  flex: 1; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: var(--r2); min-height: 160px;
}

/* Resume chips — subtle, conditional */
.home-resume { display: flex; flex-wrap: wrap; gap: var(--s2); }
.home-resume-chip {
  display: inline-flex; align-items: center; gap: var(--s2);
  padding: var(--s2) var(--s3);
  border: 1px solid var(--border); border-radius: var(--r-btn);
  background: var(--bg-elev); color: var(--text-dim); cursor: pointer;
  font-size: var(--fz-sm); max-width: 260px;
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.home-resume-chip:hover { border-color: var(--border-strong); color: var(--text); }
.home-resume-chip--stale { opacity: 0.5; }
.home-resume-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 3: Verify build + tests.** From `glint/`: `npx tsc --noEmit` (Expected: no errors — confirms removed imports like `Card`/`FileText`/`settings` aren't referenced) and `npx vitest run` (Expected: all pass; Home has no unit tests, so this confirms nothing regressed).

- [ ] **Step 4: At-screen check.** Launch; confirm: New-capture row with rounded buttons (Capture Area = accent, Open Project = ghost); Recent grid fills the space and shows newest 10 with a working "View all in Library →"; Resume row appears only when a recent `.glint` exists; empty state shows when there are no captures. Shortcuts card is gone.

- [ ] **Step 5: Commit.**

```bash
git add glint/src/views/HomeView.tsx glint/src/views/home.css
git commit -m "feat(p29a): rebuild Home as Concept A quiet launcher"
# (append the required trailer)
```

---

## Self-Review

**Spec coverage (§1 foundations + §2 dashboard):**
- `--r-btn: 8px` token + app-wide button roundness → Tasks 1–2. ✓
- Home Concept A: New-capture row (incl. Open Project ghost), responsive Recent grid, View-all link, conditional Resume, empty state, shortcuts card removed → Task 3. ✓

**Placeholder scan:** Task 2 Step 1 intentionally says "audit each file" rather than pre-listing every line — this is a *selector discrimination* step (button vs input) that must be done against live file contents, with an explicit leave-alone guard; all button selectors are named. No forbidden placeholders elsewhere; full code given for Task 3.

**Type consistency:** `RECENT_LIMIT`/`RESUME_LIMIT` constants used consistently. `listCaptures(RECENT_LIMIT)` matches `lib/captures` signature `(limit?: number)`. `RecentProject` fields `path`/`name`/`exists` match `lib/editor`. `Button` `variant`/`size`/`icon` props match the primitive. `EmptyState` `icon`/`title`/`hint` props match its signature. `useNavigate` from react-router works inside AppShell.

**Note for executor:** if `getRecentProjects`/`RecentProject` or `pickOpenPath` signatures differ from those used here, reconcile against `lib/editor.ts` before writing — they were carried over verbatim from the previous `HomeView`.
