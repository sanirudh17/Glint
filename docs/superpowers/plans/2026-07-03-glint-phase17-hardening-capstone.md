# Glint Phase 17 — P8 Capstone: Hardening, Cleanup & Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the planned roadmap (the hardening/cleanup/tests/docs tail of P8): a
warning-clean build, an honestly-green test suite, an audited-and-documented DPI story, and a
ROADMAP that records everything shipped through Phase 16.

**Architecture:** Pure cleanup and documentation across the existing tree — no new features,
no new modules, no new dependencies. Each task ends warning-and-test green so any task can be
reverted independently without leaving the tree broken.

**Tech Stack:** Rust (Tauri v2, clippy), TypeScript (vitest, tsc), Markdown docs.

## Global Constraints

- **No new user-facing features.** This phase only cleans, audits, tests, and documents.
- **Local-only invariant unchanged:** no cloud, upload, accounts, auth, or network calls.
- **Recorder isolation (SACRED):** nothing under `recorder/*` may gain an import from
  `capture/`, `editor/`, `overlay/`, or `ocr/`; `ocr/` gains nothing from `recorder/`.
  (`settings/` is permitted for the recorder.) No task here adds cross-module imports.
- **Green gate held every task:** `cargo build` warning-clean (except consciously-retained,
  documented warnings), `cargo test` and `npx vitest run` green, `npx tsc --noEmit` clean.
- **Branch:** `phase-17-hardening-capstone` (already created, off `master`). Code lives in the
  `glint/` repo; the ROADMAP + acceptance doc live in the parent `Claude Code` repo under
  `docs/superpowers/`.
- **Baseline to preserve:** 121 Rust tests (2 ignored), 99 vitest tests. Never drop below,
  minus any test removed with a stated reason.
- **Commit trailers:** end each commit message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and the `Claude-Session:` line.

All commands below run from `C:/Users/sanir/Claude Code/glint/src-tauri` (Rust) or
`C:/Users/sanir/Claude Code/glint` (frontend) unless stated. Merge target is `master`.

---

### Task 1: Apply the safe clippy autofixes

Clippy offers 6 mechanically-safe autofixes (redundant rebindings ×3, collapsible `if` ×2,
unnecessary same-type cast ×1). Apply them via `cargo clippy --fix`, then eyeball the diff —
autofix is safe but every diff still gets read.

