# Glint

A polished, **local-first** Windows desktop app for screenshots, screen recording,
annotation, and OCR — modelled on CleanShot X's core workflow. Everything stays on
your device: no cloud, no accounts, no network calls, no auth. Single user.

## Stack

- **Tauri v2** (Rust core + React/TypeScript webview)
- **SQLite** via `tauri-plugin-sql` (versioned, sqlx-backed migrations)
- **Zustand** state, **React Router** (hash router), **Lucide** icons
- Design tokens as CSS custom properties; dark-primary, single periwinkle accent

## Data & log locations

- Database: `%APPDATA%\com.glint.app\glint.db` (WAL mode)
- Logs: `%LOCALAPPDATA%\com.glint.app\logs\glint.log` (rotating)

## Development

```sh
npm install
npm run tauri dev      # run the desktop app
```

### Checks

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
npx tsc --noEmit
npx vite build
```

## Status

**Phase 1 (app shell) complete** — tray, custom titlebar, nav shell, SQLite
migrations, settings persistence, global shortcuts, rotating logs. See
`docs/superpowers/PHASE-1-ACCEPTANCE.md`. Capture, HUD, annotation, recording,
pinned screenshots, and OCR land in later phases.
