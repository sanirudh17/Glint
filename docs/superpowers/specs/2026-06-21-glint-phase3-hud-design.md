# Glint Phase 3 — Post-capture HUD + drag/path: Design

> The floating bar that appears after every screenshot — the most-used surface in
> the app. Built on the proven `tauri-plugin-drag` foundation (P0.5-style spike
> passed 2026-06-21). Local-first; no cloud, no network. Builds on the Phase 2
> capture pipeline.

Status: **draft 2026-06-21**. Parent: `2026-06-20-glint-architecture-and-phase0-design.md`.
User decisions: drag-out spiked first (✅ passed); result presented as a **floating
HUD near the capture** (CleanShot-style), replacing the capture-complete toast.

---

## 1. Goal & scope

After a capture is committed, instead of a transient toast, a **floating HUD** appears
near the captured region showing a thumbnail and quick actions. The image is already on
the clipboard (Phase 2); the HUD makes the *next* move effortless: drag it into another
app, copy its path, save it, or dismiss.

**In scope (P3):**
- A **post-capture HUD** — a separate transient, borderless, transparent, always-on-top
  `WebviewWindow`, positioned at the bottom-centre of the captured monitor.
- HUD shows the capture **thumbnail** + an action row:
  - **Drag out** — drag the thumbnail to drop the real PNG into any app (proven path).
  - **Copy** — re-copy the image to the clipboard.
  - **Copy path** — copy the temp file's absolute path as text.
  - **Save** — write a copy to the default save folder (`%USERPROFILE%\Pictures\Glint`)
    with a timestamped name; toast the saved path. (P4 adds configurable auto-save +
    naming + the Library row.)
  - **Annotate** — stub → "Annotation arrives in Phase 5" (wired in P5).
  - **Pin** — stub → "Pinning arrives in Phase 7" (wired in P7).
  - **Dismiss** — close the HUD.
- The **`latest.png` mirror**: every capture also writes `%USERPROFILE%\.glint\latest.png`
  (a stable path for coding agents), automatically.
- HUD lifecycle: appears on `capture-complete`; **persists** until dismissed or a new
  capture starts (a new `begin` tears down any open HUD); Esc dismisses it.

**Explicitly NOT in scope (later phases):**
- Auto-save on every capture, file-naming options, `captures` table / Library rows (P4).
- The annotation editor (P5); pinned-screenshot windows (P7).
- HUD position preferences, auto-dismiss timers, sounds (P8 polish).
- Multi-monitor *tuning* (HUD positions on the capture monitor; exercised single-monitor).

---

## 2. Architecture

### 2.1 Ownership — HUD lives in tray-core
Rust owns the HUD window lifecycle exactly as it owns the capture overlay. On a successful
`capture_commit`, Rust writes the temp PNG (already happens), writes the `latest.png`
mirror, then **opens the HUD window** instead of relying on the main app's toast. The HUD
is a transient webview routed to `#/hud`.

### 2.2 Flow
1. `capture_commit` crops → temp PNG + clipboard (Phase 2, unchanged) → **also** writes
   `latest.png` → stores a small `LastCapture { path, width, height }` in managed state →
   opens the HUD window (`hud::open`).
