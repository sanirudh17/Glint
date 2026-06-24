# Glint Phase 5c — `.glint` Document Save/Load — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the editor document (annotations + crop + frame + embedded base image) to a portable `.glint` file and reopen it for further editing, with Save=project / Export=PNG, a dirty indicator, and a Recent Projects list on Home.

**Architecture:** A versioned JSON `.glint` file (`{glint:1, app, image:{…,dataBase64}, doc}`) is **assembled and parsed entirely in Rust**, so the large base-image bytes never cross the IPC bridge (they already live in `EditorState.png`). The frontend sends/receives only the small opaque `doc` JSON. Opening sets `EditorState` (reusing the existing `editor_source` load path) and the editor hydrates atomically via a new `loadDoc` store action. Native Open/Save dialogs come from `tauri-plugin-dialog` (frontend-invoked). Recent Projects reuse the existing plugin-sql `settings` table.

**Tech Stack:** Tauri v2 (Rust) · React 19 + TypeScript 5.8 · Zustand 5 · Vitest 3 · `tauri-plugin-dialog` v2 · serde_json · base64.

## Global Constraints

- **Local-first.** No cloud/network/uploads/accounts. `.glint` is an ordinary local file; the only new dependency is `tauri-plugin-dialog` (local OS dialogs).
- **Single-user / no-auth.** No login/permissions/ownership in the file.
- **Recorder isolation.** Editor path only — zero ffmpeg/scap/recorder coupling. Do not touch the recorder.
- **Non-destructive.** Opening + re-saving a `.glint` never mutates the original Library capture; the `.glint` is self-contained (image embedded).
- **`doc` is opaque to Rust.** Rust treats `doc` as a pass-through `serde_json::Value`; only the frontend knows the annotation/crop/frame shapes.
- **Format version:** `glint: 1` (integer). Reject `glint > 1` with a friendly error.
- **Recent Projects cap:** 8, newest-first, de-duplicated by path.
- **Copy rules:** the existing primary PNG button is relabeled **Export** (Rust command name `editor_save` unchanged). New project actions are **Save** / **Save As** / **Open project…**. Shortcuts: `Ctrl+S` = Save, `Ctrl+Shift+S` = Save As.
- **Visible feedback:** every save/open gives an immediate status flash or toast; the dirty `•` shows in the custom titlebar (the window is borderless — no OS title bar is visible). Never silent.
- **Branch:** `phase-5c-glint-document` (off `master` @ `b0edbd6`).

---

### Task 1: Rust `.glint` format module

**Files:**
- Create: `glint/src-tauri/src/editor/document.rs`
- Modify: `glint/src-tauri/src/editor/mod.rs` (add `pub mod document;`)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `pub const GLINT_VERSION: u64 = 1;`
  - `pub struct ParsedGlint { pub png: Vec<u8>, pub width: u32, pub height: u32, pub doc: serde_json::Value }`
  - `pub fn assemble(png: &[u8], width: u32, height: u32, doc: serde_json::Value, app_version: &str) -> Result<String, String>`
  - `pub fn parse(text: &str) -> Result<ParsedGlint, String>`

- [ ] **Step 1: Write the failing tests**

Create `glint/src-tauri/src/editor/document.rs`:

```rust
//! The `.glint` document format: a versioned, self-contained JSON file holding
//! the embedded base image plus an OPAQUE `doc` (the frontend's annotations +
//! crop + frame). Rust never parses `doc` — it round-trips it as a JSON value.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Current `.glint` format version. Bump only on a breaking change.
pub const GLINT_VERSION: u64 = 1;

#[derive(Serialize, Deserialize)]
struct GlintImage {
    mime: String,
    width: u32,
    height: u32,
    #[serde(rename = "dataBase64")]
    data_base64: String,
}

#[derive(Serialize, Deserialize)]
struct GlintFile {
    glint: u64,
    app: String,
    image: GlintImage,
    doc: Value,
}

/// Parsed `.glint`: decoded image bytes + the opaque doc value.
pub struct ParsedGlint {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub doc: Value,
}

/// Build the `.glint` JSON text from raw PNG bytes + the opaque doc.
pub fn assemble(
    png: &[u8],
    width: u32,
    height: u32,
    doc: Value,
    app_version: &str,
) -> Result<String, String> {
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(png);
    let file = GlintFile {
        glint: GLINT_VERSION,
        app: app_version.to_string(),
        image: GlintImage { mime: "image/png".into(), width, height, data_base64 },
        doc,
    };
    serde_json::to_string(&file).map_err(|e| e.to_string())
}

/// Parse `.glint` JSON text → image bytes + opaque doc. Rejects unknown versions
/// and malformed input with a user-facing message.
pub fn parse(text: &str) -> Result<ParsedGlint, String> {
    let file: GlintFile = serde_json::from_str(text)
        .map_err(|_| "Couldn't open this project — the file is not a valid Glint project.".to_string())?;
    if file.glint > GLINT_VERSION {
        return Err("This project was made with a newer version of Glint.".to_string());
    }
    let png = base64::engine::general_purpose::STANDARD
        .decode(file.image.data_base64.as_bytes())
        .map_err(|_| "Couldn't open this project — the embedded image is corrupt.".to_string())?;
    Ok(ParsedGlint { png, width: file.image.width, height: file.image.height, doc: file.doc })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_image_and_doc() {
        let png = vec![1u8, 2, 3, 4, 5];
        let doc = json!({ "annotations": [{ "id": "a1" }], "crop": null, "frame": { "enabled": true } });
        let text = assemble(&png, 320, 240, doc.clone(), "0.1.0").unwrap();
        let parsed = parse(&text).unwrap();
        assert_eq!(parsed.png, png);
        assert_eq!(parsed.width, 320);
        assert_eq!(parsed.height, 240);
        assert_eq!(parsed.doc, doc); // opaque value preserved verbatim
    }

    #[test]
    fn rejects_newer_version() {
        let text = r#"{"glint":2,"app":"x","image":{"mime":"image/png","width":1,"height":1,"dataBase64":"AAEC"},"doc":{}}"#;
        assert!(parse(text).is_err());
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse("not json at all").is_err());
    }

    #[test]
    fn rejects_bad_base64() {
        let text = r#"{"glint":1,"app":"x","image":{"mime":"image/png","width":1,"height":1,"dataBase64":"!!!notbase64!!!"},"doc":{}}"#;
        assert!(parse(text).is_err());
    }
}
```

