# Glint Phase 1 — App Shell (design / spec)

Parent: `2026-06-20-glint-architecture-and-phase0-design.md`. Phase 0 gate: **passed**.

## Goal
A running, tray-resident Glint desktop app with a genuinely polished main window that
routes between **Home / Library / Settings**, SQLite initialized with migrations, global
hotkey plumbing in place, and a **design system that sets the visual bar** for the whole
product. No capture/recording features yet (P2+). The shell must already *look* like a
premium product — this is where the "don't ship default-looking UI" bar is established.

## In scope
1. **Tauri v2 scaffold** — Rust backend + React + TypeScript + Vite frontend. App/product
   name **Glint** everywhere (package, window title, tray tooltip, bundle identifier
   `com.glint.app`).
2. **Tray-core** — tray icon + menu (Open Glint · Capture ▸ [Area/Window/Fullscreen
   placeholders] · Record placeholder · Settings · Quit). Left-click opens/focuses the
   main window.
3. **Window lifecycle** — main window **closes to tray** (does not quit); Quit from tray
   exits the process. **Single-instance** (second launch focuses the existing window).
4. **Custom titlebar** — window decorations off; our own slim titlebar with drag region +
   min/maximize/close controls. Establishes the borderless-window muscle the capture
   overlays/HUD need later, and the coherent premium feel.
5. **Global shortcuts** — `tauri-plugin-global-shortcut` wired. Register the default
   hotkey map; for P1 the handlers just open/focus the app and show a toast (real capture
   lands in P2). Hotkeys come from settings so they're reconfigurable later.
6. **Routing** — React Router: `/home`, `/library`, `/settings`; `/` → `/home`; `/editor`
   route stubbed. Persistent left nav rail (Lucide icons).
7. **SQLite** — `tauri-plugin-sql`, DB at `%APPDATA%\Glint\glint.db`, migration v1 creating
   `captures` and `settings` tables. A typed **settings service** in Rust (defaults,
   get/set, JSON-typed values) exposed to the frontend via Tauri commands.
8. **Appearance works end-to-end** — theme (dark / light / system) is the first fully
   functional setting: change it in Settings → persists to SQLite → applied on next launch.
   Dark is primary.
9. **Views (shells, real where cheap):**
   - **Home** — recent-captures grid (empty state), quick-start buttons (Area / Window /
     Fullscreen / Record → placeholders), current hotkeys at a glance.
   - **Library** — layout skeleton (grid + filter/search bar) reading from SQLite (empty
     for now). Full data/restore/delete is P4.
   - **Settings** — sectioned shell: General · Capture · Recording · Auto-save · Hotkeys ·
     Appearance · Storage. Appearance fully functional; other sections render their
     controls but may be inert until their phase.
10. **Logging** — rotating logs to `%APPDATA%\Glint\logs` via `tauri-plugin-log`.
11. **Tests** — Rust unit tests for the settings service (defaults, round-trip
    serialize/deserialize, get/set) and a migration smoke test.

## Design system (the heart of P1 — built with the frontend-design skill)
- **Tokens:** color (neutral ramp + one accent), spacing scale, type scale, radii,
  1px borders over heavy shadows, motion durations/easings.
- **Theme:** dark primary + clean light option; thin/light font weights; generous
  whitespace. No purple gradients, glow, sparkle/star icons, or rainbow accents.
- **Accent (proposed, overridable):** a single restrained **indigo-leaning blue**
  (`#5B7CFA`-ish), used sparingly for focus/active/primary only. Open to your preference.
- **Primitives:** Button, IconButton, Card, Switch/Toggle, NavItem, Section, Field/Input,
  Select, Tooltip, Toast, EmptyState. Lucide iconography, uniform sizing.
- **Type:** Inter (or system UI stack fallback) — confirm at build.

## Out of scope for P1
Screen capture, recording, annotation, OCR, pinned windows, post-capture HUD, drag &
path, real library data, auto-save. (All P2+.)

## Key decisions
- Frontend state: **Zustand** (lightweight).
- Custom titlebar (decorations off) from the start.
- Icons: **Lucide**. Font: **Inter** with system fallback.
- DB access via `tauri-plugin-sql` + versioned migrations.
- Settings stored as typed rows in `settings`; a Rust service owns defaults & validation.

## Success criteria (P1 done when…)
`npm run tauri dev` launches → tray appears, main window opens with custom chrome, nav
routes between Home/Library/Settings, the theme toggle **persists across a full restart**
(proving SQLite), a default global hotkey fires a visible toast, logs are written, and the
UI is visibly polished and coherent — not default-looking. Settings-service tests pass.
