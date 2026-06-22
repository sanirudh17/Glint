# Glint Phase 5a — Annotation Editor (core tools + export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open any capture into a non-destructive Konva editor, mark it up with nine core tools, and finish by copying, saving a new PNG, or dragging the flattened result — original never modified.

**Architecture:** A serializable annotation array in a Zustand store is the single source of truth; Konva renders from it (so undo/redo and later `.glint` save fall out for free). Flattening happens client-side (`stage.toDataURL`) at native resolution; Rust receives finished PNG bytes and reuses the Phase 4 save/thumbnail/Library path. The editor lives at the main window's `/editor` route; three entry points (HUD Annotate, Library Edit, "open in editor after capture") all set a Rust `EditorSource`, show the main window, and emit `editor-open`, which the main window navigates on.

**Tech Stack:** Tauri v2, Rust, `rusqlite`/`image`/`arboard`/`tauri-plugin-drag` (existing), React 19 + TypeScript, Zustand, **Konva + react-konva** (new), **Vitest** (new, dev).

## Global Constraints

- **Local-first:** no cloud, no network calls, no accounts, no auth. Verbatim.
- **Recorder isolation:** the capture/editor path has ZERO ffmpeg/scap/recorder dependency.
- **Non-destructive:** the original capture file is never modified. No overwrite-original export.
- **Base branch is `master`.** This phase builds on branch **`phase-5a-editor`** (already created off `master`; the spec is already committed there).
- **Tauri command args are camelCase in JS** (`invoke("editor_save", { pngBase64 })`); Tauri maps `pngBase64` → Rust param `png_base64`. serde structs without `rename_all` keep snake_case fields.
- **App-defined commands need NO ACL permission.**
- **Run all Rust commands from `glint/src-tauri`; all npm/tsc/vite/vitest from `glint`.**
- **Default annotation style:** color `#E5484D` (red), strokeWidth `3`, fontSize `24`.

---

### Task 1: Dependencies + Vitest harness

**Files:**
- Modify: `glint/package.json`
- Create: `glint/src/editor/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm test` (Vitest) and the `konva` / `react-konva` deps for later tasks.

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
cd glint && npm install konva@^9 react-konva@^19 && npm install -D vitest@^3
```
Expected: packages added to `package.json`, no peer-dependency errors (react-konva 19 matches React 19).

- [ ] **Step 2: Add the test script**

In `glint/package.json`, add to `"scripts"` (next to `"build"`):
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Write a smoke test**

Create `glint/src/editor/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run it — expect PASS**

Run: `cd glint && npm test`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add glint/package.json glint/package-lock.json glint/src/editor/smoke.test.ts
git commit -m "chore(p5a): add konva, react-konva, and vitest harness"
```

---

### Task 2: Annotation model (`model.ts`) — TDD

**Files:**
- Create: `glint/src/editor/model.ts`
- Create: `glint/src/editor/model.test.ts`

**Interfaces:**
- Produces:
  - Types `ToolId`, `Style`, `Annotation` (discriminated union), and per-variant interfaces.
  - `newId(): string`, `DEFAULT_STYLE: Style`.
  - Pure ops: `addAnnotation(list, a)`, `updateAnnotation(list, id, patch)`, `deleteAnnotation(list, id)`, `nextStepNumber(list)`.

- [ ] **Step 1: Write the failing tests**

Create `glint/src/editor/model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  nextStepNumber,
  type Annotation,
  type StepAnno,
} from "./model";

const rect = (id: string): Annotation => ({
  id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, w: 10, h: 10,
});
const step = (id: string, number: number): StepAnno => ({
  id, type: "step", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, number,
});