- [ ] **Step 2: Wire the module**

In `glint/src-tauri/src/editor/mod.rs`, add after the existing `pub mod commands;` line:

```rust
pub mod document;
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd glint/src-tauri && cargo test editor::document`
Expected: 4 tests pass (`round_trips_image_and_doc`, `rejects_newer_version`, `rejects_malformed_json`, `rejects_bad_base64`).

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/editor/document.rs glint/src-tauri/src/editor/mod.rs
git commit -m "feat(p5c): .glint document format module (assemble/parse + version gate)"
```

---

### Task 2: Extend `EditorSource` + `editor_source` with `doc` and `project_path`

**Files:**
- Modify: `glint/src-tauri/src/editor/mod.rs` (struct fields)
- Modify: `glint/src-tauri/src/editor/commands.rs` (DTO + all `EditorSource { … }` constructors + `editor_source`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `EditorSource` now has `pub doc: Option<serde_json::Value>` and `pub project_path: Option<String>`.
  - `EditorSourceDto` now serializes `doc: Option<serde_json::Value>` and `project_path: Option<String>` (camelCase via serde stays snake by default — the frontend already maps `image_data_url`→`imageDataUrl`, so keep snake_case field names `doc` and `project_path`).

This is a refactor-only task (no behavior change for existing entry points); its gate is "compiles + existing tests green".

- [ ] **Step 1: Add the struct fields**

In `glint/src-tauri/src/editor/mod.rs`, extend `EditorSource`:

```rust
#[derive(Clone)]
pub struct EditorSource {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// "hud" | "library" | "capture" | "project" — informational for the frontend.
    pub origin: String,
    pub capture_id: Option<i64>,
    /// Present only when opened from a `.glint` project — the opaque editor doc.
    pub doc: Option<serde_json::Value>,
    /// The `.glint` path this session was opened from / last saved to (for silent Ctrl+S).
    pub project_path: Option<String>,
}
```

- [ ] **Step 2: Update the DTO and all constructors**

In `glint/src-tauri/src/editor/commands.rs`:

Extend the DTO:

```rust
#[derive(Serialize)]
pub struct EditorSourceDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub origin: String,
    pub capture_id: Option<i64>,
    pub doc: Option<serde_json::Value>,
    pub project_path: Option<String>,
}
```

In `editor_open_from_last`, the `EditorSource { … }` literal becomes:

```rust
    *ed.0.lock().unwrap() = Some(EditorSource {
        png,
        width,
        height,
        origin: "hud".into(),
        capture_id: None,
        doc: None,
        project_path: None,
    });
```

In `editor_open_capture`, the `EditorSource { … }` literal becomes:

```rust
    *ed.0.lock().unwrap() = Some(EditorSource {
        png: bytes,
        width,
        height,
        origin: "library".into(),
        capture_id: Some(id),
        doc: None,
        project_path: None,
    });
```

In `editor_source`, return the new fields:

```rust
    Ok(EditorSourceDto {
        image_data_url: format!("data:image/png;base64,{b64}"),
        width: s.width,
        height: s.height,
        origin: s.origin.clone(),
        capture_id: s.capture_id,
        doc: s.doc.clone(),
        project_path: s.project_path.clone(),
    })
```

- [ ] **Step 3: Verify it compiles and existing tests pass**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: build succeeds; all existing tests pass (no test count change).

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/editor/mod.rs glint/src-tauri/src/editor/commands.rs
git commit -m "feat(p5c): EditorSource + editor_source carry optional doc + project_path"
```

---

### Task 3: Rust `project_save` / `project_open` / `projects_resolve` commands + dialog plugin

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `tauri-plugin-dialog`)
- Modify: `glint/src-tauri/src/editor/commands.rs` (new commands)
- Modify: `glint/src-tauri/src/lib.rs` (register plugin + 3 commands)
- Modify: `glint/src-tauri/capabilities/default.json` (dialog permission)

**Interfaces:**
- Consumes: `editor::document::{assemble, parse, ParsedGlint}` (Task 1); `EditorSource`/`EditorState` (Task 2); existing `open_editor_window`.
- Produces (Tauri commands):
  - `project_save(app, ed, doc: serde_json::Value, path: String) -> Result<String, String>` — returns the saved path.
  - `project_open(app, ed, path: String) -> Result<(), String>` — sets `EditorState`, shows editor window.
  - `projects_resolve(paths: Vec<String>) -> Vec<RecentProjectDto>` where `RecentProjectDto { path: String, name: String, exists: bool }`.

- [ ] **Step 1: Add the dialog plugin dependency**

In `glint/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Add the commands**

In `glint/src-tauri/src/editor/commands.rs`, add near the top with the other `use`s:

```rust
use crate::editor::document;
```

Append these commands to the file:

```rust
// ─── Project (.glint) save/load ──────────────────────────────────────────────