2. The HUD webview calls `hud_data()` to fetch `{ path, width, height, imageDataUrl }`
   (thumbnail as a data URL, same pattern as the overlay's frozen image).
3. The user clicks an action → a `hud_*` command (or `startDrag` for drag-out) → Rust acts
   → HUD stays open (except Dismiss/Save-and-close behaviour).
4. Dismiss / Esc / a new capture → `hud::teardown` closes the window.

### 2.3 Recorder isolation (unchanged sacred constraint)
The HUD path touches only the capture temp file, `arboard`, `tauri-plugin-drag`, and the
filesystem. **Zero** ffmpeg/recorder dependency.

### 2.4 Window
`hud` label (single HUD at a time — only one capture result is current). Borderless,
transparent, always-on-top, skip-taskbar, not resizable, no shadow. Sized to its content
(e.g. ~360×96 logical px), positioned bottom-centre of the capture monitor ~28px above the
work-area bottom.

---

## 3. Components

### 3.1 Rust
- **`hud.rs`** — `open(app)`, `teardown(app)`, `HUD_LABEL`. Builds/positions the window.
- **`capture/commands.rs`** (extend) — after the crop: write `latest.png`, stash
  `LastCapture` in state, call `hud::open`. New commands: `hud_data`, `hud_copy`,
  `hud_save`, `hud_copy_path`, `hud_dismiss`. (`hud_copy_path` may reuse a clipboard-text
  helper.)
- **`paths.rs`** (new, small + unit-tested) — pure helpers: default save dir
  (`Pictures/Glint`), `latest.png` path (`%USERPROFILE%\.glint\latest.png`), timestamped
  filename (`Glint <yyyy-MM-dd> at <HH.mm.ss>.png`). Pure string/path logic is tested.
- **`clipboard.rs`** (extend) — add `copy_text(s)` for Copy-path.
- **`capture/mod.rs`** — `begin` tears down any open HUD at the top (alongside overlay
  teardown) so a new capture clears the old result.

### 3.2 Frontend
- **`hud/HudApp.tsx`** — HUD root at `#/hud`: fetches `hud_data`, renders thumbnail +
  action row; Esc → dismiss.
- **`hud/HudActions.tsx`** — the action buttons (Lucide icons, tooltips).
- **`hud/hud.css`** — premium "ink on glass" bar (frontend-design skill).
- **`lib/hudIpc.ts`** — typed wrappers (`getHudData`, `hudCopy`, `hudSave`,
  `hudCopyPath`, `hudDismiss`, and `startDrag` re-export for the thumbnail).
- **`router.tsx`** — add chrome-free `#/hud` route (sibling of `/overlay`).
- **`App.tsx`** — capture-complete no longer toasts on success (the HUD shows instead);
  keep `glint-toast`; keep a fallback toast only if the HUD failed to open.

---

## 4. Data flow & contracts

| Direction | Mechanism | Payload |
|---|---|---|
| commit → HUD | Rust opens `#/hud` window | — (HUD pulls its own data) |
| HUD → Rust | `hud_data()` | → `{ path, width, height, image_data_url }` |
| HUD → Rust | `hud_copy()` / `hud_save()` / `hud_copy_path()` / `hud_dismiss()` | — |
| HUD → OS | `startDrag({ item:[path], icon:path, mode:"copy" })` | drag-out |
| Rust → app | `glint-toast` | string (e.g. "Saved to …", errors) |

- The HUD reads from a managed `LastCapture` state (set by `capture_commit`), mirroring how
  the overlay reads `CaptureSession`. No giant IPC payloads beyond the thumbnail data URL.
- `hud_save` returns/toasts the destination path. `hud_copy_path` copies `path` as text.

---

## 5. Error handling

| Failure | Behaviour |
|---|---|
| HUD window spawn fails | log; fall back to the Phase 2 success toast; capture still succeeded. |
| `latest.png` write fails | non-fatal; log + continue (clipboard/temp already done). |
| Save fails (perms/disk) | toast "Couldn't save"; HUD stays open. |
| Clipboard/copy-path fails | toast a warning; non-fatal. |
| New capture while HUD open | old HUD torn down cleanly; no orphan window. |

---

## 6. Testing

**Rust unit tests:** `paths.rs` — default dir, `latest.png` path, timestamped filename
determinism/format; save-name collisions don't overwrite (suffix). Pure, headless.

**Manual (human at screen — folds into the P2–P4 acceptance):**
- Capture → HUD appears bottom-centre with the right thumbnail.
- Drag from the HUD thumbnail drops the PNG into Explorer / a chat app.
- Copy re-copies; Copy-path pastes the path; Save writes to Pictures\Glint and toasts.
- `latest.png` exists and updates each capture.
- Esc/Dismiss closes; a second capture replaces the HUD; no orphan windows.

---

## 7. New dependencies

- **`tauri-plugin-drag` 2.1.1** + **`@crabnebula/tauri-plugin-drag`** — already added and
  **proven** in the drag spike. No new runtime deps anticipated (save uses `std::fs`;
  timestamp uses `std::time` or the existing stack). A native save-dialog is intentionally
  avoided in P3 (default-folder save); P4 revisits.

---

## 8. Risks & mitigations
- **HUD focus stealing** — always-on-top + skip-taskbar, and the HUD must NOT take focus
  from the app the user drags into. Build it `focused(false)`; verify drag still initiates.
- **Thumbnail cost** — encode a downscaled thumbnail (or reuse the full PNG as a data URL
  for now; the HUD is small so the browser scales it). Revisit if large captures feel slow.
- **latest.png path** — `%USERPROFILE%\.glint\` must be created if missing; non-fatal on
  failure.
