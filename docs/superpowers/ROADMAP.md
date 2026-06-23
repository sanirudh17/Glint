# Glint — Roadmap

Local-first Windows screenshot tool (CleanShot X clone). Everything stays on-device — no
cloud, accounts, auth, or network. Single user. Recorder path stays isolated from the
capture/library/editor path.

## Shipped

- **Phase 1 — App shell** (tray-core, main window, settings).
- **Phase 2 — Screenshots** (region/window/fullscreen capture, frozen-overlay selection).
- **Phase 3 — HUD** (post-capture floating action bar).
- **Phase 4 — Auto-save + Library** (Pictures\Glint, SQLite index, thumbnails, recents).
- **Phase 5a — Annotation editor** (Konva; arrow/line/rect/ellipse/text/pen/highlight/blur/step,
  undo/redo, native-res export: copy/save/drag).
- **Phase 5b — Crop + Backgrounds/Framing** (non-destructive crop; solid/gradient/transparent
  backdrop, padding, rounded corners, drop shadow, aspect presets; live WYSIWYG; native-res
  export). *Branch `phase-5b-composition` — at-screen acceptance in progress.*

## Planned

### Phase 5c — `.glint` save/load (document persistence)
Persist the editor document (annotations + crop + frame + a reference/copy of the base image)
to a `.glint` file and reopen it for further editing. Sets up reusable/editable compositions.
The 5b state was deliberately built plain/JSON-able for this.

### Phase 6 — "Open in Glint" (Explorer integration + edit any image)
**Goal:** Right-click any image in Windows Explorer → **Open in Glint** → the annotator opens
with that image loaded, ready for arrows, crop, rounded corners, framing, etc. Makes Glint a
general-purpose lightweight image editor, not just a capture annotator.

**Why now / motivation:** the 5a+5b editor is already capable enough (annotate + crop + frame +
native-res export) to be useful on *any* image, not only fresh captures. This unlocks the
"beautify an existing screenshot/photo" workflow. (Ordering vs. 5c is the user's call — this
can come first if the "edit any image" flow is wanted sooner.)

**Scope (seed for a later brainstorm → spec → plan):**
- **Shell context menu (no admin):** register a verb under `HKCU\Software\Classes\
  SystemFileAssociations\image\shell\Glint` (the `image` perceived-type covers png/jpg/jpeg/
  webp/bmp/gif in one entry) running `glint.exe "%1"`. HKCU-only → no admin password (honors the
  no-admin constraint). Register on install/first-run; offer a settings toggle to add/remove it.
- **Single-instance + argv routing:** when Glint is already running, route the launched path to
  the live instance (tauri-plugin-single-instance) instead of spawning a second tray-core; on
  cold start, read the path from argv. Bring the window to the front (existing always-on-top
  toggle).
- **Load external image into the editor:** a new Rust command (e.g. `editor_open_path(path)`)
  that reads + decodes the file, sets `EditorState` with `origin = <external path>` and
  `captureId = null` (it's not a Library row), then shows the editor. The frontend reuses the
  existing `editor_source` → `setBase` flow unchanged.
- **Non-destructive:** Save writes a **new** PNG to `Pictures\Glint` (+ a Library row) exactly as
  today — it never overwrites the user's original file. Optionally offer "Save over original" as
  an explicit, separate action later.

**Constraint fit:** local-first ✓ (no network), single-user/no-auth ✓ (HKCU needs no admin),
recorder isolation ✓ (editor path only, no recorder coupling), non-destructive ✓.

**Open questions for the brainstorm:** which file types to claim; whether to also add a
"Set Glint as default editor" affordance; behavior when multiple files are selected; uninstall
cleanup of the registry verb.

## Out of scope (project-wide, unchanged)
Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls, scrolling
capture, QR/barcode scan, AI/LLM features, GIF recording/export.