/// Save the current editor document to a `.glint` file. The frontend supplies
/// the opaque `doc` (annotations + crop + frame) and the destination path (chosen
/// via the OS dialog). The base image is read from EditorState, so its bytes never
/// cross the IPC bridge as part of this call.
#[tauri::command]
pub fn project_save(
    app: AppHandle,
    ed: State<EditorState>,
    doc: serde_json::Value,
    path: String,
) -> Result<String, String> {
    // Ensure a .glint extension (the dialog usually adds it, but be defensive).
    let mut dest = std::path::PathBuf::from(&path);
    if dest.extension().and_then(|e| e.to_str()) != Some("glint") {
        dest.set_extension("glint");
    }

    let text = {
        let mut guard = ed.0.lock().unwrap();
        let s = guard.as_mut().ok_or("no editor source")?;
        let app_version = app.package_info().version.to_string();
        let text = document::assemble(&s.png, s.width, s.height, doc, &app_version)?;
        // Remember the path so the next Ctrl+S overwrites silently.
        s.project_path = Some(dest.to_string_lossy().to_string());
        text
    };

    std::fs::write(&dest, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// Open a `.glint` file into the editor: parse it, set EditorState (origin
/// "project", carrying the opaque doc + path), then show/focus the editor window.
#[tauri::command]
pub fn project_open(app: AppHandle, ed: State<EditorState>, path: String) -> Result<(), String> {
    let text = std::fs::read_to_string(&path)
        .map_err(|_| "Couldn't open this project — the file could not be read.".to_string())?;
    let parsed = document::parse(&text)?;
    *ed.0.lock().unwrap() = Some(EditorSource {
        png: parsed.png,
        width: parsed.width,
        height: parsed.height,
        origin: "project".into(),
        capture_id: None,
        doc: Some(parsed.doc),
        project_path: Some(path),
    });
    open_editor_window(&app);
    Ok(())
}

#[derive(Serialize)]
pub struct RecentProjectDto {
    pub path: String,
    pub name: String,
    pub exists: bool,
}

/// Resolve a list of `.glint` paths into display rows: basename + on-disk check.
/// Lets the frontend grey/prune stale entries without a filesystem plugin.
#[tauri::command]
pub fn projects_resolve(paths: Vec<String>) -> Vec<RecentProjectDto> {
    paths
        .into_iter()
        .map(|p| {
            let name = std::path::Path::new(&p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let exists = std::path::Path::new(&p).is_file();
            RecentProjectDto { path: p, name, exists }
        })
        .collect()
}
```

- [ ] **Step 3: Register the plugin and commands**

In `glint/src-tauri/src/lib.rs`, extend the editor import:

```rust
use editor::commands::{
    editor_copy, editor_flatten_temp, editor_open_capture, editor_open_from_last, editor_save,
    editor_source, project_open, project_save, projects_resolve,
};
```

Register the plugin (add after the `.plugin(tauri_plugin_drag::init())` line):

```rust
        .plugin(tauri_plugin_dialog::init())
```

Add the three commands to the `tauri::generate_handler![ … ]` list (after `editor_flatten_temp,`):

```rust
            project_save,
            project_open,
            projects_resolve,
```

- [ ] **Step 4: Grant the dialog permission**

In `glint/src-tauri/capabilities/default.json`, add `"dialog:default"` to the `permissions` array (after `"drag:default"`):

```json
    "drag:default",
    "dialog:default"
```

- [ ] **Step 5: Verify it builds and tests pass**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: build succeeds (new plugin compiles); all tests pass.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/editor/commands.rs glint/src-tauri/src/lib.rs glint/src-tauri/capabilities/default.json
git commit -m "feat(p5c): project_save/open/resolve commands + tauri-plugin-dialog"
```

---

### Task 4: Frontend IPC wrappers, types, and recent-projects helpers

**Files:**
- Modify: `glint/package.json` (add `@tauri-apps/plugin-dialog`)
- Modify: `glint/src/lib/editor.ts` (types + wrappers + recent helpers)

**Interfaces:**
- Consumes: Rust `project_save`/`project_open`/`projects_resolve` (Task 3); `persistSetting`/`readSetting` from `../lib/ipc`.
- Produces (exports from `lib/editor.ts`):
  - `interface EditorSource { …; doc: unknown | null; projectPath: string | null }`
  - `interface RecentProject { path: string; name: string; exists: boolean }`
  - `saveProject(doc: unknown, path: string): Promise<string>`
  - `openProject(path: string): Promise<void>`
  - `pickSavePath(defaultName: string): Promise<string | null>`
  - `pickOpenPath(): Promise<string | null>`
  - `pushRecentProject(path: string): Promise<void>`
  - `getRecentProjects(): Promise<RecentProject[]>`

- [ ] **Step 1: Add the dialog npm package**

In `glint/package.json`, under `dependencies`, add (keep alphabetical near the other `@tauri-apps` entries):

```json
    "@tauri-apps/plugin-dialog": "^2",
```

Then install:

Run: `cd glint && npm install`
Expected: `@tauri-apps/plugin-dialog` added to `node_modules` and `package-lock.json`.

- [ ] **Step 2: Extend `lib/editor.ts`**

In `glint/src/lib/editor.ts`, update the imports and add the new surface. Replace the top import block and `EditorSource`/`RawEditorSource` with:

```ts
/**
 * editor.ts — typed wrappers for the annotation editor's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin + dialog plugin.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { persistSetting, readSetting } from "./ipc";
export { dragOut } from "./hudIpc";

const RECENT_KEY = "recent_projects";
const RECENT_CAP = 8;

export interface EditorSource {
  imageDataUrl: string;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
  doc: unknown | null;
  projectPath: string | null;
}

interface RawEditorSource {
  image_data_url: string;
  width: number;
  height: number;
  origin: string;
  capture_id: number | null;
  doc: unknown | null;
  project_path: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  exists: boolean;
}
```

Update `getEditorSource` to map the two new fields:

```ts
export async function getEditorSource(): Promise<EditorSource> {
  const d = await invoke<RawEditorSource>("editor_source");
  return {
    imageDataUrl: d.image_data_url,
    width: d.width,
    height: d.height,
    origin: d.origin,
    captureId: d.capture_id,
    doc: d.doc,
    projectPath: d.project_path,
  };
}
```

Append the new wrappers + recent helpers at the end of the file:

```ts
// ─── Project (.glint) save/load ──────────────────────────────────────────────

const GLINT_FILTER = [{ name: "Glint Project", extensions: ["glint"] }];

/** Native Save dialog → chosen `.glint` path (or null if cancelled). */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  const path = await saveDialog({ filters: GLINT_FILTER, defaultPath: defaultName });
  return path ?? null;
}

/** Native Open dialog → chosen `.glint` path (or null if cancelled). */
export async function pickOpenPath(): Promise<string | null> {
  const path = await openDialog({ filters: GLINT_FILTER, multiple: false, directory: false });
  return typeof path === "string" ? path : null;
}

/** Write the document to a `.glint` at `path`; returns the actual saved path. */
export const saveProject = (doc: unknown, path: string): Promise<string> =>
  invoke<string>("project_save", { doc, path });

/** Open a `.glint`; Rust sets the editor source and shows the editor window. */
export const openProject = (path: string): Promise<void> =>
  invoke<void>("project_open", { path });

// ─── Recent projects (persisted in the plugin-sql `settings` table) ───────────

/** Prepend a path to the recent list (dedup, cap), persisting via settings. */
export async function pushRecentProject(path: string): Promise<void> {
  const list = (await readSetting<string[]>(RECENT_KEY)) ?? [];
  const next = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_CAP);
  await persistSetting(RECENT_KEY, next);
}

/** Read the recent list and resolve each path's basename + on-disk status. */
export async function getRecentProjects(): Promise<RecentProject[]> {
  const list = (await readSetting<string[]>(RECENT_KEY)) ?? [];
  if (list.length === 0) return [];
  return invoke<RecentProject[]>("projects_resolve", { paths: list });
}
```

- [ ] **Step 3: Verify the frontend typechecks**

Run: `cd glint && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add glint/package.json glint/package-lock.json glint/src/lib/editor.ts
git commit -m "feat(p5c): frontend project IPC wrappers + recent-projects helpers"
```

---

### Task 5: Store — `loadDoc`, dirty tracking, project metadata

**Files:**
- Modify: `glint/src/editor/useEditorStore.ts`
- Test: `glint/src/editor/useEditorStore.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Consumes: `Annotation`, `Crop`, `FrameConfig`, `freshFrame`, `DEFAULT_FRAME` (existing in this file).
- Produces:
  - `export interface SerializedDoc { annotations: Annotation[]; crop: Crop | null; frame: FrameConfig }`
  - New state: `projectPath: string | null`, `projectName: string | null`, `dirty: boolean`.
  - `loadDoc(base: EditorBase, doc: SerializedDoc | null, project: { path: string; name: string } | null): void` — atomic hydrate: sets base + annotations + crop + frame + project metadata, clears history, `dirty = false`.
  - `markSaved(path: string, name: string): void` — sets project metadata + `dirty = false` after a successful save.
  - All mutating actions set `dirty = true`.

- [ ] **Step 1: Write the failing tests**

Create/append `glint/src/editor/useEditorStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore, DEFAULT_FRAME } from "./useEditorStore";
import type { EditorBase } from "./useEditorStore";

const fakeBase = (): EditorBase => ({
  image: {} as HTMLImageElement,
  width: 100,
  height: 80,
  origin: "project",
  captureId: null,
});

const sampleAnno = () =>
  ({ id: "a1", type: "rect", x: 1, y: 2, w: 3, h: 4, style: {} }) as never;

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe("loadDoc", () => {
  it("hydrates annotations + crop + frame atomically and clears history + dirty", () => {
    const s = useEditorStore.getState();
    // dirty the store first so we can prove loadDoc clears it
    s.pushHistory();
    s.add(sampleAnno());
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(useEditorStore.getState().past.length).toBe(1);

    useEditorStore.getState().loadDoc(
      fakeBase(),
      {
        annotations: [sampleAnno()],
        crop: { x: 0, y: 0, w: 50, h: 40 },
        frame: { ...DEFAULT_FRAME, enabled: true },
      },
      { path: "C:/x/My Shot.glint", name: "My Shot.glint" },
    );

    const after = useEditorStore.getState();
    expect(after.annotations.length).toBe(1);
    expect(after.crop).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(after.frame.enabled).toBe(true);
    expect(after.past.length).toBe(0);
    expect(after.future.length).toBe(0);
    expect(after.projectPath).toBe("C:/x/My Shot.glint");
    expect(after.projectName).toBe("My Shot.glint");
    expect(after.dirty).toBe(false);
  });

  it("with null doc + null project loads a clean empty session", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    const after = useEditorStore.getState();
    expect(after.annotations).toEqual([]);
    expect(after.crop).toBeNull();
    expect(after.frame).toEqual(DEFAULT_FRAME);
    expect(after.projectPath).toBeNull();
    expect(after.projectName).toBeNull();
    expect(after.dirty).toBe(false);
  });
});

describe("dirty tracking", () => {
  it("flips dirty on a document mutation", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    expect(useEditorStore.getState().dirty).toBe(false);
    useEditorStore.getState().add(sampleAnno());
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("does NOT flip dirty on setTool or select", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    useEditorStore.getState().setTool("rect");
    useEditorStore.getState().select("a1");
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("markSaved clears dirty and records the path/name", () => {
    useEditorStore.getState().loadDoc(fakeBase(), null, null);
    useEditorStore.getState().add(sampleAnno());
    useEditorStore.getState().markSaved("C:/x/Saved.glint", "Saved.glint");
    const after = useEditorStore.getState();
    expect(after.dirty).toBe(false);
    expect(after.projectPath).toBe("C:/x/Saved.glint");
    expect(after.projectName).toBe("Saved.glint");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: FAIL — `loadDoc`, `markSaved`, `dirty`, `projectPath`, `projectName` do not exist yet.

- [ ] **Step 3: Implement the store changes**

In `glint/src/editor/useEditorStore.ts`:

Add the `SerializedDoc` export near the `DocSnapshot` interface:

```ts
/** The serializable editor document persisted to / loaded from a `.glint` file. */
export interface SerializedDoc {
  annotations: Annotation[];
  crop: Crop | null;
  frame: FrameConfig;
}
```

Add the three fields to the `EditorState` interface (after `future`):

```ts
  projectPath: string | null;
  projectName: string | null;
  dirty: boolean;
```

Add the three action signatures to the `EditorState` interface (after `setBase`):

```ts
  loadDoc: (
    base: EditorBase,
    doc: SerializedDoc | null,
    project: { path: string; name: string } | null,
  ) => void;
  markSaved: (path: string, name: string) => void;
```

Add the three fields to the `INITIAL` object:

```ts
  projectPath: null as string | null,
  projectName: null as string | null,
  dirty: false,
```

Add a frame-merge helper next to `freshFrame`:

```ts
/** Merge a loaded frame over defaults so a partial/legacy doc still hydrates safely. */
const mergeFrame = (f: FrameConfig | undefined): FrameConfig =>
  f
    ? { ...DEFAULT_FRAME, ...f, background: f.background ? { ...f.background } : { ...DEFAULT_FRAME.background } }
    : freshFrame();
```

Implement `loadDoc` and `markSaved` (place after `setBase`):

```ts
  loadDoc: (base, doc, project) =>
    set({
      base,
      annotations: doc?.annotations ?? [],
      crop: doc?.crop ?? null,
      frame: mergeFrame(doc?.frame),
      past: [],
      future: [],
      selectedId: null,
      projectPath: project?.path ?? null,
      projectName: project?.name ?? null,
      dirty: false,
    }),

  markSaved: (path, name) => set({ projectPath: path, projectName: name, dirty: false }),
```

Set `dirty: true` in every document-mutating action. Update these existing actions:

```ts
  add: (a) => set((s) => ({ annotations: addAnnotation(s.annotations, a), selectedId: a.id, dirty: true })),
  update: (id, patch) => set((s) => ({ annotations: updateAnnotation(s.annotations, id, patch), dirty: true })),
  remove: (id) =>
    set((s) => ({
      annotations: deleteAnnotation(s.annotations, id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      dirty: true,
    })),
```

In `clearAll`, add `dirty: true` to the truthy branch object:

```ts
  clearAll: () =>
    set((s) =>
      s.annotations.length
        ? { past: [...s.past, { annotations: s.annotations, crop: s.crop }], future: [], annotations: [], selectedId: null, dirty: true }
        : s,
    ),
```

In `setCrop`, `resetCrop`, `setFrame`, `toggleFrame`, `resetFrame`, add `dirty: true`:

```ts
  setCrop: (c) => set({ crop: c, dirty: true }),
  resetCrop: () => set({ crop: null, dirty: true }),

  setFrame: (patch) => set((s) => ({ frame: { ...s.frame, ...patch }, dirty: true })),
  toggleFrame: (on) => set((s) => ({ frame: { ...s.frame, enabled: on ?? !s.frame.enabled }, dirty: true })),
  resetFrame: () => set({ frame: freshFrame(), dirty: true }),
```

In `undo` and `redo`, add `dirty: true` to the returned snapshot object (the branch where history exists):

```ts
  undo: () =>
    set((s) =>
      s.past.length
        ? {
            ...s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [{ annotations: s.annotations, crop: s.crop }, ...s.future],
            selectedId: null,
            dirty: true,
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            ...s.future[0],
            future: s.future.slice(1),
            past: [...s.past, { annotations: s.annotations, crop: s.crop }],
            selectedId: null,
            dirty: true,
          }
        : s,
    ),
```

Update `reset` to also clear the new metadata (it spreads `INITIAL`, which now includes the three fields, so this already holds — verify the `reset` line keeps `...INITIAL`):

```ts
  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE }, frame: freshFrame() }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd glint && npx vitest run src/editor/useEditorStore.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p5c): store loadDoc + dirty tracking + project metadata"
```

---

### Task 6: EditorView — hydrate via `loadDoc`, reload on `editor-open`, save shortcuts, OS title

**Files:**
- Modify: `glint/src/views/EditorView.tsx`

**Interfaces:**
- Consumes: `getEditorSource`, `saveProject`, `pickSavePath`, `pushRecentProject` (Task 4); `loadDoc`, `markSaved`, store `dirty`/`projectPath`/`projectName` (Task 5); `getCurrentWindow` (`@tauri-apps/api/window`); `listen` (`@tauri-apps/api/event`).
- Produces: a reusable `saveCurrentProject(asNew: boolean)` flow shared by the keyboard shortcuts and (Task 7) the ProjectBar buttons — exposed via the store is unnecessary; this task wires shortcuts, Task 7 wires buttons calling the same lib functions.

- [ ] **Step 1: Replace the source-loading effect with a reusable loader + reload listener**

In `glint/src/views/EditorView.tsx`, update the imports:

```tsx
import { useCallback, useEffect, useRef } from "react";
import type Konva from "konva";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Frame as FrameIcon } from "lucide-react";
import { useEditorStore } from "../editor/useEditorStore";
import type { SerializedDoc } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import { ToolRail } from "./editor/ToolRail";
import { StyleBar } from "./editor/StyleBar";
import { ExportBar } from "./editor/ExportBar";
import { ProjectBar } from "./editor/ProjectBar";
import { FramePanel } from "./editor/FramePanel";
import type { ToolId } from "../editor/model";
import "./editor/editor.css";
```

Replace the existing `setBase`/`reset` selectors and the source-loading `useEffect` with a `loadDoc`-based loader. Replace these lines:

```tsx
  const base = useEditorStore((s) => s.base);
  const setBase = useEditorStore((s) => s.setBase);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);
```

with:

```tsx
  const base = useEditorStore((s) => s.base);
  const loadDoc = useEditorStore((s) => s.loadDoc);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);
```

Replace the entire source-loading `useEffect` (the one calling `getEditorSource().then(...)`) with a reusable callback plus mount + event subscription:

```tsx
  // Load (or reload) the editor source from EditorState. Used on mount AND when
  // a `.glint` is opened while the editor is already mounted (editor-open fires
  // but the route doesn't remount). loadDoc hydrates base + doc atomically.
  const loadFromSource = useCallback(() => {
    let alive = true;
    getEditorSource()
      .then((src) => {
        const img = new Image();
        img.onload = () => {
          if (!alive) return;
          const project = src.projectPath
            ? { path: src.projectPath, name: src.projectPath.split(/[\\/]/).pop() ?? src.projectPath }
            : null;
          loadDoc(
            { image: img, width: src.width, height: src.height, origin: src.origin, captureId: src.captureId },
            (src.doc as SerializedDoc | null) ?? null,
            project,
          );
        };
        img.src = src.imageDataUrl;
      })
      .catch(() => {
        /* no source (navigated here directly) — show empty state */
      });
    return () => {
      alive = false;
    };
  }, [loadDoc]);

  useEffect(() => {
    const cancel = loadFromSource();
    return () => {
      cancel();
      reset();
    };
  }, [loadFromSource, reset]);

  // Reopen path: project_open emits editor-open after setting EditorState; if we
  // are already on /editor the route won't remount, so reload here.
  useEffect(() => {
    const p = listen("editor-open", () => loadFromSource());
    return () => { p.then((un) => un()); };
  }, [loadFromSource]);
```

- [ ] **Step 2: Drive the OS window title from project name + dirty**

Add, after the selectors block, the title-sync effect (the visible chrome indicator is Task 8; this sets the OS taskbar/alt-tab title):

```tsx
  const projectName = useEditorStore((s) => s.projectName);
  const dirty = useEditorStore((s) => s.dirty);

  useEffect(() => {
    const label = projectName ?? "Untitled";
    getCurrentWindow().setTitle(`Glint — ${dirty ? "•" : ""}${label}`).catch(() => {});
    return () => { getCurrentWindow().setTitle("Glint").catch(() => {}); };
  }, [projectName, dirty]);
```

- [ ] **Step 3: Add Ctrl+S / Ctrl+Shift+S handlers to the keydown effect**

In the existing keyboard `useEffect`, inside `onKey`, add — right after the INPUT/TEXTAREA guard and before the Ctrl+Z block:

```tsx
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("glint:save-project", { detail: { asNew: e.shiftKey } }));
        return;
      }
```

(The ProjectBar in Task 7 owns the actual save flow and listens for `glint:save-project`, keeping a single save implementation. This avoids duplicating the dialog/persist logic in two components.)

- [ ] **Step 4: Mount the ProjectBar in the top bar**

In the returned JSX, change the top bar so ProjectBar sits at the far left:

```tsx
      <div className="editor-topbar">
        <ProjectBar />
        <StyleBar />
        <div className="editor-frame-slot">
          <button
            className={`editor-export-btn${frameEnabled ? " editor-export-btn--primary" : ""}`}
            onClick={() => toggleFrame()}
            title="Frame & background"
            aria-pressed={frameEnabled}
          >
            <FrameIcon size={16} strokeWidth={1.75} /> Frame
          </button>
        </div>
        <ExportBar stageRef={stageRef} />
      </div>
```

- [ ] **Step 5: Verify typecheck (ProjectBar created in Task 7 — expect a missing-module error here only if run before Task 7)**

Run: `cd glint && npx tsc --noEmit`
Expected: the only error (if any) is the not-yet-created `./editor/ProjectBar` import — resolved by Task 7. All other code typechecks. (If executing strictly in order, do Task 7 before re-running tsc.)

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/EditorView.tsx
git commit -m "feat(p5c): EditorView hydrates via loadDoc, reloads on open, save shortcuts, OS title"
```

---

### Task 7: ProjectBar + ExportBar relabel (Save→Export)

**Files:**
- Create: `glint/src/views/editor/ProjectBar.tsx`
- Modify: `glint/src/views/editor/ExportBar.tsx` (relabel only)
- Modify: `glint/src/views/editor/editor.css` (ProjectBar styles)

**Interfaces:**
- Consumes: `saveProject`, `openProject`, `pickSavePath`, `pickOpenPath`, `pushRecentProject` (Task 4); store `markSaved`, `projectPath`, `dirty` (Task 5); the `glint:save-project` window event (Task 6).
- Produces: `export function ProjectBar()`.

- [ ] **Step 1: Create the ProjectBar**

Create `glint/src/views/editor/ProjectBar.tsx`:

```tsx
import { useCallback, useEffect } from "react";
import { FolderOpen, Save } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import {
  saveProject, openProject, pickSavePath, pickOpenPath, pushRecentProject,
} from "../../lib/editor";

/**
 * ProjectBar — `.glint` document actions (Open / Save / Save As).
 * Save writes to the current project path silently; Save As (or an Untitled
 * Save) opens the native dialog. The single save implementation also serves the
 * Ctrl+S / Ctrl+Shift+S shortcuts via the `glint:save-project` window event.
 */
export function ProjectBar() {
  const markSaved = useEditorStore((s) => s.markSaved);
  const projectName = useEditorStore((s) => s.projectName);

  const doSave = useCallback(async (asNew: boolean) => {
    const { projectPath, annotations, crop, frame } = useEditorStore.getState();
    const doc = { annotations, crop, frame };
    let path = asNew ? null : projectPath;
    if (!path) {
      path = await pickSavePath(projectName ?? "Untitled.glint");
      if (!path) return; // cancelled
    }
    try {
      const saved = await saveProject(doc, path);
      const name = saved.split(/[\\/]/).pop() ?? saved;
      markSaved(saved, name);
      await pushRecentProject(saved);
    } catch {
      useEditorStore.setState({}); // no-op; errors surfaced via toast below
      window.dispatchEvent(new CustomEvent("glint:toast", { detail: "Couldn't save the project" }));
    }
  }, [markSaved, projectName]);

  const doOpen = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try {
      await openProject(path); // Rust sets EditorState + shows editor; editor-open reloads us
      await pushRecentProject(path);
    } catch {
      window.dispatchEvent(new CustomEvent("glint:toast", { detail: "Couldn't open the project" }));
    }
  }, []);

  // Keyboard shortcuts (Ctrl+S / Ctrl+Shift+S) dispatch this event from EditorView.
  useEffect(() => {
    const onSaveEvent = (e: Event) => {
      const asNew = Boolean((e as CustomEvent<{ asNew: boolean }>).detail?.asNew);
      void doSave(asNew);
    };
    window.addEventListener("glint:save-project", onSaveEvent);
    return () => window.removeEventListener("glint:save-project", onSaveEvent);
  }, [doSave]);

  return (
    <div className="editor-projectbar" role="toolbar" aria-label="Project">
      <button className="editor-export-btn" onClick={doOpen} title="Open a .glint project">
        <FolderOpen size={16} strokeWidth={1.75} /> Open
      </button>
      <button className="editor-export-btn" onClick={() => doSave(false)} title="Save project (Ctrl+S)">
        <Save size={16} strokeWidth={1.75} /> Save
      </button>
      <button className="editor-export-btn" onClick={() => doSave(true)} title="Save project as… (Ctrl+Shift+S)">
        Save As
      </button>
    </div>
  );
}
```

Note: the `glint:toast` window event is handled by App.tsx's existing `glint-toast` Tauri listener? No — that is a Tauri event, not a DOM event. Replace the two `window.dispatchEvent(new CustomEvent("glint:toast", …))` calls with the app store toast. Update the imports and calls:

Add import:

```tsx
import { useAppStore } from "../../store/useAppStore";
```

In the component body add:

```tsx
  const pushToast = useAppStore((s) => s.pushToast);
```

Replace the two catch bodies with:

```tsx
    } catch {
      pushToast("Couldn't save the project");
    }
```

and

```tsx
    } catch {
      pushToast("Couldn't open the project");
    }
```

and remove the stray `useEditorStore.setState({});` line. Add `pushToast` to the `doSave`/`doOpen` `useCallback` dependency arrays.

- [ ] **Step 2: Relabel ExportBar Save → Export**

In `glint/src/views/editor/ExportBar.tsx`, update the primary button's label, title, and status text. Change the `onSave` flash and the button:

The `onSave` handler stays (still calls `editorSave`), but update its flash text:

```tsx
  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    flash(`Exported · ${dest.split(/[\\/]/).pop()}`);
  });
```

And the button:

```tsx
      <button className="editor-export-btn editor-export-btn--primary" onClick={onSave} title="Export a PNG to the Library">
        <Save size={16} strokeWidth={1.75} /> Export
      </button>
```

- [ ] **Step 3: Add ProjectBar styles**

In `glint/src/views/editor/editor.css`, add after the `.editor-frame-slot` block:

```css
/* ── Project bar (top bar, far left) ─────────────────────────────────────── */
.editor-projectbar {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s4);
  border-right: 1px solid var(--border);
}
```

- [ ] **Step 4: Verify typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/editor/ProjectBar.tsx glint/src/views/editor/ExportBar.tsx glint/src/views/editor/editor.css
git commit -m "feat(p5c): ProjectBar (Open/Save/Save As) + relabel Save→Export"
```

