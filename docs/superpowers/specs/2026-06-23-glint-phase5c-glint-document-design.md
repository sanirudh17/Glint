# Glint Phase 5c — `.glint` Document Save/Load — Design

**Status:** Approved (brainstorming). Next: implementation plan (writing-plans).
**Branch:** `phase-5c-glint-document` (off `master` @ Phase 5b merged, `b0edbd6`).
**Predecessors:** 5a annotation editor, 5b crop + framing (both merged). **Successor:** Phase 6 "Open in Glint".

## Goal

Persist the **editor document** — annotations + crop + frame + the base image — to a portable
`.glint` file, and reopen that file for further editing with full fidelity. This turns a Glint edit
from a one-shot flatten-and-forget into a reusable, re-editable project, and establishes the
permanent on-disk document format the app builds on.

The 5a/5b state was deliberately built plain/JSON-able (`annotations`, `crop`, `frame`) precisely so
this phase could serialize it without rework.

## Constraints (inherited, still binding)

- **Local-first.** No cloud, network, uploads, accounts. A `.glint` is an ordinary local file the
  user chooses a path for via the OS file dialog. No telemetry, no online anything.
- **Single-user / no-auth.** No login, permissions, or ownership concepts in the file.
- **Recorder isolation.** This is the editor path only — zero ffmpeg/scap/recorder coupling.
- **Non-destructive.** Opening + re-saving a `.glint` never mutates the original capture in the
  Library; the `.glint` is its own self-contained artifact.
- **Self-contained (decided).** The base image is **embedded** in the `.glint` (not a path
  reference), so a project stays openable if the original capture is moved/deleted. See Decisions.

## Decisions (from brainstorming)

1. **Embed the image, self-contained.** The `.glint` carries the base PNG bytes inline (base64 in
   JSON). Chosen over a path-reference for portability/durability.
2. **Save/Open UX — Tier 2: OS dialogs + "Recent Projects" on Home; defer deep Library-DB
   integration.** Rationale: avoids a risky Library schema migration now, while "recent files" is the
   proven discovery pattern and the `.glint` format itself is the permanent foundation a later phase
   can index into the Library. *(This is the "(b) defer deep Library integration" call — confirmed:
   deferred.)*
3. **Save = project, Export = PNG.** The current primary PNG action (today labeled **Save**) is
   renamed **Export**; **Save / Save As** now mean "write the `.glint` project." `Ctrl+S` → Save
   project; `Ctrl+Shift+S` → Save As.
4. **Include a minimal dirty `•` indicator.** The window title shows the project name with a `•` when
   there are unsaved changes — cheap, and the natural partner to a save-able document (honors the
   visible-feedback principle: the user always knows whether work is persisted). *(This is the
   "(a) dirty indicator" call — confirmed: included.)* No OS-level close-confirmation dialog this
   phase (see Scope).

## File format — `.glint` (versioned JSON)

A `.glint` is a single UTF-8 JSON file:

```jsonc
{
  "glint": 1,                       // format version (integer); gate future migrations
  "app": "0.x.y",                   // app version that wrote it (informational)
  "image": {
    "mime": "image/png",
    "width": 1920,
    "height": 1080,
    "dataBase64": "<base64 PNG bytes>"   // the base capture, embedded
  },
  "doc": {                          // OPAQUE to Rust — the editor document, verbatim
    "annotations": [ /* Annotation[] */ ],
    "crop": { "x":0,"y":0,"w":0,"h":0 } | null,
    "frame": { /* FrameConfig */ }
  }
}
```

- **`doc` is opaque to Rust.** Rust treats `doc` as a pass-through `serde_json::Value` — it never
  parses annotation/frame shapes. The frontend owns the `doc` schema (it already does, via the
  store). This keeps the Rust↔TS contract tiny and lets the editor evolve `doc` without Rust changes.
- **`image` is assembled/parsed by Rust**, so the (large) base image bytes **never cross the IPC
  bridge** as part of save/open payloads — the bytes already live in `EditorState.png` on the Rust
  side. Frontend → Rust on save sends only `doc` (small JSON). Rust → frontend on open returns the
  image as the existing `editor_source` data URL plus the `doc`.
- **Versioning:** `glint: 1`. Loader rejects unknown major versions with a friendly message
  ("This project was made with a newer Glint"). Forward-compatible additive fields are tolerated.

## Architecture & data flow

### Save — `project_save(doc, path?)`

Rust command. Inputs: the `doc` JSON (from `useEditorStore.getState()` → `{annotations, crop,
frame}`) and an optional destination path.

1. If `path` is `None`, this is a "Save As" with no chosen path yet → the **frontend** opens the
   save dialog first (via `tauri-plugin-dialog`) and passes the resulting path. (Dialog on the
   frontend keeps native-window parenting simple; Rust just writes.)
2. Rust reads `EditorState.png` (+ width/height/mime) — the embedded image source of truth.
3. Rust assembles the `.glint` JSON (`glint`, `app`, `image{…,dataBase64}`, `doc`) and writes it to
   `path` (ensuring a `.glint` extension).
