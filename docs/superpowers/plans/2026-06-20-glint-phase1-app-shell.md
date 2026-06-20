# Glint Phase 1 — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a tray-resident, polished Glint desktop app whose main window routes between Home / Library / Settings, with SQLite + a typed settings service, global-hotkey plumbing, and a design system that sets the visual bar — no capture/recording features yet.

**Architecture:** One Tauri v2 app. Rust `src-tauri` is the tray-core (tray, window lifecycle, single-instance, SQLite migrations, settings service, global shortcuts, logging). React/TS/Vite frontend owns all visual surfaces behind a tokens-based design system. Settings persist in SQLite and drive theme end-to-end as the proof-of-wiring.

**Tech Stack:** Tauri v2, Rust, React 18 + TypeScript + Vite, Zustand, React Router v6, Lucide, `tauri-plugin-sql`, `tauri-plugin-global-shortcut`, `tauri-plugin-log`, `tauri-plugin-single-instance`.

## Global Constraints

- App/product name is **Glint** everywhere: package name, window title, tray tooltip, bundle identifier `com.glint.app`. No references to "Snip".
- **Local-first only.** No network calls, no accounts, no telemetry. Anything that would phone home is a defect.
- **Windows-first.** Platform-specific Rust sits behind a `platform` module; no `#[cfg]` in business logic. Do not build/test Linux now.
- **Recorder isolation is sacred** (future phases): nothing in the shell may couple the (future) recorder to the rest of the app. Not exercised in P1 but keep module boundaries clean.
- Dark theme is primary; light is a clean option. No purple gradients, glow, sparkle/star icons, or rainbow accents. One restrained accent used sparingly.
- DB at `%APPDATA%\Glint\glint.db`; logs at `%APPDATA%\Glint\logs`.
- Rust services that hold non-UI logic (settings, migrations) must have unit tests.
- Tauri v2 APIs only (not v1). `tauri-plugin-single-instance` must be registered **first**.

---

## File Structure

```
glint/
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      lib.rs              # app builder: plugins, tray, commands, lifecycle wiring
      main.rs             # thin entry -> glint_lib::run()
      tray.rs             # tray icon + menu + events
      window.rs           # window lifecycle: close-to-tray, show/focus, single-instance focus
      db/
        mod.rs            # migration definitions (v1: captures, settings)
      settings/
        mod.rs            # Settings struct, defaults, SettingsService (get/set/load/save) + tests
        commands.rs       # #[tauri::command] bridges: settings_get_all, settings_set
      shortcuts.rs        # global shortcut registration + handler (P1: focus app + emit toast)
      platform/
        mod.rs            # trait surface (stub in P1, real impls in later phases)
  src/                    # frontend
    main.tsx
    App.tsx               # router + theme provider mount
    router.tsx            # routes: /home /library /settings (/ -> /home), /editor stub
    styles/
      tokens.css          # CSS custom properties: color/spacing/type/radii/motion
      global.css          # resets, base element styling, theme attribute wiring
    lib/
      ipc.ts              # typed wrappers over @tauri-apps/api invoke + plugin-sql
      settings.ts         # settings types mirrored from Rust + load/update helpers
    store/
      useAppStore.ts      # Zustand: theme, settings, hotkeys, toast queue
    components/
      Titlebar.tsx        # custom chrome: drag region + min/max/close
      NavRail.tsx         # left nav (Home/Library/Settings) Lucide icons
      ui/                 # design-system primitives
        Button.tsx IconButton.tsx Card.tsx Switch.tsx Section.tsx
        Field.tsx Select.tsx Tooltip.tsx Toast.tsx EmptyState.tsx index.ts
    views/
      Home.tsx
      Library.tsx
      Settings.tsx
      settings/           # Settings sub-sections
        General.tsx Capture.tsx Recording.tsx AutoSave.tsx Hotkeys.tsx
        Appearance.tsx Storage.tsx
  package.json
  index.html
```

---

## Task 1: Scaffold the Tauri v2 app and confirm it launches