---

### Task 8: Titlebar — visible project name + dirty dot

**Files:**
- Modify: `glint/src/components/Titlebar.tsx`
- Modify: `glint/src/components/shell.css` (or wherever `.g-wordmark` is styled — confirm with a grep)

**Interfaces:**
- Consumes: store `projectName`, `dirty` (Task 5).
- Produces: visible `Glint — •Name` in the always-visible custom titlebar (the borderless window has no OS title bar).

- [ ] **Step 1: Make the wordmark reactive**

In `glint/src/components/Titlebar.tsx`, add the store import and render the project suffix:

```tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEditorStore } from "../editor/useEditorStore";

const win = getCurrentWindow();
```

Inside the component, before `return`:

```tsx
  const projectName = useEditorStore((s) => s.projectName);
  const dirty = useEditorStore((s) => s.dirty);
```

Replace the wordmark span:

```tsx
      <span className="g-wordmark">
        Glint
        {projectName && (
          <span className="g-project" title={dirty ? "Unsaved changes" : projectName}>
            {" — "}
            {dirty && <span className="g-dirty" aria-label="Unsaved changes">•</span>}
            {projectName}
          </span>
        )}
      </span>
```

- [ ] **Step 2: Style the project suffix**

Find where `.g-wordmark` is defined:

