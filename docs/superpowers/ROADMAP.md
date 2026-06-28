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
  export). *Merged to master.*
- **Phase 5c — `.glint` save/load** (versioned, self-contained document: embedded base image +
  opaque doc {annotations, crop, frame}; Save=project / Export=PNG; Ctrl+S; dirty indicator in
  the titlebar; Home "Open Project" + Recent Projects). Also shipped in the at-screen round: a
  scrub **eraser** (sized footprint, partial freehand erase), **copy-path hotkey** wired up, and
  a **capture-overlay reuse** speedup (pre-warmed webview). *Merged to master.*
- **Phase 6 — "Open in Glint"** (Explorer integration + edit any image). HKCU shell verb under
  `SystemFileAssociations\image\shell\Glint` (the `image` perceived-type covers png/jpg/jpeg/
  webp/bmp/gif in one entry) running `glint.exe "%1"` — no admin. Auto-registers on first run +
  self-heals each launch; Settings → General toggle (default ON) adds/removes it. Cold start
  parses argv; warm start routes through `tauri-plugin-single-instance`; both funnel into one
  `open_image_path` that decodes → re-encodes PNG → opens an **Untitled** external doc (no Library
  row). Non-destructive: Save = new `.glint`, Export = new PNG; the source file is never touched.
  New dep: `winreg`. *Merged to master.* At-screen round fixed a window-hijack bug
  (editor-open navigation must be guarded to the main window — all windows share one `<App/>`).
  Note: on Windows 11 the entry sits under Explorer's "Show more options"; top-level placement
  needs a packaged build + `IExplorerCommand` (future). (See PHASE-6-ACCEPTANCE.md.)
- **Phase 7 — "Pin to Screen"** (floating always-on-top image windows). One borderless,
  transparent `WebviewWindow` per pin (`pin-<n>`), backed by an in-memory `PinState` registry
  (PNG bytes + dims) — ephemeral: closing a pin or quitting clears it, nothing persisted. Pin
  from the post-capture HUD ("Pin") or any Library card ("Pin to screen"). The `/pin` route
  renders `PinApp`: drag to move, mouse-wheel / corner handles to resize (aspect locked, clamped
  80px → monitor), right-click menu (Copy · Save to Library · Opacity 100/75/50/25 · Close),
  hover **×** and Esc to close. Opacity is plain CSS on the `<img>` (no OS window-alpha API).
  Reuses the existing save/thumb/clipboard helpers; no new dependencies; zero recorder coupling.
  *Built — awaiting at-screen.* (See PHASE-7-ACCEPTANCE.md.)
- **Phase 8 — Screen Recorder (R1: core video)** (silent screen recording to MP4). A new
  **isolated** `recorder/` module owns a bundled **ffmpeg** sidecar that captures the screen
  (`gdigrab`) **and** encodes H.264/yuv420p/30 fps/`+faststart` in one process — no Rust capture
  loop. Record the **fullscreen** primary monitor or a dragged **region** (a live, non-frozen
  selector). A 3·2·1 countdown precedes recording; a floating always-on-top **control bar**
  (REC dot · timer · Stop) drives it. Stop is **graceful** — send `q\n` and wait for ffmpeg to
  actually exit (writes a valid `moov`), force-kill only as a 30 s last resort. The finished MP4
  lands in `Videos\Glint\` and inserts one `kind="recording"` Library row (▶ badge; Open/Reveal/
  Delete only). Entry points: tray **Record** submenu (Region/Fullscreen/Stop), the `record`
  hotkey, and a Home button. New deps: `tauri-plugin-shell` (sidecar spawn) + `tokio` (`time`,
  already transitive). **Recorder isolation honored:** capture/editor/library import nothing from
  `recorder/`; the only coupling is the outbound MP4 + Library row + `capture-saved` emit.
  *Built — awaiting at-screen.* (See PHASE-8-RECORDER-R1-ACCEPTANCE.md.)

## Planned

- **Phase 8 R2 — Recording audio:** system audio + microphone as ffmpeg `dshow` inputs, each
  independently toggleable/mutable, muxed into the MP4; control-bar audio toggles.
- **Phase 8 R3 — Webcam overlay:** a composited camera bubble (position/size) recorded into the
  video via ffmpeg's `overlay` filter; control-bar webcam toggle.
- _(Phases 7 and 8 R1 awaiting at-screen acceptance.)_

## Out of scope (project-wide, unchanged)
Cloud/upload/share-links, teams/collaboration, login/auth, web backend/network calls, scrolling
capture, QR/barcode scan, AI/LLM features, GIF recording/export.