**Files:**
- Create: entire `glint/` skeleton via scaffolder (then we reshape).

**Interfaces:**
- Produces: a working `npm run tauri dev` baseline that all later tasks build on.

- [ ] **Step 1: Scaffold** in the repo root (`C:\Users\sanir\Claude Code`):

```bash
npm create tauri-app@latest glint -- --template react-ts --manager npm --yes
cd glint && npm install
```

- [ ] **Step 2: Confirm Rust + frontend deps resolve**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles (downloads Tauri v2 crates), no errors.

- [ ] **Step 3: Launch once to verify the baseline**

Run: `cd glint && npm run tauri dev`
Expected: a default Tauri window opens showing the starter page. Close it.

- [ ] **Step 4: Commit**

```bash
git add glint && git commit -m "chore: scaffold Glint Tauri v2 + React-TS app"
```

---

## Task 2: App identity + window config (name, identifier, custom chrome, single-instance)

**Files:**
- Modify: `glint/src-tauri/tauri.conf.json`
- Modify: `glint/src-tauri/Cargo.toml` (add `tauri-plugin-single-instance`)
- Modify: `glint/src-tauri/src/lib.rs`
- Create: `glint/src-tauri/src/window.rs`

**Interfaces:**
- Produces: `window::focus_main(app: &AppHandle)` — shows + focuses + unminimizes the `main` window. Used by tray, single-instance, and shortcuts.

- [ ] **Step 1: Set identity + borderless window** in `tauri.conf.json`:

```json
{
  "productName": "Glint",
  "identifier": "com.glint.app",
  "app": {
    "windows": [
      {
        "title": "Glint",
        "label": "main",
        "width": 1100,
        "height": 720,
        "minWidth": 880,
        "minHeight": 560,
        "decorations": false,
        "transparent": false,
        "resizable": true,
        "center": true,
        "visible": true
      }
    ]
  }
}
```

- [ ] **Step 2: Add the single-instance plugin**

Run: `cd glint/src-tauri && cargo add tauri-plugin-single-instance`
Then in `package.json` deps add nothing (Rust-only plugin).

- [ ] **Step 3: Implement `window.rs`**

```rust
use tauri::{AppHandle, Manager};

/// Show, unminimize and focus the main window, creating focus from any context.
pub fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
```

- [ ] **Step 4: Register single-instance FIRST** in `lib.rs` (`run()`):

```rust
mod window;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
```

- [ ] **Step 5: Verify** — `npm run tauri dev` shows a borderless 1100×720 window titled Glint (in taskbar). Launch a second `npm run tauri dev`? Instead verify single-instance after build; for dev just confirm borderless window appears.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri && git commit -m "feat: Glint identity, borderless window, single-instance"
```

---

## Task 3: Tray icon + window lifecycle (close-to-tray, quit)

**Files:**
- Create: `glint/src-tauri/src/tray.rs`
- Modify: `glint/src-tauri/src/lib.rs`
- Modify: `glint/src-tauri/tauri.conf.json` (tray icon asset, `app.trayIcon`)

**Interfaces:**
- Consumes: `window::focus_main`.
- Produces: `tray::build(app: &AppHandle) -> tauri::Result<()>` registering the tray; a `WindowEvent::CloseRequested` handler that hides instead of quitting.

- [ ] **Step 1: Declare the tray icon** in `tauri.conf.json` under `app`:

```json
"trayIcon": { "iconPath": "icons/icon.png", "tooltip": "Glint" }
```

- [ ] **Step 2: Build the tray** in `tray.rs`:

```rust
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::window;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Glint", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Glint", true, None::<&str>)?;

    // Capture submenu — placeholders wired to real capture in P2.
    let cap_area = MenuItem::with_id(app, "cap_area", "Capture Area", true, None::<&str>)?;
    let cap_win = MenuItem::with_id(app, "cap_window", "Capture Window", true, None::<&str>)?;
    let cap_full = MenuItem::with_id(app, "cap_full", "Capture Fullscreen", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", "Start Recording", true, None::<&str>)?;
    let capture = Submenu::with_id_and_items(app, "capture", "Capture", true,
        &[&cap_area, &cap_win, &cap_full])?;

    let menu = Menu::with_items(app, &[
        &open, &capture, &record,
        &PredefinedMenuItem::separator(app)?,
        &settings,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    TrayIconBuilder::with_id("glint-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Glint")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => window::focus_main(app),
            "settings" => {
                window::focus_main(app);
                let _ = app.emit("navigate", "/settings");
            }
            "quit" => app.exit(0),
            // capture/record placeholders emit an event the UI can toast on
            other => { let _ = app.emit("tray-action", other.to_string()); }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                window::focus_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
```

- [ ] **Step 3: Wire tray + close-to-tray** in `lib.rs`:

```rust
mod tray;

// inside Builder chain, before .run():
.setup(|app| {
    tray::build(app.handle())?;
    Ok(())
})
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
            api.prevent_close();
            let _ = window.hide();
        }
    }
})
```

- [ ] **Step 4: Verify** — `npm run tauri dev`: tray icon appears; left-click focuses window; closing the window hides it (process keeps running, tray stays); tray → Quit exits.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri && git commit -m "feat: tray menu + close-to-tray lifecycle"
```