Run: `cd glint && grep -rn "g-wordmark" src/`
Expected: a CSS file (e.g. `src/components/shell.css`).

In that CSS file, add:

```css
.g-project { color: var(--text-dim); font-weight: 400; }
.g-dirty { color: var(--accent); margin-right: 2px; }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add glint/src/components/Titlebar.tsx glint/src/components/shell.css
git commit -m "feat(p5c): titlebar shows project name + dirty dot"
```

---

### Task 9: HomeView — Open project + Recent Projects

**Files:**
- Modify: `glint/src/views/HomeView.tsx`
- Modify: `glint/src/views/home.css` (Recent Projects styles)

**Interfaces:**
- Consumes: `getRecentProjects`, `openProject`, `pickOpenPath`, `pushRecentProject`, `RecentProject` (Task 4).
- Produces: an "Open project…" action + a "Recent projects" section that lists/open `.glint` files (stale entries greyed + non-clickable).

- [ ] **Step 1: Add state + handlers**

In `glint/src/views/HomeView.tsx`, add imports:

```tsx
import { FolderOpen, FileText } from "lucide-react";
import { getRecentProjects, openProject, pickOpenPath, pushRecentProject, type RecentProject } from "../lib/editor";
```

In the component, after the `recent` (captures) state, add:

```tsx
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const reloadProjects = useCallback(() => {
    getRecentProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => { reloadProjects(); }, [reloadProjects]);

  const onOpenProject = useCallback(async () => {
    const path = await pickOpenPath();
    if (!path) return;
    try {
      await openProject(path);
      await pushRecentProject(path);
    } catch {
      pushToast("Couldn't open the project");
    }
  }, [pushToast]);

  const onOpenRecent = useCallback(async (p: RecentProject) => {
    if (!p.exists) { pushToast("That project file is no longer on disk"); reloadProjects(); return; }
    try {
      await openProject(p.path);
      await pushRecentProject(p.path);
    } catch {
      pushToast("Couldn't open the project");
    }
  }, [pushToast, reloadProjects]);
```

