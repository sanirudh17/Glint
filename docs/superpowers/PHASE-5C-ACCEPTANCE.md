# Phase 5c — `.glint` Document Save/Load — Acceptance

**Status:** ACCEPTED (at-screen) + merged to master.
**Branch:** `phase-5c-glint-document` (merged, deleted). **Spec:** specs/2026-06-23-glint-phase5c-glint-document-design.md.
**Plan:** plans/2026-06-23-glint-phase5c-glint-document.md.

## Automated (green gate) — PASSED
- [x] `cargo build` OK; `cargo test` green — 38 passed, 0 failed, 2 ignored (incl. `editor::document` round-trip / version / malformed / corrupt-base64).
- [x] `vitest run` green — 36 passed (incl. `loadDoc` atomic hydrate + dirty tracking: 18 store tests).
- [x] `tsc --noEmit` clean + `vite build` clean.

## At-screen (manual)
- [ ] Annotate + crop + frame a capture → **Save** → choose path → `.glint` written; titlebar shows name, `•` clears.
- [ ] Edit again → `•` reappears; **Ctrl+S** overwrites silently (no dialog); `•` clears.
- [ ] **Save As** (Ctrl+Shift+S) writes a second file; titlebar updates to the new name.
- [ ] Close + reopen the `.glint` via **Open** (editor) and via **Home → Recent projects** → identical editable document (move an annotation; crop + frame intact).
- [ ] Open a project while already in the editor → it reloads correctly.
- [ ] **Export** still writes a flattened PNG to the Library (unchanged behavior).
- [ ] Recent projects lists newest-first, dedupes, caps at 8; a deleted file shows greyed + toasts on click.
- [ ] Corrupt/newer-version `.glint` → friendly toast, no crash.

## Notes carried from review (for at-screen attention)
- T6 review fixes applied (commit 739aa35): editor-open reload cancels its in-flight load on unmount/re-open; OS title reset only on unmount (no flicker).
- Final whole-branch review fixes (commit f770147): `project_save` records the path only after a successful write; **Export** button icon changed Save→Download to distinguish exporting a PNG from saving the project (the one data-loss path this phase leaves open — no close-confirm yet).

## Deferred to a later phase (accepted Minors from final review)
- Stale Recent Projects are greyed + toast on click but are **not removed** from the persisted list (display-only pruning). Consider persist-pruning when a missing file is encountered.
- No runtime validation of an opened `.glint`'s `doc` contents (opaque-doc design + single-user/local trust). `frame` is defended via `mergeFrame`; `annotations`/`crop` fall back but contents are trusted.
- `project_save` does not `create_dir_all` the parent (unreachable via the native dialog) and uses `set_extension` which could surprise on a dotted filename typed without an extension.