describe("annotation model", () => {
  it("adds to the end (z-order)", () => {
    const list = addAnnotation(addAnnotation([], rect("a")), rect("b"));
    expect(list.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("updates by id, leaving others untouched", () => {
    const list = updateAnnotation([rect("a"), rect("b")], "b", { x: 99 } as Partial<Annotation>);
    expect((list[1] as { x: number }).x).toBe(99);
    expect((list[0] as { x: number }).x).toBe(0);
  });

  it("deletes by id", () => {
    const list = deleteAnnotation([rect("a"), rect("b")], "a");
    expect(list.map((a) => a.id)).toEqual(["b"]);
  });

  it("nextStepNumber is 1 when no steps exist", () => {
    expect(nextStepNumber([rect("a")])).toBe(1);
  });

  it("nextStepNumber is max+1 across existing steps", () => {
    expect(nextStepNumber([step("a", 1), step("b", 3), rect("c")])).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd glint && npm test`
Expected: FAIL ("Cannot find module './model'").

- [ ] **Step 3: Implement the model**

Create `glint/src/editor/model.ts`:
```ts
/**
 * model.ts — the editor's serializable annotation model.
 *
 * This array IS the source of truth; Konva renders from it. Keeping the model
 * plain (no Konva nodes) makes undo/redo, .glint persistence (5c), and unit
 * testing trivial. All functions here are pure.
 */

export type ToolId =
  | "select"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "pen"
  | "highlight"
  | "blur"
  | "step";

export interface Style {
  color: string;
  strokeWidth: number;
  fontSize: number;
}

interface Base {
  id: string;
  z: number;
  style: Style;
}

export interface TwoPointAnno extends Base {
  type: "arrow" | "line";
  x1: number; y1: number; x2: number; y2: number;
}
export interface BoxAnno extends Base {
  type: "rect" | "ellipse" | "blur";
  x: number; y: number; w: number; h: number;
}
export interface TextAnno extends Base {
  type: "text";
  x: number; y: number; text: string;
}
export interface FreehandAnno extends Base {
  type: "pen" | "highlight";
  points: number[]; // flat [x0,y0,x1,y1,...]
}
export interface StepAnno extends Base {
  type: "step";
  x: number; y: number; number: number;
}

export type Annotation =
  | TwoPointAnno
  | BoxAnno
  | TextAnno
  | FreehandAnno
  | StepAnno;

export const DEFAULT_STYLE: Style = { color: "#E5484D", strokeWidth: 3, fontSize: 24 };

let _seq = 0;
/** Monotonic-ish id, unique within a session. */
export function newId(): string {
  return `a${Date.now().toString(36)}${(_seq++).toString(36)}`;
}

export function addAnnotation(list: Annotation[], a: Annotation): Annotation[] {
  return [...list, a];
}

export function updateAnnotation(
  list: Annotation[],
  id: string,
  patch: Partial<Annotation>,
): Annotation[] {
  return list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a));
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
  return list.filter((a) => a.id !== id);
}

/** The badge number a new step should use: max existing + 1, else 1. */
export function nextStepNumber(list: Annotation[]): number {
  const nums = list.filter((a): a is StepAnno => a.type === "step").map((a) => a.number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd glint && npm test`
Expected: model tests + smoke pass.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/model.ts glint/src/editor/model.test.ts
git commit -m "feat(p5a): annotation model + pure ops (TDD)"
```

---

### Task 3: Editor store (`useEditorStore.ts`) — TDD

**Files:**
- Create: `glint/src/editor/useEditorStore.ts`
- Create: `glint/src/editor/useEditorStore.test.ts`

**Interfaces:**
- Consumes: `model.ts` ops + types.
- Produces a Zustand store with state `{ base, annotations, selectedId, tool, style, past, future }` and actions `setBase`, `reset`, `setTool`, `setStyle`, `select`, `pushHistory`, `add`, `update`, `remove`, `undo`, `redo`.
  - **History granularity:** mutating actions (`add`/`update`/`remove`) do NOT auto-snapshot. Callers call `pushHistory()` once at the start of a discrete gesture (before creating, at drag/transform start, before delete, before a style change). One undo entry per gesture.

- [ ] **Step 1: Write the failing tests**

Create `glint/src/editor/useEditorStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./useEditorStore";
import type { Annotation } from "./model";

const rect = (id: string): Annotation => ({
  id, type: "rect", z: 0, style: { color: "#fff", strokeWidth: 3, fontSize: 24 },
  x: 0, y: 0, w: 10, h: 10,
});

beforeEach(() => useEditorStore.getState().reset());

describe("useEditorStore", () => {
  it("adds annotations and tracks selection", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["a"]);
    expect(useEditorStore.getState().selectedId).toBe("a");
  });

  it("undo restores the prior snapshot; redo re-applies it", () => {
    const s = useEditorStore.getState();
    s.pushHistory();
    s.add(rect("a"));
    s.undo();
    expect(useEditorStore.getState().annotations).toEqual([]);
    s.redo();
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["a"]);
  });

  it("a new gesture after undo clears the redo future", () => {
    const s = useEditorStore.getState();
    s.pushHistory(); s.add(rect("a"));
    s.undo();
    s.pushHistory(); s.add(rect("b"));
    s.redo(); // nothing to redo — future was cleared
    expect(useEditorStore.getState().annotations.map((a) => a.id)).toEqual(["b"]);
  });

  it("remove clears selection when the removed item was selected", () => {
    const s = useEditorStore.getState();
    s.add(rect("a"));
    s.remove("a");
    expect(useEditorStore.getState().selectedId).toBeNull();
  });

  it("setStyle merges into the current style", () => {
    useEditorStore.getState().setStyle({ color: "#00f" });
    expect(useEditorStore.getState().style.color).toBe("#00f");
    expect(useEditorStore.getState().style.strokeWidth).toBe(3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd glint && npm test`
Expected: FAIL ("Cannot find module './useEditorStore'").

- [ ] **Step 3: Implement the store**

Create `glint/src/editor/useEditorStore.ts`:
```ts
import { create } from "zustand";
import {
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  DEFAULT_STYLE,
  type Annotation,
  type Style,
  type ToolId,
} from "./model";

/** Non-serializable base image for the live session (5c persists annotations only). */
export interface EditorBase {
  image: HTMLImageElement;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
}

interface EditorState {
  base: EditorBase | null;
  annotations: Annotation[];
  selectedId: string | null;
  tool: ToolId;
  style: Style;
  past: Annotation[][];
  future: Annotation[][];

  setBase: (b: EditorBase) => void;
  reset: () => void;
  setTool: (t: ToolId) => void;
  setStyle: (patch: Partial<Style>) => void;
  select: (id: string | null) => void;
  pushHistory: () => void;
  add: (a: Annotation) => void;
  update: (id: string, patch: Partial<Annotation>) => void;
  remove: (id: string) => void;
  undo: () => void;
  redo: () => void;
}

const INITIAL = {
  base: null as EditorBase | null,
  annotations: [] as Annotation[],
  selectedId: null as string | null,
  tool: "select" as ToolId,
  style: { ...DEFAULT_STYLE },
  past: [] as Annotation[][],
  future: [] as Annotation[][],
};

export const useEditorStore = create<EditorState>((set) => ({
  ...INITIAL,

  setBase: (b) => set({ base: b }),
  reset: () => set({ ...INITIAL, style: { ...DEFAULT_STYLE } }),
  setTool: (t) => set({ tool: t, selectedId: t === "select" ? null : null }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  select: (id) => set({ selectedId: id }),

  // Snapshot the current annotations so the next gesture can be undone. Clears redo.
  pushHistory: () => set((s) => ({ past: [...s.past, s.annotations], future: [] })),

  add: (a) => set((s) => ({ annotations: addAnnotation(s.annotations, a), selectedId: a.id })),
  update: (id, patch) => set((s) => ({ annotations: updateAnnotation(s.annotations, id, patch) })),
  remove: (id) =>
    set((s) => ({
      annotations: deleteAnnotation(s.annotations, id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  undo: () =>
    set((s) =>
      s.past.length
        ? {
            annotations: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.annotations, ...s.future],
            selectedId: null,
          }
        : s,
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            annotations: s.future[0],
            future: s.future.slice(1),
            past: [...s.past, s.annotations],
            selectedId: null,
          }
        : s,
    ),
}));
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd glint && npm test`
Expected: all store tests pass.

- [ ] **Step 5: Commit**

```bash
git add glint/src/editor/useEditorStore.ts glint/src/editor/useEditorStore.test.ts
git commit -m "feat(p5a): editor Zustand store with gesture-grained undo/redo (TDD)"
```

---

### Task 4: `open_in_editor` setting (live)

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (field, default, apply_update arm, test)
- Modify: `glint/src/store/useAppStore.ts` (type + setter + hydration)
- Modify: `glint/src/views/settings/AutoSave.tsx` (live toggle)

**Interfaces:**
- Produces: Rust `Settings.open_in_editor: bool` (default `false`); `apply_update` key `"open_in_editor"`; frontend `Settings.open_in_editor` + `setOpenInEditor`.

- [ ] **Step 1: Rust field + default + apply_update + test**

In `glint/src-tauri/src/settings/mod.rs`, add to the `Settings` struct (after `auto_copy`):
```rust
    pub open_in_editor: bool,
```
In `impl Default for Settings`, add (after `auto_copy: true,`):
```rust
            open_in_editor: false,
```
In `apply_update`, add before the `other =>` arm:
```rust
        "open_in_editor" => {
            s.open_in_editor = value.as_bool().ok_or("open_in_editor must be boolean")?;
        }
```
Add a test inside `mod tests`:
```rust
    #[test]
    fn apply_update_sets_open_in_editor_bool() {
        let mut s = Settings::default();
        assert!(!s.open_in_editor);
        apply_update(&mut s, "open_in_editor", json!(true)).unwrap();
        assert!(s.open_in_editor);
    }
```

- [ ] **Step 2: Run settings tests — expect PASS**

Run: `cd glint/src-tauri && cargo test --lib settings::`
Expected: all settings tests pass (including the new one).

- [ ] **Step 3: Frontend type + setter + hydration**

In `glint/src/store/useAppStore.ts`:

Add to the `Settings` interface (after `auto_copy`):
```ts
  open_in_editor: boolean;
```
Add to the `AppState` interface (after `setAutoCopy`):
```ts
  setOpenInEditor: (on: boolean) => Promise<void>;
```
In `loadSettings`, extend the override block — add after `let auto_copy = rustSettings.auto_copy;`:
```ts
    let open_in_editor = rustSettings.open_in_editor;
```
inside the `try { ... }` (after the auto_copy read):
```ts
      const dbOpenInEditor = await readSetting<boolean>("open_in_editor");
      if (dbOpenInEditor !== null) open_in_editor = dbOpenInEditor;
```
and change the `merged` line to include it:
```ts
    const merged: Settings = { ...rustSettings, theme, accent, auto_save, auto_copy, open_in_editor };
```
Add the setter after `setAutoCopy`:
```ts
  setOpenInEditor: async (on: boolean) => {
    const updated = await saveSetting("open_in_editor", on);
    await persistSetting("open_in_editor", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 4: Make the AutoSave toggle live**

In `glint/src/views/settings/AutoSave.tsx`, replace the third `<Field>` (the disabled "Open in editor after capture" stub) with a live toggle. Change the `useAppStore` selectors block to add:
```tsx
  const setOpenInEditor = useAppStore((s) => s.setOpenInEditor);
```
Replace the third Field's body:
```tsx
      <Field label="Open in editor after capture" hint="Open each capture in the editor instead of the HUD.">
        <Switch
          checked={settings?.open_in_editor ?? false}
          onChange={(v) => setOpenInEditor(v)}
        />
      </Field>
```
Remove the now-unused `Info` import if nothing else uses it in this file (it is only used by the stub — remove `import { Info } from "lucide-react";`).

- [ ] **Step 5: Typecheck — expect PASS**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src/store/useAppStore.ts glint/src/views/settings/AutoSave.tsx
git commit -m "feat(p5a): live 'open in editor after capture' setting"
```

---

### Task 5: Rust editor module — source state + open/source commands

**Files:**
- Create: `glint/src-tauri/src/editor/mod.rs`
- Create: `glint/src-tauri/src/editor/commands.rs`
- Modify: `glint/src-tauri/src/lib.rs` (declare module, manage state, register commands)

**Interfaces:**
- Consumes: `crate::capture::{LastCaptureState, frozen}`, `crate::db::capture_path`, `crate::Db`, `crate::hud`.
- Produces:
  - `crate::editor::EditorSource { png: Vec<u8>, width: u32, height: u32, origin: String, capture_id: Option<i64> }`
  - `crate::editor::EditorState(pub Mutex<Option<EditorSource>>)` (managed)
  - Commands `editor_open_from_last`, `editor_open_capture`, `editor_source`.

- [ ] **Step 1: Module state**

Create `glint/src-tauri/src/editor/mod.rs`:
```rust
//! Annotation editor: the base-image source for the current editing session.
//! Set by the three entry points (HUD Annotate, Library Edit, open-in-editor);
//! read by the /editor webview via `editor_source`. No recorder dependency.

use std::sync::Mutex;

#[derive(Clone)]
pub struct EditorSource {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// "hud" | "library" | "capture" — informational for the frontend.
    pub origin: String,
    pub capture_id: Option<i64>,
}

#[derive(Default)]
pub struct EditorState(pub Mutex<Option<EditorSource>>);

pub mod commands;
```

- [ ] **Step 2: Open/source commands**

Create `glint/src-tauri/src/editor/commands.rs`:
```rust
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::editor::{EditorSource, EditorState};

#[derive(Serialize)]
pub struct EditorSourceDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub origin: String,
    pub capture_id: Option<i64>,
}

/// Show + focus the main window and tell it to navigate to /editor.
pub(crate) fn open_editor_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit("editor-open", ());
}

/// Open the most recent capture (from the HUD) into the editor.
#[tauri::command]
pub fn editor_open_from_last(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    ed: State<EditorState>,
) -> Result<(), String> {
    let (png, width, height) = {
        let guard = last.0.lock().unwrap();
        let l = guard.as_ref().ok_or("no capture result")?;
        let img = crate::capture::frozen::CapturedImage {
            width: l.width,
            height: l.height,
            rgba: l.rgba.clone(),
        };
        let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
        (png, l.width, l.height)
    };
    *ed.0.lock().unwrap() = Some(EditorSource {
        png,
        width,
        height,
        origin: "hud".into(),
        capture_id: None,
    });
    crate::hud::teardown(&app);
    open_editor_window(&app);
    Ok(())
}

/// Open an existing Library capture (by id) into the editor.
#[tauri::command]
pub fn editor_open_capture(
    app: AppHandle,
    db: State<crate::Db>,
    ed: State<EditorState>,
    id: i64,
) -> Result<(), String> {
    let path = {
        let conn = db.0.lock().unwrap();
        crate::db::capture_path(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("capture not found")?
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (decoded.width(), decoded.height());
    *ed.0.lock().unwrap() = Some(EditorSource {
        png: bytes,
        width,
        height,
        origin: "library".into(),
        capture_id: Some(id),
    });
    open_editor_window(&app);
    Ok(())
}

/// The base image + metadata the /editor webview loads on mount.
#[tauri::command]
pub fn editor_source(ed: State<EditorState>) -> Result<EditorSourceDto, String> {
    let guard = ed.0.lock().unwrap();
    let s = guard.as_ref().ok_or("no editor source")?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&s.png);
    Ok(EditorSourceDto {
        image_data_url: format!("data:image/png;base64,{b64}"),
        width: s.width,
        height: s.height,
        origin: s.origin.clone(),
        capture_id: s.capture_id,
    })
}
```

- [ ] **Step 3: Declare module, manage state, register commands**

In `glint/src-tauri/src/lib.rs`:

Add to the module declarations (after `mod db;`):
```rust
mod editor;
```
Extend the editor command import — add a new `use` line after the `capture::commands::{…}` block:
```rust
use editor::commands::{editor_open_capture, editor_open_from_last, editor_source};
```
In the builder, add a `.manage` (next to the other `.manage(...)` calls):
```rust
        .manage(crate::editor::EditorState::default())
```
Add to `tauri::generate_handler![ … ]` (after `capture_delete,`):
```rust
            editor_open_from_last,
            editor_open_capture,
            editor_source,
```

- [ ] **Step 4: Build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles (export commands come next; `image`/`base64` already deps).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/editor glint/src-tauri/src/lib.rs
git commit -m "feat(p5a): editor source state + open/source commands"
```

---

### Task 6: Rust editor export commands (copy / save / drag-temp)

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs` (make `write_thumb` reachable)
- Modify: `glint/src-tauri/src/editor/commands.rs` (add export commands)
- Modify: `glint/src-tauri/src/lib.rs` (register)

**Interfaces:**
- Consumes: `crate::capture::commands::write_thumb`, `crate::db::{NewCapture, insert_capture}`, `crate::paths::{glint_save_dir, capture_filename, dedupe}`, `crate::clipboard::copy_image`, `crate::Db`.
- Produces: commands `editor_copy(png_base64)`, `editor_save(png_base64) -> String`, `editor_flatten_temp(png_base64) -> String`.

- [ ] **Step 1: Expose `write_thumb` to the editor module**

In `glint/src-tauri/src/capture/commands.rs`, change the `write_thumb` signature visibility from `fn write_thumb(` to:
```rust
pub(crate) fn write_thumb(
```
(Leave the body unchanged.)

- [ ] **Step 2: Add the export commands**

Append to `glint/src-tauri/src/editor/commands.rs`:
```rust
// ─── Export ────────────────────────────────────────────────────────────────────

/// Strip an optional `data:image/png;base64,` prefix, then decode to PNG bytes.
fn decode_png_arg(png_base64: &str) -> Result<Vec<u8>, String> {
    let raw = png_base64.rsplit(',').next().unwrap_or(png_base64);
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| e.to_string())
}

/// Copy the flattened (annotated) image to the clipboard.
#[tauri::command]
pub fn editor_copy(png_base64: String) -> Result<(), String> {
    let bytes = decode_png_arg(&png_base64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    crate::clipboard::copy_image(&img.into_raw(), w, h)
}

/// Save the flattened image as a NEW capture in the Library (never overwrites).
#[tauri::command]
pub fn editor_save(app: AppHandle, db: State<crate::Db>, png_base64: String) -> Result<String, String> {
    let bytes = decode_png_arg(&png_base64)?;
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now());
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    let rgba_img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba_img.width(), rgba_img.height());
    let thumb_path = crate::capture::commands::write_thumb(&app, &rgba_img.into_raw(), w, h, &dest_str);
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes: Some(bytes.len() as i64),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("editor_save insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    Ok(dest_str)
}

/// Write the flattened image to a temp file and return its path (for drag-out).
#[tauri::command]
pub fn editor_flatten_temp(app: AppHandle, png_base64: String) -> Result<String, String> {
    let bytes = decode_png_arg(&png_base64)?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let dest = dir.join(format!("glint-edit-{ts}.png"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}
```

- [ ] **Step 3: Register the export commands**

In `glint/src-tauri/src/lib.rs`, extend the editor import:
```rust
use editor::commands::{
    editor_copy, editor_flatten_temp, editor_open_capture, editor_open_from_last, editor_save,
    editor_source,
};
```
Add to `generate_handler!` (after `editor_source,`):
```rust
            editor_copy,
            editor_save,
            editor_flatten_temp,
```

- [ ] **Step 4: Build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/editor/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p5a): editor export commands — copy/save/drag-temp"
```

---

### Task 7: `finish_commit` opens the editor when the setting is on

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs`

**Interfaces:**
- Consumes: `crate::settings::commands::SettingsState.open_in_editor`, `crate::editor::{EditorState, EditorSource}`, the already-computed `png` + `clamped` in `finish_commit`.

- [ ] **Step 1: Read `open_in_editor` alongside the other settings**

In `glint/src-tauri/src/capture/commands.rs`, in `finish_commit`, change the settings read tuple:
```rust
    let (auto_save, auto_copy, open_in_editor) = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let s = state.0.lock().unwrap();
        (s.auto_save, s.auto_copy, s.open_in_editor)
    };
```

- [ ] **Step 2: Branch the final step on the setting**

In the same function, replace the final HUD-open block:
```rust
    // Open the post-capture HUD. If it fails to open, fall back to the Phase 2
    // success toast so the capture still gives feedback.
    if let Err(e) = crate::hud::open(app) {
        log::error!("hud open failed: {e}");
        app.emit(
            "capture-complete",
            serde_json::json!({
                "path": path_str,
                "width": clamped.w,
                "height": clamped.h,
                "clipboard": clip.is_ok(),
            }),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
```
with:
```rust
    if open_in_editor {
        // Skip the HUD — drop straight into the editor with this capture loaded.
        *app.state::<crate::editor::EditorState>().0.lock().unwrap() =
            Some(crate::editor::EditorSource {
                png: png.clone(),
                width: clamped.w,
                height: clamped.h,
                origin: "capture".into(),
                capture_id: None,
            });
        crate::editor::commands::open_editor_window(app);
    } else if let Err(e) = crate::hud::open(app) {
        // HUD failed to open — fall back to the Phase 2 success toast.
        log::error!("hud open failed: {e}");
        app.emit(
            "capture-complete",
            serde_json::json!({
                "path": path_str,
                "width": clamped.w,
                "height": clamped.h,
                "clipboard": clip.is_ok(),
            }),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

- [ ] **Step 3: Build — expect PASS**

Run: `cd glint/src-tauri && cargo build`
Expected: compiles. (`png` is still owned at this point — it is used earlier by `latest.png` write and the DB `bytes` length; `png.clone()` is safe.)

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs
git commit -m "feat(p5a): route capture into the editor when open-in-editor is on"
```

---

### Task 8: Frontend IPC wrappers + entry-point wiring

**Files:**
- Create: `glint/src/lib/editor.ts`
- Modify: `glint/src/App.tsx` (navigate on `editor-open`)
- Modify: `glint/src/hud/HudApp.tsx` (Annotate → open editor)
- Modify: `glint/src/views/library/CaptureCard.tsx` (Edit button)

**Interfaces:**
- Consumes: the Task 5/6 commands.
- Produces: `getEditorSource`, `openEditorFromLast`, `openEditorCapture`, `editorCopy`, `editorSave`, `editorFlattenTemp`, `dragOut` (re-export), and type `EditorSource`.

- [ ] **Step 1: IPC wrappers**

Create `glint/src/lib/editor.ts`:
```ts
/**
 * editor.ts — typed wrappers for the annotation editor's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin.
 */
import { invoke } from "@tauri-apps/api/core";
export { dragOut } from "./hudIpc";

export interface EditorSource {
  imageDataUrl: string;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
}

interface RawEditorSource {
  image_data_url: string;
  width: number;
  height: number;
  origin: string;
  capture_id: number | null;
}

export async function getEditorSource(): Promise<EditorSource> {
  const d = await invoke<RawEditorSource>("editor_source");
  return {
    imageDataUrl: d.image_data_url,
    width: d.width,
    height: d.height,
    origin: d.origin,
    captureId: d.capture_id,
  };
}

export const openEditorFromLast = (): Promise<void> => invoke<void>("editor_open_from_last");
export const openEditorCapture = (id: number): Promise<void> =>
  invoke<void>("editor_open_capture", { id });
export const editorCopy = (pngBase64: string): Promise<void> =>
  invoke<void>("editor_copy", { pngBase64 });
export const editorSave = (pngBase64: string): Promise<string> =>
  invoke<string>("editor_save", { pngBase64 });
export const editorFlattenTemp = (pngBase64: string): Promise<string> =>
  invoke<string>("editor_flatten_temp", { pngBase64 });
```

- [ ] **Step 2: Navigate to /editor on `editor-open`**

In `glint/src/App.tsx`, add the router import at the top (next to `import { router } from "./router";` — it's already imported). Add a listener to the `subs` array (after the `glint-toast` listener):
```ts
      // Editor entry points (HUD Annotate / Library Edit / open-in-editor) emit this.
      listen("editor-open", () => {
        router.navigate("/editor");
      }),
```

- [ ] **Step 3: HUD Annotate opens the editor**

In `glint/src/hud/HudApp.tsx`, add to the imports from `../lib/editor` (new import line):
```ts
import { openEditorFromLast } from "../lib/editor";
```
Replace the `"annotate"` case in `onAction`:
```ts
        case "annotate":
          await openEditorFromLast().catch(() => flash("Couldn't open editor"));
          break;
```

- [ ] **Step 4: Library card Edit button**

In `glint/src/views/library/CaptureCard.tsx`:

Add `Pencil` to the lucide import:
```tsx
import { ExternalLink, FolderOpen, Copy, Pencil, Trash2 } from "lucide-react";
```
Add `openEditorCapture` to the captures import:
```tsx
import { openCapture, revealCapture, copyCapture, deleteCapture, dragOut } from "../../lib/captures";
import { openEditorCapture } from "../../lib/editor";
```
Add an Edit button in `.cap-actions`, before the Copy button:
```tsx
        <button className="cap-btn" aria-label="Edit" title="Edit" onClick={() => act(() => openEditorCapture(item.id))}>
          <Pencil size={15} strokeWidth={1.75} />
        </button>
```

- [ ] **Step 5: Typecheck — expect PASS**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/editor.ts glint/src/App.tsx glint/src/hud/HudApp.tsx glint/src/views/library/CaptureCard.tsx
git commit -m "feat(p5a): editor IPC wrappers + wire all three entry points"
```

---

### Task 9: Editor view shell + Konva stage (base image, fit, select)

**Files:**
- Create: `glint/src/views/editor/EditorStage.tsx`
- Create: `glint/src/views/editor/editor.css`
- Modify: `glint/src/views/EditorView.tsx` (replace the stub)

**Interfaces:**
- Consumes: `useEditorStore`, `getEditorSource`.
- Produces: `EditorStage` (renders the base image, fit-to-viewport, exposes the Konva stage via a ref for export in Task 13). For this task only the base image + empty annotation layer render; tool interactions arrive in Tasks 10–11.

- [ ] **Step 1: Editor stage (base image + fit scaling)**

Create `glint/src/views/editor/EditorStage.tsx`:
```tsx
import { useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";

/** Fit the base image inside the available box without upscaling past 1:1. */
function fitScale(boxW: number, boxH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH, 1);
}

export const EditorStage = forwardRef<Konva.Stage>(function EditorStage(_props, ref) {
  const base = useEditorStore((s) => s.base);
  const select = useEditorStore((s) => s.select);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  if (!base) return <div className="editor-canvas" ref={wrapRef} />;

  const scale = fitScale(box.w, box.h, base.width, base.height);
  const stageW = Math.max(1, Math.round(base.width * scale));
  const stageH = Math.max(1, Math.round(base.height * scale));

  return (
    <div className="editor-canvas" ref={wrapRef}>
      <Stage
        ref={ref}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          // Click on empty stage clears selection.
          if (e.target === e.target.getStage()) select(null);
        }}
      >
        <Layer>
          <KonvaImage image={base.image} width={base.width} height={base.height} listening={false} />
        </Layer>
        <Layer name="annotations" />
      </Stage>
    </div>
  );
});
```

- [ ] **Step 2: Editor view (load source, layout)**

Replace `glint/src/views/EditorView.tsx`:
```tsx
import { useEffect, useRef } from "react";
import type Konva from "konva";
import { useEditorStore } from "../editor/useEditorStore";
import { getEditorSource } from "../lib/editor";
import { EditorStage } from "./editor/EditorStage";
import "./editor/editor.css";

export default function EditorView() {
  const base = useEditorStore((s) => s.base);
  const setBase = useEditorStore((s) => s.setBase);
  const reset = useEditorStore((s) => s.reset);
  const stageRef = useRef<Konva.Stage>(null);

  useEffect(() => {
    let alive = true;
    getEditorSource()
      .then((src) => {
        const img = new Image();
        img.onload = () => {
          if (alive)
            setBase({
              image: img,
              width: src.width,
              height: src.height,
              origin: src.origin,
              captureId: src.captureId,
            });
        };
        img.src = src.imageDataUrl;
      })
      .catch(() => {
        /* no source (e.g. navigated here directly) — show empty state */
      });
    return () => {
      alive = false;
      reset();
    };
  }, [setBase, reset]);

  if (!base) {
    return (
      <div className="editor-empty">
        <span className="label">Editor</span>
        <p>Take a capture and choose Annotate, or open one from the Library.</p>
      </div>
    );
  }

  return (
    <div className="editor-view">
      <div className="editor-main">
        <EditorStage ref={stageRef} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Editor styles**

Create `glint/src/views/editor/editor.css`:
```css
/* ── Annotation editor (Phase 5a) ─────────────────────────────────────────── */
.editor-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.editor-main {
  flex: 1;
  min-height: 0;
  display: flex;
}
.editor-canvas {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s5);
  background: var(--bg);
  overflow: hidden;
}
.editor-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  text-align: center;
  padding: var(--s7);
}
.editor-empty p { max-width: 320px; font-size: var(--fz-sm); color: var(--text-faint); }
```

- [ ] **Step 4: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add glint/src/views/EditorView.tsx glint/src/views/editor/EditorStage.tsx glint/src/views/editor/editor.css
git commit -m "feat(p5a): editor view shell + Konva stage with base image"
```

---

### Task 10: Annotation rendering + shape/text creation

**Files:**
- Create: `glint/src/views/editor/AnnotationNode.tsx`
- Modify: `glint/src/views/editor/EditorStage.tsx` (creation interactions + Transformer + render annotations)

**Interfaces:**
- Consumes: `useEditorStore`, `model` types, `newId`.
- Produces: `AnnotationNode` (renders one annotation by type; arrow/line/rect/ellipse/text + step/blur placeholders filled in Task 11), and stage interactions for `arrow`/`line`/`rect`/`ellipse`/`text`.

- [ ] **Step 1: AnnotationNode component**

Create `glint/src/views/editor/AnnotationNode.tsx`:
```tsx
import { Arrow, Line, Rect, Ellipse, Text } from "react-konva";
import type Konva from "konva";
import type { Annotation, BoxAnno, TextAnno, TwoPointAnno } from "../../editor/model";

interface Props {
  anno: Annotation;
  draggable: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDragStart: () => void;
}

export function AnnotationNode({ anno, draggable, onSelect, onChange, onDragStart }: Props) {
  const common = {
    id: anno.id,
    draggable,
    onMouseDown: onSelect,
    onTap: onSelect,
    onDragStart,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      // dx/dy in image space (stage is scaled): use the node's position delta.
      const node = e.target;
      patchPosition(anno, node.x(), node.y(), onChange);
    },
  };

  switch (anno.type) {
    case "arrow": {
      const a = anno as TwoPointAnno;
      return (
        <Arrow
          {...common}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          fill={a.style.color}
          strokeWidth={a.style.strokeWidth}
          pointerLength={10 + a.style.strokeWidth}
          pointerWidth={10 + a.style.strokeWidth}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "line": {
      const a = anno as TwoPointAnno;
      return (
        <Line
          {...common}
          points={[a.x1, a.y1, a.x2, a.y2]}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth}
          lineCap="round"
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "rect": {
      const a = anno as BoxAnno;
      return (
        <Rect
          {...common}
          x={a.x} y={a.y} width={a.w} height={a.h}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
        />
      );
    }
    case "ellipse": {
      const a = anno as BoxAnno;
      return (
        <Ellipse
          {...common}
          x={a.x + a.w / 2} y={a.y + a.h / 2}
          radiusX={Math.abs(a.w / 2)} radiusY={Math.abs(a.h / 2)}
          stroke={a.style.color} strokeWidth={a.style.strokeWidth}
          onDragEnd={(e) => {
            const node = e.target;
            onChange({ x: node.x() - a.w / 2, y: node.y() - a.h / 2 } as Partial<Annotation>);
          }}
        />
      );
    }
    case "text": {
      const a = anno as TextAnno;
      return (
        <Text
          {...common}
          x={a.x} y={a.y} text={a.text || " "}
          fontSize={a.style.fontSize} fill={a.style.color}
        />
      );
    }
    default:
      return null; // step + blur added in Task 11
  }
}

function patchPosition(
  anno: Annotation,
  x: number,
  y: number,
  onChange: (patch: Partial<Annotation>) => void,
) {
  if (anno.type === "arrow" || anno.type === "line") {
    const a = anno as TwoPointAnno;
    const dx = x - 0; const dy = y - 0;
    // Konva resets node x/y to the drag position; translate the points and reset.
    onChange({ x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as Partial<Annotation>);
  } else {
    onChange({ x, y } as Partial<Annotation>);
  }
}
```
> Note: for arrow/line drag, reset the node's offset after committing so points stay authoritative. This is handled in EditorStage by keying nodes on annotation identity (a re-render places them from `points`).

- [ ] **Step 2: Wire creation + render + Transformer into EditorStage**

Replace `glint/src/views/editor/EditorStage.tsx` with:
```tsx
import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { Stage, Layer, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import { useEditorStore } from "../../editor/useEditorStore";
import { newId, type Annotation } from "../../editor/model";
import { AnnotationNode } from "./AnnotationNode";

function fitScale(boxW: number, boxH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH) return 1;
  return Math.min(boxW / imgW, boxH / imgH, 1);
}

export const EditorStage = forwardRef<Konva.Stage>(function EditorStage(_props, ref) {
  const base = useEditorStore((s) => s.base);
  const annotations = useEditorStore((s) => s.annotations);
  const tool = useEditorStore((s) => s.tool);
  const style = useEditorStore((s) => s.style);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const add = useEditorStore((s) => s.add);
  const update = useEditorStore((s) => s.update);
  const pushHistory = useEditorStore((s) => s.pushHistory);

  const wrapRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const draftId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Attach the Transformer to the selected node (select tool only).
  useEffect(() => {
    const tr = trRef.current;
    const layer = layerRef.current;
    if (!tr || !layer) return;
    if (selectedId && tool === "select") {
      const node = layer.findOne(`#${selectedId}`);
      tr.nodes(node ? [node] : []);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, annotations]);

  if (!base) return <div className="editor-canvas" ref={wrapRef} />;

  const scale = fitScale(box.w, box.h, base.width, base.height);
  const stageW = Math.max(1, Math.round(base.width * scale));
  const stageH = Math.max(1, Math.round(base.height * scale));

  // Pointer position in image (unscaled) coordinates.
  const imgPoint = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    if (!p) return { x: 0, y: 0 };
    return { x: p.x / scale, y: p.y / scale };
  };

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    // Select tool: empty click clears selection; node clicks are handled by nodes.
    if (tool === "select") {
      if (e.target === stage) select(null);
      return;
    }
    const { x, y } = imgPoint(stage);
    pushHistory();
    const id = newId();
    draftId.current = id;
    let a: Annotation;
    switch (tool) {
      case "arrow":
      case "line":
        a = { id, type: tool, z: 0, style: { ...style }, x1: x, y1: y, x2: x, y2: y };
        break;
      case "rect":
      case "ellipse":
      case "blur":
        a = { id, type: tool, z: 0, style: { ...style }, x, y, w: 0, h: 0 };
        break;
      case "text":
        a = { id, type: "text", z: 0, style: { ...style }, x, y, text: "Text" };
        draftId.current = null; // text is placed immediately, not dragged
        break;
      case "step": {
        // step number filled by the store/model in Task 11 wiring
        a = { id, type: "step", z: 0, style: { ...style }, x, y, number: 0 };
        draftId.current = null;
        break;
      }
      default:
        return;
    }
    add(a);
  };

  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = draftId.current;
    if (!id) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const { x, y } = imgPoint(stage);
    const a = useEditorStore.getState().annotations.find((n) => n.id === id);
    if (!a) return;
    if (a.type === "arrow" || a.type === "line") {
      update(id, { x2: x, y2: y } as Partial<Annotation>);
    } else if (a.type === "rect" || a.type === "ellipse" || a.type === "blur") {
      update(id, { w: x - a.x, h: y - a.y } as Partial<Annotation>);
    }
  };

  const onUp = () => {
    draftId.current = null;
  };

  return (
    <div className="editor-canvas" ref={wrapRef}>
      <Stage
        ref={ref}
        width={stageW}
        height={stageH}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      >
        <Layer listening={false}>
          <KonvaImage image={base.image} width={base.width} height={base.height} />
        </Layer>
        <Layer ref={layerRef}>
          {annotations.map((a) => (
            <AnnotationNode
              key={a.id}
              anno={a}
              draggable={tool === "select"}
              onSelect={() => tool === "select" && select(a.id)}
              onDragStart={() => pushHistory()}
              onChange={(patch) => update(a.id, patch)}
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled={false}
            ignoreStroke
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
            onTransformStart={() => pushHistory()}
          />
        </Layer>
      </Stage>
    </div>
  );
});
```
> Note: Transformer resize writes node scale; for 5a we keep resize visual and commit position on drag. Full scale→geometry commit for rect/ellipse is acceptable to defer to manual polish; arrows/lines/text move correctly. (If a reviewer wants resize persistence, add an `onTransformEnd` that reads `node.width()*node.scaleX()` and writes back `w/h`, resetting scale to 1.)

- [ ] **Step 3: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/editor/AnnotationNode.tsx glint/src/views/editor/EditorStage.tsx
git commit -m "feat(p5a): annotation rendering + shape/text creation + select/move"
```

---

### Task 11: Pen, highlighter, step counter, blur

**Files:**
- Modify: `glint/src/views/editor/AnnotationNode.tsx` (step + blur + pen/highlight rendering)
- Modify: `glint/src/views/editor/EditorStage.tsx` (freehand accumulation + step number)

**Interfaces:**
- Consumes: `nextStepNumber`, `base.image` (for blur), Konva filters.
- Produces: rendering + creation for `pen`, `highlight`, `step`, `blur`.

- [ ] **Step 1: Render pen/highlight/step/blur in AnnotationNode**

In `glint/src/views/editor/AnnotationNode.tsx`, add imports:
```tsx
import { useEffect, useRef } from "react";
import { Arrow, Line, Rect, Ellipse, Text, Group, Image as KonvaImage, Circle } from "react-konva";
import Konva from "konva";
import type { Annotation, BoxAnno, FreehandAnno, StepAnno, TextAnno, TwoPointAnno } from "../../editor/model";
```
Add a `baseImage` prop to `Props`:
```tsx
interface Props {
  anno: Annotation;
  draggable: boolean;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  onSelect: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onDragStart: () => void;
}
```
Destructure them in the function signature. Replace the `default: return null;` arm with these cases:
```tsx
    case "pen": {
      const a = anno as FreehandAnno;
      return (
        <Line
          {...common}
          points={a.points}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.2}
          hitStrokeWidth={Math.max(12, a.style.strokeWidth)}
        />
      );
    }
    case "highlight": {
      const a = anno as FreehandAnno;
      return (
        <Line
          {...common}
          points={a.points}
          stroke={a.style.color}
          strokeWidth={a.style.strokeWidth * 4}
          lineCap="round"
          lineJoin="round"
          opacity={0.4}
          hitStrokeWidth={Math.max(16, a.style.strokeWidth * 4)}
        />
      );
    }
    case "step": {
      const a = anno as StepAnno;
      const r = 14 + a.style.strokeWidth * 2;
      return (
        <Group {...common} x={a.x} y={a.y}>
          <Circle radius={r} fill={a.style.color} />
          <Text
            text={String(a.number)}
            fontSize={r}
            fontStyle="bold"
            fill="#fff"
            width={r * 2}
            height={r * 2}
            offsetX={r}
            offsetY={r}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      );
    }
    case "blur": {
      const a = anno as BoxAnno;
      return (
        <BlurRegion
          a={a}
          baseImage={baseImage}
          baseWidth={baseWidth}
          baseHeight={baseHeight}
          draggable={draggable}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onChange={onChange}
        />
      );
    }
```
Add the `BlurRegion` component at the end of the file:
```tsx
/** A non-destructive blur: a cached, blurred copy of the base image clipped to a rect. */
function BlurRegion({
  a, baseImage, baseWidth, baseHeight, draggable, onSelect, onDragStart, onChange,
}: {
  a: BoxAnno;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onChange: (patch: Partial<Annotation>) => void;
}) {
  const ref = useRef<Konva.Group>(null);
  // Normalize negative drag rects.
  const x = Math.min(a.x, a.x + a.w);
  const y = Math.min(a.y, a.y + a.h);
  const w = Math.abs(a.w);
  const h = Math.abs(a.h);

  useEffect(() => {
    const node = ref.current;
    if (!node || w < 1 || h < 1) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [x, y, w, h, baseImage]);

  if (w < 1 || h < 1) return null;

  return (
    <Group
      id={a.id}
      ref={ref}
      draggable={draggable}
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y(), w, h } as Partial<Annotation>)}
      clipX={x}
      clipY={y}
      clipWidth={w}
      clipHeight={h}
      filters={[Konva.Filters.Blur]}
      blurRadius={14}
    >
      <KonvaImage image={baseImage} width={baseWidth} height={baseHeight} listening={false} />
    </Group>
  );
}
```

- [ ] **Step 2: Freehand accumulation + step number in EditorStage**

In `glint/src/views/editor/EditorStage.tsx`:

Import `nextStepNumber`:
```tsx
import { newId, nextStepNumber, type Annotation } from "../../editor/model";
```
In `onDown`, replace the `case "step":` block to use the real number:
```tsx
      case "step": {
        const number = nextStepNumber(useEditorStore.getState().annotations);
        a = { id, type: "step", z: 0, style: { ...style }, x, y, number };
        draftId.current = null;
        break;
      }
```
Add freehand cases to `onDown` (before `default:`):
```tsx
      case "pen":
      case "highlight":
        a = { id, type: tool, z: 0, style: { ...style }, points: [x, y] };
        break;
```
In `onMove`, add freehand handling (inside the `if (!a) return;` block, after the box case):
```tsx
    } else if (a.type === "pen" || a.type === "highlight") {
      update(id, { points: [...a.points, x, y] } as Partial<Annotation>);
    }
```
Pass the base image props to `AnnotationNode` in the render map:
```tsx
            <AnnotationNode
              key={a.id}
              anno={a}
              draggable={tool === "select"}
              baseImage={base.image}
              baseWidth={base.width}
              baseHeight={base.height}
              onSelect={() => tool === "select" && select(a.id)}
              onDragStart={() => pushHistory()}
              onChange={(patch) => update(a.id, patch)}
            />
```

- [ ] **Step 3: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/editor/AnnotationNode.tsx glint/src/views/editor/EditorStage.tsx
git commit -m "feat(p5a): pen, highlighter, step counter, and non-destructive blur"
```

---

### Task 12: Tool rail, style bar, keyboard shortcuts

**Files:**
- Create: `glint/src/views/editor/ToolRail.tsx`
- Create: `glint/src/views/editor/StyleBar.tsx`
- Modify: `glint/src/views/EditorView.tsx` (mount rail + bar, keyboard handler)
- Modify: `glint/src/views/editor/editor.css` (rail + bar styles)

**Interfaces:**
- Consumes: `useEditorStore` (tool, style, undo/redo, selection).
- Produces: `ToolRail`, `StyleBar`; tool hotkeys (V/A/L/R/O/T/P/H/B/S), Ctrl+Z / Ctrl+Shift+Z, Delete.

- [ ] **Step 1: Tool rail**

Create `glint/src/views/editor/ToolRail.tsx`:
```tsx
import {
  MousePointer2, ArrowUpRight, Minus, Square, Circle as CircleIcon,
  Type, Pen, Highlighter, Droplet, Hash, Undo2, Redo2, type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import type { ToolId } from "../../editor/model";

const TOOLS: { id: ToolId; icon: LucideIcon; tip: string; key: string }[] = [
  { id: "select",    icon: MousePointer2, tip: "Select (V)",      key: "V" },
  { id: "arrow",     icon: ArrowUpRight,  tip: "Arrow (A)",       key: "A" },
  { id: "line",      icon: Minus,         tip: "Line (L)",        key: "L" },
  { id: "rect",      icon: Square,        tip: "Rectangle (R)",   key: "R" },
  { id: "ellipse",   icon: CircleIcon,    tip: "Ellipse (O)",     key: "O" },
  { id: "text",      icon: Type,          tip: "Text (T)",        key: "T" },
  { id: "pen",       icon: Pen,           tip: "Pen (P)",         key: "P" },
  { id: "highlight", icon: Highlighter,   tip: "Highlighter (H)", key: "H" },
  { id: "blur",      icon: Droplet,       tip: "Blur (B)",        key: "B" },
  { id: "step",      icon: Hash,          tip: "Step (S)",        key: "S" },
];

export function ToolRail() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  return (
    <div className="editor-rail" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map(({ id, icon: Icon, tip }) => (
        <button
          key={id}
          className={`editor-tool${tool === id ? " editor-tool--active" : ""}`}
          title={tip}
          aria-label={tip}
          aria-pressed={tool === id}
          onClick={() => setTool(id)}
        >
          <Icon size={18} strokeWidth={1.75} />
        </button>
      ))}
      <div className="editor-rail-sep" />
      <button className="editor-tool" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => undo()}>
        <Undo2 size={18} strokeWidth={1.75} />
      </button>
      <button className="editor-tool" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => redo()}>
        <Redo2 size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Style bar**

Create `glint/src/views/editor/StyleBar.tsx`:
```tsx
import { useEditorStore } from "../../editor/useEditorStore";

const COLORS = ["#E5484D", "#F5A623", "#30A46C", "#3B82F6", "#111111", "#FFFFFF"];
const WIDTHS: { label: string; value: number }[] = [
  { label: "S", value: 2 },
  { label: "M", value: 4 },
  { label: "L", value: 8 },
];

export function StyleBar() {
  const style = useEditorStore((s) => s.style);
  const setStyle = useEditorStore((s) => s.setStyle);
  const selectedId = useEditorStore((s) => s.selectedId);
  const update = useEditorStore((s) => s.update);
  const pushHistory = useEditorStore((s) => s.pushHistory);
  const tool = useEditorStore((s) => s.tool);

  // Applying a style updates the current tool default AND the selection (if any).
  const applyColor = (color: string) => {
    setStyle({ color });
    if (selectedId) { pushHistory(); update(selectedId, { style: { ...style, color } } as never); }
  };
  const applyWidth = (strokeWidth: number) => {
    setStyle({ strokeWidth });
    if (selectedId) { pushHistory(); update(selectedId, { style: { ...style, strokeWidth } } as never); }
  };

  return (
    <div className="editor-stylebar" role="toolbar" aria-label="Style">
      <div className="editor-swatches">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`editor-swatch${style.color === c ? " editor-swatch--active" : ""}`}
            style={{ background: c }}
            title={c}
            aria-label={`Color ${c}`}
            onClick={() => applyColor(c)}
          />
        ))}
      </div>
      <div className="editor-widths">
        {WIDTHS.map((w) => (
          <button
            key={w.value}
            className={`editor-width${style.strokeWidth === w.value ? " editor-width--active" : ""}`}
            title={`Stroke ${w.label}`}
            aria-label={`Stroke ${w.label}`}
            onClick={() => applyWidth(w.value)}
          >
            {w.label}
          </button>
        ))}
      </div>
      {tool === "text" && (
        <input
          className="editor-fontsize"
          type="number"
          min={8}
          max={120}
          value={style.fontSize}
          onChange={(e) => setStyle({ fontSize: Number(e.currentTarget.value) || 24 })}
          aria-label="Font size"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount rail + bar + keyboard handler in EditorView**

In `glint/src/views/EditorView.tsx`:

Add imports:
```tsx
import { ToolRail } from "./editor/ToolRail";
import { StyleBar } from "./editor/StyleBar";
import type { ToolId } from "../editor/model";
```
Add a keyboard effect inside the component (after the source-loading effect):
```tsx
  const setTool = useEditorStore((s) => s.setTool);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const remove = useEditorStore((s) => s.remove);
  const selectedId = useEditorStore((s) => s.selectedId);

  useEffect(() => {
    const keys: Record<string, ToolId> = {
      v: "select", a: "arrow", l: "line", r: "rect", o: "ellipse",
      t: "text", p: "pen", h: "highlight", b: "blur", s: "step",
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        useEditorStore.getState().pushHistory();
        remove(selectedId);
        return;
      }
      const t = keys[e.key.toLowerCase()];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool, undo, redo, remove, selectedId]);
```
Update the returned layout (the `base` branch) to mount rail + bar:
```tsx
  return (
    <div className="editor-view">
      <StyleBar />
      <div className="editor-main">
        <ToolRail />
        <EditorStage ref={stageRef} />
      </div>
    </div>
  );
```

- [ ] **Step 4: Rail + bar styles**

Append to `glint/src/views/editor/editor.css`:
```css
.editor-stylebar {
  display: flex;
  align-items: center;
  gap: var(--s4);
  padding: var(--s2) var(--s4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.editor-swatches, .editor-widths { display: flex; gap: var(--s2); align-items: center; }
.editor-swatch {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid transparent; cursor: pointer; padding: 0;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.2);
}
.editor-swatch--active { border-color: var(--text); }
.editor-width {
  width: 28px; height: 24px; border-radius: var(--r1);
  border: 1px solid var(--border); background: transparent;
  color: var(--text-dim); cursor: pointer; font-size: var(--fz-xs);
}
.editor-width--active { border-color: var(--accent); color: var(--text); }
.editor-fontsize {
  width: 56px; height: 26px; padding: 0 var(--s2);
  border: 1px solid var(--border); border-radius: var(--r1);
  background: var(--bg); color: var(--text); font-size: var(--fz-sm);
}
.editor-rail {
  display: flex; flex-direction: column; gap: 2px;
  padding: var(--s2); border-right: 1px solid var(--border); background: var(--bg-elev);
}
.editor-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: var(--r1);
  border: none; background: transparent; color: var(--text-dim); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.editor-tool:hover { background: var(--bg-elev2); color: var(--text); }
.editor-tool--active { background: var(--accent-subtle); color: var(--accent); }
.editor-rail-sep { height: 1px; margin: var(--s2) 0; background: var(--border); }
```

- [ ] **Step 5: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src/views/EditorView.tsx glint/src/views/editor/ToolRail.tsx glint/src/views/editor/StyleBar.tsx glint/src/views/editor/editor.css
git commit -m "feat(p5a): tool rail, style bar, and keyboard shortcuts"
```

---

### Task 13: Export bar (copy / save / drag) + flatten + discard guard

**Files:**
- Create: `glint/src/views/editor/ExportBar.tsx`
- Modify: `glint/src/views/EditorView.tsx` (mount export bar, pass the stage ref)

**Interfaces:**
- Consumes: the Konva `Stage` ref, `editorCopy`/`editorSave`/`editorFlattenTemp`/`dragOut`, `useEditorStore`.
- Produces: `ExportBar`; flatten via `stage.toDataURL({ pixelRatio })` at native resolution.

- [ ] **Step 1: Flatten helper + export bar**

Create `glint/src/views/editor/ExportBar.tsx`:
```tsx
import { useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { Copy, Save, Share2 } from "lucide-react";
import { useEditorStore } from "../../editor/useEditorStore";
import { editorCopy, editorSave, editorFlattenTemp, dragOut } from "../../lib/editor";

/** Flatten the stage to base64 PNG (no data-url prefix) at native capture resolution. */
function flatten(stage: Konva.Stage, baseWidth: number): string {
  // Temporarily clear selection visuals by relying on Transformer being excluded:
  // toDataURL renders all visible nodes; the Transformer has no fill/stroke of its own
  // beyond handles, so we hide it during export.
  const tr = stage.findOne("Transformer") as Konva.Transformer | undefined;
  const hadNodes = tr ? tr.nodes() : [];
  if (tr) { tr.nodes([]); tr.getLayer()?.batchDraw(); }

  const pixelRatio = baseWidth / stage.width(); // stage.width() is the scaled px width
  const url = stage.toDataURL({ pixelRatio, mimeType: "image/png" });

  if (tr) { tr.nodes(hadNodes); tr.getLayer()?.batchDraw(); }
  return url.split(",")[1] ?? "";
}

export function ExportBar({ stageRef }: { stageRef: RefObject<Konva.Stage | null> }) {
  const base = useEditorStore((s) => s.base);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (m: string) => {
    setStatus(m);
    window.setTimeout(() => setStatus(null), 1900);
  };

  const withPng = (fn: (png: string) => Promise<void>) => async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, base.width);
    try { await fn(png); } catch { flash("Something went wrong"); }
  };

  const onCopy = withPng(async (png) => {
    await editorCopy(png);
    flash("Copied to clipboard");
  });
  const onSave = withPng(async (png) => {
    const dest = await editorSave(png);
    flash(`Saved · ${dest.split(/[\\/]/).pop()}`);
  });
  const onDrag = async () => {
    const stage = stageRef.current;
    if (!stage || !base) return;
    const png = flatten(stage, base.width);
    try {
      const path = await editorFlattenTemp(png);
      dragOut(path);
    } catch { flash("Couldn't prepare drag"); }
  };

  return (
    <div className="editor-exportbar">
      {status && <span className="editor-status">{status}</span>}
      <button className="editor-export-btn" onClick={onDrag} title="Drag out">
        <Share2 size={16} strokeWidth={1.75} /> Drag
      </button>
      <button className="editor-export-btn" onClick={onCopy} title="Copy to clipboard">
        <Copy size={16} strokeWidth={1.75} /> Copy
      </button>
      <button className="editor-export-btn editor-export-btn--primary" onClick={onSave} title="Save a new PNG">
        <Save size={16} strokeWidth={1.75} /> Save
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount export bar + styles**

In `glint/src/views/EditorView.tsx`, import and mount it in the header row. Add import:
```tsx
import { ExportBar } from "./editor/ExportBar";
```
Change the `base` return to include the export bar in the top bar (alongside StyleBar):
```tsx
  return (
    <div className="editor-view">
      <div className="editor-topbar">
        <StyleBar />
        <ExportBar stageRef={stageRef} />
      </div>
      <div className="editor-main">
        <ToolRail />
        <EditorStage ref={stageRef} />
      </div>
    </div>
  );
```
Append styles to `glint/src/views/editor/editor.css`:
```css
.editor-topbar {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.editor-topbar .editor-stylebar { border-bottom: none; flex: 1; }
.editor-exportbar {
  display: flex; align-items: center; gap: var(--s2);
  padding: var(--s2) var(--s4);
}
.editor-status { font-size: var(--fz-xs); color: var(--text-dim); margin-right: var(--s2); }
.editor-export-btn {
  display: inline-flex; align-items: center; gap: var(--s2);
  height: 30px; padding: 0 var(--s3);
  border: 1px solid var(--border); border-radius: var(--r1);
  background: var(--bg); color: var(--text); cursor: pointer; font-size: var(--fz-sm);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.editor-export-btn:hover { border-color: var(--border-strong); }
.editor-export-btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.editor-export-btn--primary:hover { background: var(--accent-hover); }
```

- [ ] **Step 3: Typecheck + build — expect PASS**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/views/EditorView.tsx glint/src/views/editor/ExportBar.tsx glint/src/views/editor/editor.css
git commit -m "feat(p5a): export bar — copy, save-as-new, drag-out (full-res flatten)"
```

---

### Task 14: Green gate + acceptance notes

**Files:**
- Create: `docs/superpowers/PHASE-5A-ACCEPTANCE.md`

- [ ] **Step 1: Full green gate**

Run:
```bash
cd glint && npm test && npx tsc --noEmit && npx vite build && cd src-tauri && cargo test
```
Expected: vitest green (model + store + smoke); tsc clean; vite build clean; cargo test all pass (existing 33 + 1 new settings test = 34).

- [ ] **Step 2: Write the acceptance checklist**

Create `docs/superpowers/PHASE-5A-ACCEPTANCE.md` with the manual checklist from the spec §6:
- Annotate opens from each entry point (HUD Annotate; Library Edit; "open in editor after capture" routes straight to the editor).
- Each tool draws: arrow, line, rectangle, ellipse, text, pen, highlighter, blur, step counter.
- Select tool moves/selects; Delete removes; Ctrl+Z / Ctrl+Shift+Z undo/redo; tool hotkeys (V/A/L/R/O/T/P/H/B/S) switch tools.
- Blur redacts the region and stays movable (non-destructive).
- Copy pastes the annotated image; Save adds a NEW Library card (original preserved); Drag drops the flattened PNG into another app.
- Output resolution matches the native capture (HiDPI check).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/PHASE-5A-ACCEPTANCE.md
git commit -m "docs(p5a): Phase 5a acceptance checklist"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** entry points (T5, T7, T8), serializable model (T2), store/undo (T3), Konva render + tools (T9–T11), style/shortcuts (T12), export copy/save/drag + full-res flatten (T6, T13), `open_in_editor` setting (T4), Vitest (T1–T3), non-destructive (save-as-new only, T6). All spec sections map to a task.
- **Type consistency:** store actions (`setBase`/`reset`/`setTool`/`setStyle`/`select`/`pushHistory`/`add`/`update`/`remove`/`undo`/`redo`) and model types (`Annotation`, `ToolId`, `Style`, variant interfaces) are used identically across T2/T3/T9–T13. IPC names (`editor_open_from_last`/`editor_open_capture`/`editor_source`/`editor_copy`/`editor_save`/`editor_flatten_temp`) match between Rust (T5/T6) and JS wrappers (T8).
- **Blur** is the one tool flagged as needing care (T11) — cached, clipped, filtered base copy; non-destructive.
- **Transformer resize persistence** for rect/ellipse is intentionally deferred to manual polish (noted inline in T10); move + all creation work in 5a.
- **No new Rust deps**; new JS deps `konva`, `react-konva`, `vitest` (T1).
