# Glint Phase 1 — App Shell: Acceptance (2026-06-21)

Plan: `plans/2026-06-20-glint-phase1-app-shell.md` · Spec: `specs/2026-06-20-glint-phase1-app-shell-design.md`
Branch: `phase-1-app-shell`. **Status: complete.**

All 14 tasks implemented via subagent-driven development (implementer + reviewer per task,
ledger at `.superpowers/sdd/progress.md`). Every task reviewed and Approved.

## Automated acceptance — PASS

| Gate | Result |
|---|---|
| `cargo test` (settings service + migration shape) | 5 passed |
| `cargo clippy --all-targets` | no warnings |
| `npx tsc --noEmit` + `npx vite build` | clean |
| First real GUI boot (`npm run tauri dev`) | window rendered (EBWebView), process healthy |
| SQLite migrations at runtime | `captures` (12 cols incl. `deleted_at`), `idx_captures_created`, `settings`, `_sqlx_migrations` created at `%APPDATA%\com.glint.app\glint.db` |
| Rotating logs | `%LOCALAPPDATA%\com.glint.app\logs\glint.log` written, contains "Glint started" |
| Global shortcuts | all 5 registered at boot, no conflicts, no panics |
| Runtime log | clean — zero errors/warnings/SQL-permission denials |

### Notable defect caught & fixed during the pass
`capabilities/default.json` granted only `core:default` + `opener:default`. The `plugin-sql`
JS API (`Database.load`/`select`/`execute`) is ACL-gated, so **all frontend SQL would have been
denied at runtime** — invisible to headless builds. Fixed by granting
`sql:allow-load` / `allow-select` / `allow-execute` (commit `8adff65`). App-defined `settings_*`
commands need no permission; `core:default` already covers event listen/emit.

## Manual checklist (requires a human at the screen)
Run `npm run tauri dev` and confirm:
- [ ] Tray icon appears; left-click focuses the window; tray menu (Open/Capture▸/Record/Settings/Quit) works.
- [ ] Borderless custom titlebar: drag moves the window; min / maximize / close work; **close hides to tray** (process stays); tray → Quit exits.
- [ ] Nav rail routes Home / Library / Settings with a clear active state; nav tooltips open to the right.
- [ ] **Theme persistence (the P1 proof):** Settings → Appearance → set Light + a non-default accent → Quit via tray → relaunch → reopens in Light + that accent.
- [ ] Press `Ctrl+Shift+1` from another app → Glint focuses and shows a "Hotkey: capture_area" toast.
- [ ] Overall: the UI looks genuinely polished (dark "ink on glass", restrained accent), not default.

## Carried forward
- **Phase 6 (recorder):** `scap 0.0.8` only builds against `windows-capture =1.4.4` (see `spike/RESULTS.md`).
- **Polish phase:** `Field` renders its label as `<span>`, not `<label for>` — systemic a11y gap (targeted `aria-label` used on the theme Select for now). Tray icon `.unwrap()` panics if the icon asset is missing.