---

## Task 4: SQLite plugin + migrations (captures, settings tables)

**Files:**
- Create: `glint/src-tauri/src/db/mod.rs`
- Modify: `glint/src-tauri/src/lib.rs`, `Cargo.toml`, `package.json`

**Interfaces:**
- Produces: `db::migrations() -> Vec<tauri_plugin_sql::Migration>` and the registered SQL plugin bound to `sqlite:glint.db`. Frontend reaches the DB via `@tauri-apps/plugin-sql`.

- [ ] **Step 1: Add the plugin (Rust + JS)**

```bash
cd glint/src-tauri && cargo add tauri-plugin-sql --features sqlite
cd .. && npm add @tauri-apps/plugin-sql
```

- [ ] **Step 2: Define migrations** in `db/mod.rs`:

```rust
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create captures and settings",
        sql: "
            CREATE TABLE captures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,            -- 'screenshot' | 'recording'
                path TEXT NOT NULL,
                thumb_path TEXT,
                width INTEGER, height INTEGER,
                duration_ms INTEGER,           -- recordings only
                bytes INTEGER,
                app_name TEXT, window_title TEXT,
                created_at INTEGER NOT NULL,   -- unix seconds
                deleted_at INTEGER             -- soft delete
            );
            CREATE INDEX idx_captures_created ON captures(created_at);
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL            -- JSON-encoded
            );
        ",
        kind: MigrationKind::Up,
    }]
}
```

- [ ] **Step 3: Register the plugin** in `lib.rs` (after single-instance):

```rust
mod db;
// ...
.plugin(
    tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:glint.db", db::migrations())
        .build(),
)
```

- [ ] **Step 4: Verify migration runs** — `npm run tauri dev`, then confirm the DB exists:

Run (PowerShell): `Test-Path "$env:APPDATA\com.glint.app\glint.db"` (path is under the identifier dir).
Expected: `True`. (Note the actual dir — plugin-sql uses the app data dir; record the resolved path for Task 5.)

- [ ] **Step 5: Commit**

```bash
git add glint && git commit -m "feat: SQLite via tauri-plugin-sql + v1 migrations"
```

---

## Task 5: Settings service (Rust) + commands + unit tests  *(TDD)*