4. Rust updates `EditorState.project_path = Some(path)` so subsequent `Ctrl+S` overwrites silently.
5. Rust returns the saved path; frontend records it in Recent Projects, sets the title to the new
   name, and clears the dirty flag. Visible feedback: a "Saved · name.glint" status flash (same
   pattern as ExportBar today).

### Open — `project_open(path?)`

Rust command. If `path` is `None`, the **frontend** opens the open dialog and passes the chosen path.

1. Rust reads + parses the `.glint` JSON; validates `glint` version and required fields. On malformed
   / wrong-version files → `Err(friendly message)` (frontend toasts it).
2. Rust decodes `image.dataBase64` → bytes; sets `EditorState`:
   `EditorSource { png, width, height, origin: "project", capture_id: None, doc: Some(<doc Value>),
   project_path: Some(path) }`.
3. Rust shows + focuses the editor window (reuse `open_editor_window`) and emits `editor-open`
   (same as the other entry points).
4. The `/editor` view, on mount, calls the (extended) `editor_source`, which now also returns the
   optional `doc`. If `doc` is present, the view hydrates the store via a new **atomic `loadDoc`**
   action (base image + annotations + crop + frame in one `set`, history cleared), then sets the
   title + project_path and marks clean.

### `EditorSource` / `editor_source` extension

`EditorSource` (in `editor/mod.rs`) gains two fields:

```rust
pub doc: Option<serde_json::Value>,   // present only when opened from a .glint
pub project_path: Option<String>,     // the .glint path, for silent Ctrl+S re-save
```

All existing constructors (HUD/Library) set `doc: None, project_path: None` → unchanged behavior.
`editor_source` (and its DTO) returns `doc` (optional) and `project_path` (optional) alongside the
existing image/width/height/origin/capture_id. The three current entry points are untouched
except for the two new `None` fields.

## Store changes (`useEditorStore`)

- New session metadata (not part of `doc`, not in undo history):
  ```ts
  projectPath: string | null;   // current .glint path (null = never saved)
  projectName: string | null;   // basename for the title bar
  dirty: boolean;               // unsaved-changes flag
  ```
- **`loadDoc(base, doc)`** — atomic hydrate used on open: sets `base`, `annotations`, `crop`,
  `frame` together, **clears `past`/`future`** (a freshly opened project has no undo history),
  resets `selectedId`, sets `projectPath`/`projectName`, `dirty = false`. One `set()` so the stage
  never renders a half-loaded document.
- **Dirty tracking (minimal).** `dirty` flips to `true` on any document-mutating action
  (`add`/`update`/`remove`/`clearAll`/`setCrop`/`resetCrop`/`setFrame`/`toggleFrame`/`resetFrame`/
  `undo`/`redo`). It clears to `false` on `loadDoc` and after a successful `project_save`. Keep this
  surgical — flip the flag inside the existing actions, no broad subscription. (`setTool`/`select`
  are non-mutating → do **not** dirty.)
- `reset()` also resets the new metadata to nulls / `dirty:false`.

## UX

### Top bar (editor)

- Rename the existing primary PNG button **Save → Export** (icon unchanged; `editor_save` Rust
  command name unchanged — only the label says "Export"; tooltip "Export a PNG to the Library").
- Add a **Save** project control (primary affordance for the new document flow) and **Save As**
  (in an overflow or as a second button). `Ctrl+S` = Save (silent overwrite if `projectPath` set,
  else falls through to Save As dialog); `Ctrl+Shift+S` = Save As (always dialog).
- Add **Open project…** (also available on Home — see below).

### Window title

`Glint — <projectName>` when a project is loaded/saved; prepend `•` when `dirty`
(e.g. `Glint — •Mockup.glint`). Untitled (never-saved) session → `Glint — Untitled` / `•Untitled`.
Set via the Tauri window-title API from the frontend reacting to `projectName`/`dirty`.

### Home

- A **Open project…** action (near Quick start) → `project_open(None)` (frontend dialog → Rust).
- A **Recent Projects** section: a list of recently saved/opened `.glint` files (name + path),
  click to open. Backed by a persisted recent-projects list (see below), newest first, capped
  (~8). Stale entries (file no longer on disk) are pruned/greyed on load. Empty state mirrors the
  existing "No captures yet" pattern.

### Recent Projects persistence

Reuse the existing **settings key/value table** (the same store `theme`/`hotkeys` use). Add a
`recent_projects` concept:

- Add `recent_projects: Vec<String>` to `Settings` (default empty) + an `apply_update` arm.
- A small command surface: `projects_recent() -> Vec<RecentProject { path, name, exists }>` that
  reads the list and stats each path (prunes/marks missing); save/open push the path to the front
  (dedup, cap) and persist. Persistence flows through the existing settings-table write path.

This keeps Recent Projects in the proven settings store and out of the Library schema (the deferred
deep integration).

### Dirty + closing