**Files (touched by autofix):**
- Modify: `src/capture/commands.rs:300-302` (redundant `let png = png;` / `cropped` / `path_str`)
- Modify: `src/capture/cursor.rs:55` (`u32` → `u32` cast)
- Modify: `src/recorder/fx/hooks.rs:55,60` (collapsible `if` into outer `match`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new — signatures unchanged; this is body-only cleanup.

- [ ] **Step 1: Confirm the baseline is green before touching anything**

Run (from `src-tauri`): `cargo test 2>&1 | grep "test result"`
Expected: `test result: ok. 121 passed; 0 failed; 2 ignored` (plus two `0 passed` doctests lines).

- [ ] **Step 2: Apply the autofixes**

Run (from `src-tauri`): `cargo clippy --fix --lib -p glint --allow-dirty`
Expected: "Fixed N warnings" — the 6 auto-applicable ones removed.

- [ ] **Step 3: Read the diff by eye**

Run (from `src-tauri`): `git diff`
Confirm each change is a pure simplification: the three `let x = x;` lines at
`capture/commands.rs:300-302` are gone (the `move` closure still captures `png`, `cropped`,
`path_str`), the cast at `cursor.rs:55` lost its `as u32`, and the two `if` blocks in
`fx/hooks.rs` folded into their `match` arms. Nothing else changed.

- [ ] **Step 4: Verify build + tests still green**

Run (from `src-tauri`): `cargo build 2>&1 | grep -c warning` → expect a lower count than 15.
Run (from `src-tauri`): `cargo test 2>&1 | grep "test result"` → expect `121 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(p17): apply safe clippy autofixes (redundant rebindings, collapsible if, cast)"
```

---

### Task 2: Adjudicate the remaining manual clippy warnings

The non-autofixable warnings each need a human call: fix if it's a clear readability win,
otherwise retain with a one-line `#[allow(clippy::...)]` + comment stating why. The
"too many arguments" (×3) and "very complex type" warnings are, per the spec, **retained by
default** (intrinsic to command/audio signatures) — but each retained one must be made
explicit so it reads as a decision, not an oversight.

**Files:**
- Modify: `src/recorder/trim.rs:62` (negated comparison on partial-ord) — **fix**
- Modify: `src/recorder/mod.rs:481` (`match` single-pattern → `if let`) — **fix**
- Modify: `src/recorder/mod.rs:764` (`map_err` → `inspect_err`) — **fix**
- Modify: `src/shell_integration.rs:86` (operation has no effect) — **fix**
- Modify: `src/recorder/audio.rs:38` (very complex type) — **retain + document**
- Modify: `src/recorder/trim.rs:191`, `src/recorder/mod.rs:115`, `src/recorder/mod.rs:522`
  (too many arguments) — **retain + document**

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new — bodies and one `#[allow]` attribute per retained site; public
  signatures unchanged.

- [ ] **Step 1: Fix the four clear-win warnings**

For each, read the site first (`cargo clippy` prints the exact suggested rewrite) and apply it:
- `trim.rs:62` — replace the `!(a < b)`-style negated comparison with the `partial_cmp`-based
  form clippy suggests (makes NaN/incomparable handling explicit).
- `mod.rs:481` — replace `match x { Pat => …, _ => () }` with `if let Pat = x { … }`.
- `mod.rs:764` — replace `.map_err(|e| { …; e })` (used only for a side effect) with
  `.inspect_err(|e| { … })`.
- `shell_integration.rs:86` — remove the no-effect operation clippy flags (read the line; it is
  a statement whose result is discarded with no side effect).

- [ ] **Step 2: Retain-and-document the four signature/type warnings**

For `audio.rs:38` add directly above the flagged item:
```rust
// Retained: the tuple is an ffmpeg-pipe wiring handle passed once between two
// recorder-internal fns; factoring a type alias here would obscure, not clarify.
#[allow(clippy::type_complexity)]
```
For each of `trim.rs:191`, `mod.rs:115`, `mod.rs:522` add directly above the fn:
```rust
// Retained: arity is intrinsic to this recording-pipeline entry point; a params
// struct would only move the same fields behind one more indirection.
#[allow(clippy::too_many_arguments)]
```
(Word each comment to the specific function — do not paste verbatim if the reason differs.)

- [ ] **Step 3: Verify clippy is now clean**

Run (from `src-tauri`): `cargo clippy 2>&1 | grep -c "^warning:"`
Expected: `0` real warnings remain except the `field saved is never read` one (Task 3 removes
it). If any unexpected warning remains, address or document it.

- [ ] **Step 4: Verify build + tests green**

Run (from `src-tauri`): `cargo test 2>&1 | grep "test result"` → `121 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(p17): fix or consciously retain remaining clippy warnings"
```

---

### Task 3: Remove genuinely-dead code; document the reserved allows

Adjudicate the dead-code sites. `LastCapture.saved` is written but never read (the Save↔Reveal
toggle keys off `TrayItem.saved` and frontend state) → remove. The `#[allow(dead_code)]` sites
split: `monitor_id` and the window `title`/`app` fields are documented reservations → keep as-is;
the speculative `window_at` and `close_ocr_window` functions are YAGNI → verify unreferenced,
then remove.

**Files:**
- Modify: `src/capture/mod.rs:86` (remove `saved` field) + its construction site
- Modify: `src/capture/windows_enum.rs:27-33` (remove `window_at` if unreferenced)
- Modify: `src/ocr/window.rs:27-32` (remove `close_ocr_window` if unreferenced)

**Interfaces:**
- Consumes: nothing.
- Produces: `LastCapture` loses its `saved: bool` field — any construction site that set it
  must drop that initializer.

- [ ] **Step 1: Find where `LastCapture` is constructed**

Run (from `src-tauri`): `grep -rn "LastCapture {" src`
Read each hit. Confirm the `saved:` initializer there is the field's only writer and nothing
reads `<last_capture>.saved` anywhere (the reads at `commands.rs:248/403/482/497` are on
`ev`/`it`, i.e. events and `TrayItem`, NOT `LastCapture` — verify by reading each).

- [ ] **Step 2: Remove the field and its initializer**

Delete `pub saved: bool,` (with its doc comment) at `capture/mod.rs:84-86`, and delete the
`saved: …,` line in the `LastCapture { … }` construction found in Step 1.

- [ ] **Step 3: Confirm `saved` warning is gone and nothing broke**

Run (from `src-tauri`): `cargo build 2>&1 | grep "saved"` → expect no output.
Run: `cargo build 2>&1 | grep -c warning` → expect `0`.

- [ ] **Step 4: Adjudicate the two speculative dead functions**

Run (from `src-tauri`): `grep -rn "window_at\b" src` and `grep -rn "close_ocr_window" src`.
If the ONLY hit for each is its own definition (no caller anywhere, including tests), delete the
whole function (`window_at` at `windows_enum.rs:27-33`; `close_ocr_window` at `ocr/window.rs:27`
through its closing brace) and its doc comment and `#[allow(dead_code)]`. If a caller exists,
leave it and note the surprise. Leave the `monitor_id` field and the window `title`/`app`
fields exactly as they are — they are documented reservations, correctly kept.

- [ ] **Step 5: Verify the tree still builds warning-clean + tests green**

Run (from `src-tauri`): `cargo build 2>&1 | grep -c warning` → `0`.
Run: `cargo clippy 2>&1 | grep -c "^warning:"` → `0`.
Run: `cargo test 2>&1 | grep "test result"` → `121 passed` (or fewer only if a removed
function had a dedicated test — if so, that test is removed with it; note it).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(p17): remove dead LastCapture.saved + speculative unused fns"
```

---

### Task 4: DPI audit (code-level) + refresh verification (at-screen)

Read every scale-sensitive path and write down how it handles the monitor scale factor and
origin. Fix anything clearly wrong. Then manually verify live-refresh behavior on the single
monitor. The deliverable is fixes (if any) plus an audit note that Task 6 folds into the
acceptance doc.

**Files:**
- Read (audit): `src/capture/mod.rs` (crop origin, `scale`), `src/capture/cursor.rs`
  (composite origin), `src/overlay.rs` / overlay window build, HUD window positioning,
  `src/pin.rs` (pin placement).
- Create: `scratchpad` note `dpi-audit.md` (working notes; content moves into the acceptance
  doc in Task 6 — do not commit the scratchpad file).
- Modify: only files with a clear DPI bug found during the audit.

**Interfaces:**
- Consumes: nothing.
- Produces: audit notes (prose) + any bug-fix diffs.

- [ ] **Step 1: Trace and record each scale-sensitive path**

For each of: capture crop origin, overlay window position/size, HUD position, pin window
position, and cursor-composite origin (P16) — read the code and write one line per path in the
scratchpad note stating: (a) does it use logical or physical pixels, (b) does it assume the
primary monitor is at origin (0,0), (c) is that assumption safe on a single monitor and what
would break with a second/mixed-DPI monitor. Cite `file:line` for each.

- [ ] **Step 2: Fix any clear bug**

If a path uses a raw constant where it should read `session.scale` / the monitor scale, or
mixes logical and physical coordinates in a way that is wrong even single-monitor, fix it
minimally and note it. If everything is correct-for-single-monitor with only documented
multi-monitor caveats, make **no** code change — record the caveats instead. (Do not
speculatively "harden" paths you cannot test; YAGNI.)

- [ ] **Step 3: Verify refresh / live-state on the running app (at-screen)**

Build and run: from `glint`, `npm run tauri dev` (launch WITHOUT any truncating `| Select-Object`
pipe — that closes the pipe and kills the dev process). Then confirm, without restarting:
  1. Rebind a hotkey in Settings → the new binding fires immediately.
  2. Toggle "Show in taskbar" → the taskbar icon appears/disappears live.
  3. Toggle "Sound effects" → next capture plays / is silent accordingly.
  4. Change the save folder → next capture lands in the new folder.
  5. Take a capture → the Library gains a row without a manual refresh; delete it → the row
     disappears live.
Record pass/fail per item. Fix any that fail (these ARE reproducible on one monitor).

- [ ] **Step 4: Commit (only if code changed)**

If Step 2 or Step 3 produced a fix:
```bash
git add -A
git commit -m "fix(p17): <specific DPI/refresh bug found in audit>"
```
If the audit found nothing to fix, there is no commit here — the findings travel to Task 6.

---

### Task 5: Test sweep — adjudicate ignored tests, close real gaps

Make the ignored tests honest and add unit tests only where phases 12–16 left a genuine logic
gap. No coverage-theater.

**Files:**
- Modify: `src/capture/windows_enum.rs:95` (bare `#[ignore]` — add reason or un-ignore)
- Modify/Create: a test module for any real gap found (e.g. `settings/locations.rs`,
  `settings/hotkeys.rs` already have tests — check P12–14 additions that don't).

**Interfaces:**
- Consumes: nothing.
- Produces: additional `#[test]` fns; test count rises or stays equal.

- [ ] **Step 1: Give the bare `#[ignore]` a reason or a pass**

Read `capture/windows_enum.rs:90-100`. If the test needs a real display or live enumeration,
change `#[ignore]` to `#[ignore = "<concrete reason, e.g. requires live window enumeration">]`
to match the house convention (see `frozen.rs:121`). If it can run deterministically, un-ignore
it and confirm it passes.

- [ ] **Step 2: Identify genuine coverage gaps from phases 12–16**

Run (from `src-tauri`): `grep -rn "#\[test\]" src | wc -l` (baseline 123) and skim the P12–16
modules for pure logic with no test. Candidates: any pure helper added for editor-essentials
(P12), quick-access-overlay tray model (P14 — `tray.rs` already has tests, confirm coverage of
`push`/`remove`/dedupe), or settings save-dir resolution edge cases (P16 `locations.rs` has 2
tests — check the empty-`save_dir` fallback branch is among them). Only where a branch is
genuinely untested, proceed to Step 3; otherwise skip to Step 4.

- [ ] **Step 3: Add a targeted test for each real gap (red → green)**

For each gap, write the test first, run it to confirm it exercises the branch (it should pass
against correct code, or fail if you deliberately break the branch to check — then restore).
Example shape for a pure resolver branch:
```rust
#[test]
fn resolve_falls_back_to_default_root_when_save_dir_empty() {
    let got = resolve("", Path::new("C:/Users/x/Pictures/Glint"));
    assert_eq!(got, PathBuf::from("C:/Users/x/Pictures/Glint"));
}
```
Keep each test to one behavior with a clear failure reason.

- [ ] **Step 4: Full suite green**

Run (from `src-tauri`): `cargo test 2>&1 | grep "test result"` → passed count ≥ 121.
Run (from `glint`): `npx vitest run 2>&1 | grep "Tests"` → `99 passed` (or more).
Run (from `glint`): `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(p17): adjudicate ignored tests + cover phase 12-16 gaps"
```

---

### Task 6: Reconcile ROADMAP + write PHASE-17 acceptance doc

Bring the docs up to truth. These files live in the **parent** repo
(`C:/Users/sanir/Claude Code`, under `docs/superpowers/`), not the `glint` repo.

**Files (parent repo):**
- Modify: `docs/superpowers/ROADMAP.md` (add P12–P16 to Shipped; mark P8 complete)
- Create: `docs/superpowers/PHASE-17-ACCEPTANCE.md`

**Interfaces:**
- Consumes: the DPI audit notes from Task 4, the final green-gate numbers from Tasks 1–5.
- Produces: nothing code-facing.

- [ ] **Step 1: Add the five shipped phases to ROADMAP.md**

After the Phase 11 entry in the "## Shipped" section, add one concise paragraph per phase in the
exact prose style of the existing entries (bold phase name + em-dash summary + what shipped +
isolation note where relevant). Use the shipped facts:
  - **Phase 12 — Editor essentials** (from `plans/2026-07-02-glint-phase12-editor-essentials.md`).
  - **Phase 13 — Window chrome** (from `…phase13-window-chrome.md`).
  - **Phase 14 — Quick-Access Overlay** — accumulating bottom-left tray of recent captures
    (drag-out, per-card actions, Clear all); full-res thumbnails; from
    `…phase14-quick-access-overlay.md`.
  - **Phase 15 — Rebindable Hotkeys** — capture-driven rebinding UI with in-app instructions,
    validation (requires a modifier, dedupe), live re-registration, reset/clear.
  - **Phase 16 — Settings Gaps** — custom save folder, launch-at-login (HKCU Run), opt-in
    synthesized shutter sound, show-in-taskbar toggle, opt-in cursor compositing.
Read each plan/spec file first to get each summary accurate; do not invent details.

- [ ] **Step 2: Mark P8 complete**

Update the roadmap so the P8 capstone (settings completeness, hotkeys, DPI/refresh hardening,
cleanup, tests, docs) reads as delivered across P15–P17. Keep the "Planned / Deferred" and
"Out of scope" sections intact.

- [ ] **Step 3: Write PHASE-17-ACCEPTANCE.md**

Cover, in the style of the other PHASE-N-ACCEPTANCE docs: what this phase did (the four
buckets), the before/after warning counts, the clippy warnings consciously retained (with the
reason for each), the dead code removed, the **DPI audit findings** (per-path notes + the
documented single-monitor-only assumptions from Task 4), the refresh checklist results, the
ignored-test adjudication, and the final green-gate numbers (`cargo build`/`clippy`/`test`,
`vitest`, `tsc`).

- [ ] **Step 4: Commit the docs (parent repo)**

```bash
cd "C:/Users/sanir/Claude Code"
git add docs/superpowers/ROADMAP.md docs/superpowers/PHASE-17-ACCEPTANCE.md
git commit -m "docs(p17): reconcile ROADMAP (phases 12-16) + phase 17 acceptance"
```

---

### Task 7: Final green gate + at-screen sign-off + merge

**Files:** none (verification + merge).

- [ ] **Step 1: Full green gate**

From `src-tauri`: `cargo build 2>&1 | grep -c warning` → `0`; `cargo clippy 2>&1 | grep -c "^warning:"`
→ `0`; `cargo test 2>&1 | grep "test result"` → `≥121 passed`.
From `glint`: `npx vitest run` → all green; `npx tsc --noEmit` → clean.

- [ ] **Step 2: At-screen acceptance**

Present the refresh checklist results (Task 4 Step 3) and the cleanup summary to the user for
sign-off. Do NOT merge before the user accepts.

- [ ] **Step 3: Merge to master (both repos)**

After user acceptance, in the `glint` repo:
```bash
cd "C:/Users/sanir/Claude Code/glint"
git checkout master
git merge --no-ff phase-17-hardening-capstone -m "merge: Phase 17 — P8 capstone (cleanup, DPI audit, tests, docs)"
git branch -d phase-17-hardening-capstone
git checkout -- src-tauri/Cargo.toml   # discard any CRLF/LF EOL noise
```
The parent-repo docs commit from Task 6 is already on the parent's default branch — confirm
with `cd "C:/Users/sanir/Claude Code" && git status`.

## Self-Review

- **Spec coverage:** Bucket 1 (lint) → Tasks 1–2; Bucket 1 (dead code) → Task 3; Bucket 2
  (DPI audit + refresh) → Task 4; Bucket 3 (tests) → Task 5; Bucket 4 (docs) → Task 6; green
  gate + merge → Task 7. All four buckets covered.
- **Placeholders:** none — each fix cites `file:line` and the concrete transformation; the
  audit/test tasks are investigation-structured with explicit decision criteria rather than
  vague "handle edge cases."
- **Type consistency:** the only signature change is `LastCapture` losing `saved: bool`
  (Task 3), and Task 3 Step 2 removes its sole initializer — no dangling references.