**Files:**
- Create: `glint/src-tauri/src/settings/mod.rs`, `glint/src-tauri/src/settings/commands.rs`
- Modify: `glint/src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `Settings` struct (serde) with defaults — fields: `theme: Theme` (`Dark|Light|System`), `accent: String`, `hotkeys: Hotkeys { capture_area, capture_window, capture_fullscreen, record, copy_path }`.
  - `Settings::default() -> Settings`.
  - `fn apply_update(current: &mut Settings, key: &str, value: serde_json::Value) -> Result<(), String>` — validates + sets one field.
  - Commands `settings_get_all() -> Settings`, `settings_set(key, value)` (persist via the JS-side DB is fine; Rust service owns shape+validation and an in-memory `State<Mutex<Settings>>`).

- [ ] **Step 1: Write the failing tests** in `settings/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_dark_theme() {
        let s = Settings::default();
        assert!(matches!(s.theme, Theme::Dark));
        assert_eq!(s.hotkeys.capture_area, "CmdOrCtrl+Shift+1");
    }

    #[test]
    fn roundtrips_through_json() {
        let s = Settings::default();
        let text = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn apply_update_sets_known_key() {
        let mut s = Settings::default();
        apply_update(&mut s, "theme", json!("light")).unwrap();
        assert!(matches!(s.theme, Theme::Light));
    }

    #[test]
    fn apply_update_rejects_unknown_key() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "nope", json!(1)).is_err());
    }

    #[test]
    fn apply_update_rejects_bad_value() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "theme", json!("chartreuse")).is_err());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings`
Expected: FAIL (types/functions not defined).

- [ ] **Step 3: Implement `settings/mod.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme { Dark, Light, System }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotkeys {
    pub capture_area: String,
    pub capture_window: String,
    pub capture_fullscreen: String,
    pub record: String,
    pub copy_path: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            capture_area: "CmdOrCtrl+Shift+1".into(),
            capture_window: "CmdOrCtrl+Shift+2".into(),
            capture_fullscreen: "CmdOrCtrl+Shift+3".into(),
            record: "CmdOrCtrl+Shift+5".into(),
            copy_path: "CmdOrCtrl+Shift+C".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: Theme,
    pub accent: String,
    pub hotkeys: Hotkeys,
}

impl Default for Settings {
    fn default() -> Self {
        Self { theme: Theme::Dark, accent: "#5B7CFA".into(), hotkeys: Hotkeys::default() }
    }
}

/// Validate and set one field by key. Keeps the source of truth for valid shapes in Rust.
pub fn apply_update(s: &mut Settings, key: &str, value: serde_json::Value) -> Result<(), String> {
    match key {
        "theme" => { s.theme = serde_json::from_value(value).map_err(|e| e.to_string())?; }
        "accent" => { s.accent = value.as_str().ok_or("accent must be string")?.to_string(); }
        "hotkeys" => { s.hotkeys = serde_json::from_value(value).map_err(|e| e.to_string())?; }
        other => return Err(format!("unknown settings key: {other}")),
    }
    Ok(())
}

pub mod commands;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd glint/src-tauri && cargo test settings`
Expected: 5 passed.

- [ ] **Step 5: Implement commands + state** in `settings/commands.rs`:

```rust
use std::sync::Mutex;
use tauri::State;
use super::{apply_update, Settings};

pub struct SettingsState(pub Mutex<Settings>);