- [ ] **Step 2: Add an Open-project button to Quick start**

In the `home-quickstart` block, add a button after the Record button:

```tsx
          <Button
            variant="subtle"
            size="md"
            icon={FolderOpen}
            onClick={onOpenProject}
          >
            Open Project
          </Button>
```

- [ ] **Step 3: Add the Recent Projects section**

After the "Recent captures" `<section>`, add:

```tsx
      {/* ── Recent projects ─────────────────────────────────── */}
      {projects.length > 0 && (
        <section className="home-section" aria-labelledby="rp-label">
          <span className="label home-section-label" id="rp-label">
            Recent projects
          </span>
          <ul className="home-projects" role="list">
            {projects.map((p) => (
              <li key={p.path}>
                <button
                  className={`home-project${p.exists ? "" : " home-project--stale"}`}
                  onClick={() => onOpenRecent(p)}
                  title={p.exists ? p.path : `${p.path} (missing)`}
                >
                  <FileText size={16} strokeWidth={1.75} />
                  <span className="home-project-name">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
```

- [ ] **Step 4: Style the Recent Projects list**

In `glint/src/views/home.css`, add:

```css
.home-projects { display: flex; flex-direction: column; gap: var(--s1); list-style: none; margin: 0; padding: 0; }
.home-project {
  display: flex; align-items: center; gap: var(--s2);
  width: 100%; padding: var(--s2) var(--s3);
  border: 1px solid var(--border); border-radius: var(--r1);
  background: var(--bg-elev); color: var(--text); cursor: pointer; text-align: left;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.home-project:hover { border-color: var(--border-strong); }
.home-project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-project--stale { opacity: 0.5; }
```