The `•` indicator is the whole story this phase. **No OS close-confirmation dialog** (deferred) —
closing the editor window behaves exactly as today (hide, state reset on the existing window
lifecycle). Rationale: the close-confirm needs careful Tauri `CloseRequested` interception + a modal
and is out of proportion to this phase; the visible dirty marker already tells the user.

## Edge cases

- **Save As with existing file:** the OS dialog handles overwrite confirmation natively.
- **Open a `.glint` with no `doc` / partial `doc`:** validate; missing `crop`/`frame` fall back to
  defaults (treat absent as "no crop" / default frame) rather than failing the whole open.
- **Wrong/newer version (`glint > 1`):** friendly error toast, don't crash.
- **Corrupt / non-JSON / truncated base64:** `Err` → toast "Couldn't open this project."
- **Image bytes:** always re-embedded from `EditorState.png` on save, so re-saving an opened project
  preserves the original embedded image (we don't re-flatten or recompress it).
- **Untitled `Ctrl+S`:** routes to Save As (dialog) since there's no `projectPath` yet.
- **StrictMode / window lifecycle:** `loadDoc` is idempotent given the same source; `editor_source`
  is the single load path (unchanged), so the existing StrictMode-safe mount flow holds.

## Testing

- **Rust unit:** `.glint` assemble→parse round-trip (doc preserved verbatim as `Value`; image bytes
  byte-identical); version gate rejects `glint: 2`; malformed JSON → `Err`; `Settings`
  `recent_projects` apply_update + JSON round-trip; recent-list dedup/cap/prune logic.
- **Vitest (frontend):** `loadDoc` hydrates annotations+crop+frame atomically and clears history +
  dirty; dirty flips on each mutating action and not on `setTool`/`select`; recent-projects
  client mapping.
- **At-screen (manual):** Save a framed+annotated+cropped composition → reopen the `.glint` →
  pixel-for-pixel the same editable document (move an annotation, it's still there; crop/frame
  intact); Export still produces the same flattened PNG as before; title shows name + `•` toggles
  correctly; Recent Projects lists and reopens; stale entry handled; wrong-version + corrupt file
  show friendly toasts.

## Scope

**In:** `.glint` format (versioned, self-contained, embedded image); `project_save` /
`project_open` (with frontend OS dialogs); `editor_source`/`EditorSource` extended with
`doc` + `project_path`; atomic `loadDoc`; Save / Save As / Open project controls + `Ctrl+S` /
`Ctrl+Shift+S`; rename Save→Export; window-title name + dirty `•`; Home "Open project…" + Recent
Projects (settings-backed, stale-pruned).

**Out (explicitly deferred):**
- **Deep Library-DB integration** of projects (a `.glint` row/kind in the Library grid, thumbnails,
  search) — decision (2). A later phase can index `.glint` files into the Library.
- **`.glint` file association / "Open with Glint"** double-click from Explorer — overlaps Phase 6's
  shell integration; do it there.
- **OS close-confirmation** on unsaved changes (only the `•` marker this phase).
- **Auto-save / recovery** of in-progress projects.

## New dependency

- `tauri-plugin-dialog` — native Open/Save file dialogs (local, no network). Add the Rust plugin +
  JS bindings; register in `lib.rs`. (Only new dependency this phase.)

## File-level changes (anticipated)

- **Rust:**
  - `editor/mod.rs` — `EditorSource` gains `doc: Option<Value>` + `project_path: Option<String>`.
  - `editor/commands.rs` — new `project_save`, `project_open`; `editor_source`/DTO return `doc` +
    `project_path`; existing constructors set the two new `None` fields. `.glint` assemble/parse +
    version validation (likely a small `editor/document.rs` for the format + its unit tests).
  - `settings/mod.rs` — `recent_projects: Vec<String>` + `apply_update` arm; recent-list helpers.
  - `settings/commands.rs` (or `editor/commands.rs`) — `projects_recent` (+ push/persist on
    save/open).
  - `lib.rs` — register `tauri-plugin-dialog`; register the new commands.
  - `Cargo.toml` — `tauri-plugin-dialog`.
- **Frontend:**
  - `lib/editor.ts` — `doc`/`projectPath` on `EditorSource`; wrappers `projectSave`, `projectOpen`,
    `projectsRecent`; dialog calls.
  - `editor/useEditorStore.ts` — `projectPath`/`projectName`/`dirty`; `loadDoc`; dirty flips in
    mutating actions; `reset` clears metadata.
  - `views/EditorView.tsx` — hydrate via `loadDoc` when `editor_source` returns a `doc`; window-title
    effect (name + `•`); `Ctrl+S` / `Ctrl+Shift+S` handlers.
  - `views/editor/ExportBar.tsx` — relabel Save→Export; add Save / Save As / Open controls (or a
    small new `ProjectBar`/menu).
  - `views/HomeView.tsx` — "Open project…" + Recent Projects section.
  - `views/home.css` / `editor.css` — recent-projects + any new control styles.
- **Docs:** update `ROADMAP.md` (5c → shipped on acceptance), add a `PHASE-5C-ACCEPTANCE.md` at
  green-gate.