#[tauri::command]
pub fn settings_get_all(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn settings_set(state: State<SettingsState>, key: String, value: serde_json::Value)
    -> Result<Settings, String> {
    let mut s = state.0.lock().unwrap();
    apply_update(&mut s, &key, value)?;
    Ok(s.clone())
}
```

Register in `lib.rs`: `.manage(settings::commands::SettingsState(Default::default()))` and add the two commands to `tauri::generate_handler![...]`. Persistence of settings rows is done from the frontend via plugin-sql (Task 11); the Rust service owns shape + validation + the live in-memory copy.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri && git commit -m "feat: typed settings service + commands (tested)"
```

---

## Task 6: Frontend foundation — deps, design tokens, store, router

> Use the **frontend-design skill** for tokens.css. This is where the visual bar is set.

**Files:**
- Modify: `glint/package.json`
- Create: `glint/src/styles/tokens.css`, `glint/src/styles/global.css`
- Create: `glint/src/store/useAppStore.ts`, `glint/src/router.tsx`, `glint/src/lib/ipc.ts`, `glint/src/lib/settings.ts`
- Modify: `glint/src/main.tsx`, `glint/src/App.tsx`

**Interfaces:**
- Produces: `useAppStore` (Zustand) exposing `{ settings, theme, setTheme, toasts, pushToast, loadSettings }`; `tokens.css` custom properties; router with routes.

- [ ] **Step 1: Add deps**

```bash
cd glint && npm add react-router-dom zustand lucide-react @tauri-apps/api
```

- [ ] **Step 2: Define `tokens.css`** (dark primary, one accent; apply frontend-design judgment):

```css
:root {
  /* spacing scale */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px;
  /* radii */
  --r1:6px; --r2:10px; --r3:14px;
  /* type scale */
  --fz-xs:11px; --fz-sm:12px; --fz-md:13px; --fz-lg:15px; --fz-xl:20px; --fz-2xl:28px;
  --fw-light:300; --fw-normal:400; --fw-medium:500;
  /* motion */
  --ease:cubic-bezier(.2,.6,.2,1); --dur:140ms;
  --accent:#5B7CFA;
}
:root[data-theme="dark"] {
  --bg:#0E0F11; --bg-elev:#16181B; --bg-elev2:#1D2024;
  --border:#26292E; --border-strong:#33373D;
  --text:#E7E9EC; --text-dim:#9097A0; --text-faint:#646B74;
  --accent-fg:#fff; --danger:#E5544B;
}
:root[data-theme="light"] {
  --bg:#FBFBFC; --bg-elev:#fff; --bg-elev2:#F4F5F7;
  --border:#E4E6EA; --border-strong:#D3D6DC;
  --text:#15171A; --text-dim:#5A616B; --text-faint:#8A919C;
  --accent-fg:#fff; --danger:#D33A30;
}
```

- [ ] **Step 3: `global.css`** — box-sizing reset, Inter font stack, base `body { background:var(--bg); color:var(--text); font:var(--fw-normal) var(--fz-md)/1.5 Inter, system-ui, sans-serif; }`, scrollbar styling, `*:focus-visible` accent ring.

- [ ] **Step 4: `useAppStore.ts`**

```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "dark" | "light" | "system";
export interface Settings { theme: Theme; accent: string; hotkeys: Record<string,string>; }
export interface Toast { id: number; text: string; }

interface AppState {
  settings: Settings | null;
  toasts: Toast[];
  loadSettings: () => Promise<void>;
  setTheme: (t: Theme) => Promise<void>;
  pushToast: (text: string) => void;
  dismissToast: (id: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  toasts: [],
  loadSettings: async () => {
    const settings = await invoke<Settings>("settings_get_all");
    set({ settings });
    applyTheme(settings.theme);
  },
  setTheme: async (theme) => {
    const settings = await invoke<Settings>("settings_set", { key: "theme", value: theme });
    set({ settings });
    applyTheme(theme);
    // persistence to SQLite handled in Task 11 via ipc.ts saveSetting()
  },
  pushToast: (text) => set((s) => ({ toasts: [...s.toasts, { id: Date.now(), text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function applyTheme(theme: Theme) {
  const resolved = theme === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
}
```

- [ ] **Step 5: `router.tsx`** — `createBrowserRouter` with layout route wrapping `<Titlebar/>`, `<NavRail/>` + `<Outlet/>`; children `home`, `library`, `settings`, `editor` (stub), index redirect to `home`.

- [ ] **Step 6: Verify** — `npm run tauri dev` boots into the dark theme with the token background; no console errors. (Views are stubs until Tasks 8–11.)

- [ ] **Step 7: Commit**

```bash
git add glint && git commit -m "feat: design tokens, Zustand store, router foundation"
```

---

## Task 7: Design-system primitives

> Use the **frontend-design skill** throughout. Restrained, 1px borders, subtle motion.

**Files:**
- Create: `glint/src/components/ui/{Button,IconButton,Card,Switch,Section,Field,Select,Tooltip,Toast,EmptyState}.tsx`, `index.ts`
- Create: `glint/src/components/ui/ui.css` (or co-located modules)

**Interfaces:**
- Produces (exact prop contracts later tasks consume):
  - `Button({ variant?: "primary"|"ghost"|"subtle", size?: "sm"|"md", icon?, children, onClick, disabled? })`
  - `IconButton({ label, icon, onClick, active? })`
  - `Switch({ checked, onChange, label? })`
  - `Section({ title, description?, children })`
  - `Field({ label, hint?, children })`
  - `Select({ value, options:{value,label}[], onChange })`
  - `EmptyState({ icon, title, hint?, action? })`
  - `Toast` host renders `useAppStore().toasts`, auto-dismiss 2.4s.

- [ ] **Step 1: Implement primitives** with token-driven styles. Example `Button.tsx`:

```tsx
import { LucideIcon } from "lucide-react";
import "./ui.css";
export function Button({ variant="subtle", size="md", icon:Icon, children, ...rest }:{
  variant?: "primary"|"ghost"|"subtle"; size?: "sm"|"md";
  icon?: LucideIcon; children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`g-btn g-btn-${variant} g-btn-${size}`} {...rest}>
      {Icon && <Icon size={size==="sm"?14:16} strokeWidth={1.75} />}
      {children && <span>{children}</span>}
    </button>
  );
}
```

`ui.css` defines `.g-btn` (flex, gap var(--s2), radius var(--r1), 1px border var(--border), bg transparent, transition all var(--dur) var(--ease)); `.g-btn-primary{background:var(--accent);color:var(--accent-fg);border-color:transparent}`; hover states shift bg to `--bg-elev2`. Build the rest analogously.

- [ ] **Step 2: Barrel export** in `index.ts`.

- [ ] **Step 3: Verify** — temporarily render one of each on Home; `npm run tauri dev`; confirm they look crisp and consistent (frontend-design check). Remove the temp gallery.

- [ ] **Step 4: Commit**

```bash
git add glint/src/components/ui && git commit -m "feat: design-system primitives"
```

---

## Task 8: Custom titlebar + nav rail layout

**Files:**
- Create: `glint/src/components/Titlebar.tsx`, `glint/src/components/NavRail.tsx`
- Create: `glint/src/components/shell.css`

**Interfaces:**
- Consumes: ui primitives, router `NavLink`.
- Produces: the app frame used by every route.

- [ ] **Step 1: `Titlebar.tsx`** — a `data-tauri-drag-region` bar with the Glint wordmark left and window controls right:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
const win = getCurrentWindow();
export function Titlebar() {
  return (
    <div className="g-titlebar" data-tauri-drag-region>
      <span className="g-wordmark">Glint</span>
      <div className="g-winctl">
        <button onClick={() => win.minimize()} aria-label="Minimize"><Minus size={15}/></button>
        <button onClick={() => win.toggleMaximize()} aria-label="Maximize"><Square size={13}/></button>
        <button className="g-close" onClick={() => win.close()} aria-label="Close"><X size={15}/></button>
      </div>
    </div>
  );
}
```

(`win.close()` triggers the Rust close-to-tray handler — hides, not quits.)

- [ ] **Step 2: `NavRail.tsx`** — vertical rail with `NavLink`s to `/home` `/library` `/settings` using Lucide `Home`, `Images`, `Settings` icons; active state uses accent. Listen for the Rust `navigate` event to programmatically route to Settings.

- [ ] **Step 3: `shell.css`** — grid: titlebar (height 38px) on top; below it `grid-template-columns: 60px 1fr` (rail + content). Content scrolls; rail fixed.

- [ ] **Step 4: Verify** — `npm run tauri dev`: drag the titlebar moves the window; min/max/close work (close hides to tray); nav switches routes with visible active state.

- [ ] **Step 5: Commit**

```bash
git add glint/src/components && git commit -m "feat: custom titlebar + nav rail shell"
```

---

## Task 9: Home view

**Files:**
- Create: `glint/src/views/Home.tsx`, `glint/src/views/home.css`

**Interfaces:**
- Consumes: ui primitives, `useAppStore().settings.hotkeys`, Rust `tray-action` event.

- [ ] **Step 1: Build Home** — three regions:
  - Quick-start row: four `Button`s (Capture Area / Window / Fullscreen / Record) with Lucide icons; onClick → `pushToast("Capture lands in Phase 2")` for now.
  - Recent captures: `EmptyState` (icon `ImageOff`, "No captures yet", hint "Your screenshots and recordings will appear here").
  - Hotkeys-at-a-glance: a `Card` listing the five hotkeys from settings as `kbd` chips.

- [ ] **Step 2: Listen for tray placeholder actions** — `listen("tray-action", e => pushToast(...))` so tray Capture items toast too.

- [ ] **Step 3: Verify** — `npm run tauri dev`: Home renders polished; buttons toast; hotkeys display from settings.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/Home.tsx glint/src/views/home.css && git commit -m "feat: Home view"
```

---

## Task 10: Library view shell (reads SQLite)

**Files:**
- Create: `glint/src/views/Library.tsx`, `glint/src/views/library.css`
- Modify: `glint/src/lib/ipc.ts` (add `loadCaptures()`)

**Interfaces:**
- Consumes: `@tauri-apps/plugin-sql` `Database.load("sqlite:glint.db")`.
- Produces: `ipc.loadCaptures(): Promise<CaptureRow[]>` selecting non-deleted captures.

- [ ] **Step 1: `ipc.loadCaptures`**

```ts
import Database from "@tauri-apps/plugin-sql";
let dbP: Promise<Database> | null = null;
const db = () => (dbP ??= Database.load("sqlite:glint.db"));
export interface CaptureRow { id:number; kind:string; path:string; thumb_path:string|null;
  width:number|null; height:number|null; duration_ms:number|null; bytes:number|null;
  created_at:number; }
export async function loadCaptures(): Promise<CaptureRow[]> {
  return (await db()).select<CaptureRow[]>(
    "SELECT * FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC");
}
```

- [ ] **Step 2: Library view** — filter/search bar (inert input + kind filter `Select`), a responsive grid, and an `EmptyState` when `loadCaptures()` returns `[]` (it will in P1). Proves the DB read path works end-to-end.

- [ ] **Step 3: Verify** — `npm run tauri dev`: Library shows the empty state with no SQL errors in console.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/Library.tsx glint/src/views/library.css glint/src/lib/ipc.ts && git commit -m "feat: Library view shell reading SQLite"
```

---

## Task 11: Settings view + Appearance theme persisted end-to-end

**Files:**
- Create: `glint/src/views/Settings.tsx` + `glint/src/views/settings/*.tsx`
- Modify: `glint/src/lib/ipc.ts` (add `saveSetting`, `loadSetting`)
- Modify: `glint/src/store/useAppStore.ts` (persist on setTheme; hydrate on load)

**Interfaces:**
- Produces: `ipc.saveSetting(key,value)` / `ipc.loadSetting(key)` backed by the `settings` table; theme survives restart.

- [ ] **Step 1: Settings persistence in `ipc.ts`**

```ts
export async function saveSetting(key: string, value: unknown) {
  await (await db()).execute(
    "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",
    [key, JSON.stringify(value)]);
}
export async function loadSetting<T>(key: string): Promise<T | null> {
  const r = await (await db()).select<{value:string}[]>(
    "SELECT value FROM settings WHERE key=$1", [key]);
  return r.length ? JSON.parse(r[0].value) as T : null;
}
```

- [ ] **Step 2: Hydrate + persist theme** — in `loadSettings()`, after `invoke("settings_get_all")`, override theme from `loadSetting("theme")` if present; in `setTheme()` call `saveSetting("theme", theme)`.

- [ ] **Step 3: Settings shell** — left sub-nav (General / Capture / Recording / Auto-save / Hotkeys / Appearance / Storage) + right panel via nested routes or local state. **Appearance** has a working theme `Select` (Dark/Light/System) and an accent swatch row (sets `--accent`, persisted). Other sections render their `Section`/`Field` controls but may be inert with a subtle "Configured in a later phase" note where truly non-functional — keep it honest, not fake.

- [ ] **Step 4: Verify persistence (the P1 proof)** — `npm run tauri dev`, set theme to Light, fully **quit via tray and relaunch** → app reopens in Light. Set back to Dark.

- [ ] **Step 5: Commit**

```bash
git add glint/src && git commit -m "feat: Settings view + theme persisted across restart"
```

---

## Task 12: Global shortcuts plumbing + toast

**Files:**
- Create: `glint/src-tauri/src/shortcuts.rs`
- Modify: `glint/src-tauri/src/lib.rs`, `Cargo.toml`, `package.json`

**Interfaces:**
- Consumes: `SettingsState`, `window::focus_main`.
- Produces: registered global shortcuts from `settings.hotkeys`; on trigger emits `shortcut-fired` with the action name (P1 handler: focus app + toast; real capture in P2).

- [ ] **Step 1: Add plugin**

```bash
cd glint/src-tauri && cargo add tauri-plugin-global-shortcut
cd .. && npm add @tauri-apps/plugin-global-shortcut
```

- [ ] **Step 2: `shortcuts.rs`** — register the five hotkeys; handler matches the shortcut → `app.emit("shortcut-fired", action)` and `window::focus_main`. Guard against registration errors (log + continue; a conflicting hotkey must not crash startup).

- [ ] **Step 3: Frontend** — in App root, `listen("shortcut-fired", e => pushToast(\`Hotkey: ${e.payload}\`))`.

- [ ] **Step 4: Verify** — `npm run tauri dev`: press `Ctrl+Shift+1` from another app → Glint focuses and toasts "Hotkey: capture_area".

- [ ] **Step 5: Commit**

```bash
git add glint && git commit -m "feat: global shortcut plumbing + toast feedback"
```

---

## Task 13: Rotating logs

**Files:**
- Modify: `glint/src-tauri/src/lib.rs`, `Cargo.toml`

- [ ] **Step 1: Add plugin** — `cargo add tauri-plugin-log`.

- [ ] **Step 2: Register** with a file target in the app log dir, level Info, rotation by size:

```rust
.plugin(
  tauri_plugin_log::Builder::new()
    .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("glint".into()) }))
    .level(log::LevelFilter::Info)
    .build(),
)
```

- [ ] **Step 3: Verify** — run dev, confirm a `glint*.log` appears under `%APPDATA%\com.glint.app\logs`.

- [ ] **Step 4: Commit** — `git commit -m "feat: rotating file logs"`.

---

## Task 14: P1 acceptance pass

- [ ] **Step 1:** Run the full Rust test suite: `cd glint/src-tauri && cargo test` → all pass.
- [ ] **Step 2:** `cargo clippy --all-targets` → no warnings (fix any).
- [ ] **Step 3:** Manual success-criteria walkthrough: tray ✓, borderless window ✓, nav routes ✓, theme persists across restart ✓, global hotkey toasts ✓, logs written ✓, UI visibly polished ✓.
- [ ] **Step 4:** Update `docs/` with a short P1 "done" note; commit `chore: Phase 1 app shell complete`.

---

## Self-Review notes
- **Spec coverage:** scaffold (T1) · identity/window/single-instance (T2) · tray + close-to-tray (T3) · SQLite+migrations (T4) · settings service+tests (T5) · tokens/store/router (T6) · primitives (T7) · titlebar+rail (T8) · Home (T9) · Library reads SQLite (T10) · Settings + theme persistence (T11) · global shortcuts (T12) · logging (T13) · tests/clippy/acceptance (T14). All P1 spec items mapped.
- **Honesty rule:** inert settings sections must say so rather than fake functionality (T11 Step 3).
- **Design bar:** frontend-design skill is mandatory in T6/T7/T8 — that is where "not default-looking" is won.