- [ ] **Step 5: Verify typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/HomeView.tsx glint/src/views/home.css
git commit -m "feat(p5c): Home Open Project + Recent Projects list"
```

---

### Task 10: Green gate — full build, tests, acceptance doc, roadmap

**Files:**
- Create: `docs/superpowers/PHASE-5C-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md`

**Interfaces:** none (verification + docs).

- [ ] **Step 1: Frontend typecheck + unit tests**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all Vitest suites pass (including `useEditorStore.test.ts` and the existing `composition` tests).

- [ ] **Step 2: Rust build + tests**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: build succeeds; all tests pass (including `editor::document` and `settings`).

- [ ] **Step 3: Frontend production build**

Run: `cd glint && npm run build`
Expected: `tsc && vite build` completes with no errors.

- [ ] **Step 4: Write the acceptance checklist**

Create `docs/superpowers/PHASE-5C-ACCEPTANCE.md`:

```markdown
# Phase 5c — `.glint` Document Save/Load — Acceptance

**Status:** Built — pending at-screen acceptance.
**Branch:** `phase-5c-glint-document`. **Spec:** specs/2026-06-23-glint-phase5c-glint-document-design.md.

## Automated (green gate)
- [ ] `cargo test` green (incl. `editor::document` round-trip / version / corrupt cases)
- [ ] `vitest run` green (incl. `loadDoc` atomic hydrate + dirty tracking)
- [ ] `tsc --noEmit` + `vite build` clean

## At-screen (manual)
- [ ] Annotate + crop + frame a capture → **Save** → choose path → `.glint` written; titlebar shows name, `•` clears.
- [ ] Edit again → `•` reappears; **Ctrl+S** overwrites silently (no dialog); `•` clears.
- [ ] **Save As** (Ctrl+Shift+S) writes a second file; titlebar updates to the new name.
- [ ] Close + reopen the `.glint` via **Open** (editor) and via **Home → Recent projects** → identical editable document (move an annotation; crop + frame intact).
- [ ] Open a project while already in the editor → it reloads correctly.
- [ ] **Export** still writes a flattened PNG to the Library (unchanged behavior).
- [ ] Recent projects lists newest-first, dedupes, caps at 8; a deleted file shows greyed + toasts on click.
- [ ] Corrupt/newer-version `.glint` → friendly toast, no crash.
```

- [ ] **Step 5: Update the roadmap**

In `docs/superpowers/ROADMAP.md`, move the Phase 5c entry from "Planned" to "Shipped" (mirroring the 5a/5b bullet style), e.g. add under Shipped:

```markdown
- **Phase 5c — `.glint` save/load** (versioned self-contained document: embedded image + opaque
  doc; Save=project / Export=PNG; dirty indicator; Home Recent Projects). *Branch
  `phase-5c-glint-document` — at-screen acceptance in progress.*
```

and remove the "### Phase 5c — `.glint` save/load" subsection from "Planned".

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/PHASE-5C-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p5c): acceptance checklist + roadmap update"
```

---

## Self-Review notes (carried from planning)

- **Spec coverage:** file format → T1; embed/opaque doc → T1; `project_save`/`project_open` + image-off-IPC → T3; `EditorSource`/`editor_source` doc+path → T2; atomic `loadDoc` → T5; Save/Save As/Open + Ctrl+S/Ctrl+Shift+S → T6/T7; rename Save→Export → T7; dirty indicator → T5 (state) + T6 (OS title) + T8 (visible chrome); Home Open + Recent Projects (settings-backed, stale-pruned) → T4 (helpers) + T9 (UI); `tauri-plugin-dialog` → T3/T4; testing → per-task + T10; deferrals (deep Library, file association, close-confirm) → untouched.
- **Deviations from spec (intent-preserving, decided during planning):**
  1. Dirty indicator shown in the **custom titlebar** (T8) because the window is borderless (no OS title bar); `setTitle` (T6) kept for taskbar/alt-tab only.
  2. Recent Projects persisted via the existing **frontend plugin-sql `settings` table** (`persistSetting`/`readSetting`) rather than a Rust `Settings` field — this is the app's actual settings-persistence path and avoids an unused validated key. A small Rust `projects_resolve` provides basename + on-disk status (no new fs plugin).
  3. `project_open` reuses `open_editor_window` (emits `editor-open`); EditorView reloads on that event so opening a project while already in the editor works (T6).
```
