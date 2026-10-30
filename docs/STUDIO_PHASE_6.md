# Phase 6 — Multi-clip projects

Completed on `phase-6-multi-clip-projects`, after the optimized Phase 5 gate passed.
Main and the installed executable are unchanged. The user subsequently authorized
Phase 7 with optional local captions; its completion is recorded in
[STUDIO_PHASE_7.md](STUDIO_PHASE_7.md).

## Verified paths and implementation

The existing trim model handles cuts from one source; `StudioProject` versions
1–2 and `.glint-studio` folders likewise describe a single recording. The actual
shared compositor is `glint/src-tauri/src/recorder/studio_render.rs`, with export
orchestration in `studio_export.rs`. Those paths were verified before coding.

Multi-source assemblies use their own version-1 `.glint-video` document, modeled
in `scene_project.rs` and `sceneModel.ts`. They do not reinterpret or migrate old
screenshots or Studio projects. `scene_commands.rs` owns probing, atomic project
saves and combined export. `VideoProjectView.tsx` is a lazy route reached through
**Home → Video project**, keeping its UI outside the single-recording timeline.

The implementation follows the existing Studio components, theme tokens and
controls, with Impeccable guidance for this app surface. No new design system,
font package, model download, inference runtime or large assets were added.

## Shipped

- Add or drop video clips and still images, select scenes, reorder, delete,
  undo/redo, trim videos, and set image/title duration. New/Open/Save and Ctrl+S
  are available. A local draft and unsaved-navigation protection retain edits.
- Editable title text on a configurable two-color gradient, text color and size.
  Canvas uses the existing app font after font readiness. Editable text/style and
  a PNG representation are saved together; titles are regenerated before export.
- A single shared LookConfig and fixed project canvas across different source
  dimensions. Reuses gradients, images, chrome, radius, padding, shadow, border,
  watermark and presets. Still alpha is flattened against the actual look plate.
- Cut, crossfade and slide transitions. Preview and export share the overlap
  arithmetic, capped at half of each adjacent scene so three-way overlap cannot
  occur. Audio uses the same durations and linear crossfades.
- Export through the existing CPU Studio compositor, then join normalized scenes
  at 30 FPS with AAC stereo at 48 kHz. Silent videos, images and titles get silence.
  Imported originals are never rewritten. Output is published only after success;
  cancellation keeps an existing destination and removes owned intermediate files.
- Progress/cancel and Show in folder. Completed exports get a Library entry,
  thumbnail, dimensions and duration. Progress reaches 100 only after finalization.

Project bounds: 1–32 scenes, at most 30 minutes overall, 0.25–900 seconds per
scene, even output dimensions from 16 through 1920 per axis. Transition controls
accept 0.1–2 seconds and shorten overlap for short scenes. Sources must remain
available at their referenced paths. Missing media produces an error; delete and
reimport a replacement to relink it.

Per-scene look overrides were optional and are omitted. Imports are media files,
not nested Studio timelines: export an existing Studio edit first to carry its
zoom/masks/cursor edits into an assembly. Existing single-recording editing stays
available separately. No Phase 7 motion presets, captions or multi-camera editor
were added. Background removal remains deferred.

## Acceptance evidence

- [x] Three video clips plus a title card export as one video with transitions
  and a consistent look. The acceptance project also includes a still image.
- [x] Different source dimensions, including portrait, 720p and 1080p, normalize
  to a 640 × 360, 30 FPS MP4 of exactly 5.700 seconds.
- [x] Pixel probes find the expected red, green, blue and white scenes, the shared
  background within one channel level, and visible title text. The crossfade
  midpoint is `[121, 63, 0]`, between red and green.
- [x] Export contains 48 kHz audio; sampled RMS is zero in title/silent scenes
  and over 2,000 in each of the two audible video samples.
- [x] Save/reopen retains editable media, title, trims, order, transitions and look.
- [x] Original media SHA-256 hashes are unchanged. Cancel preserves an existing
  destination and leaves no owned `.glint-scenes-*` directory behind.
- [x] Combined export appears in Library with the expected dimensions.
- [x] UI ordering/undo, seeking, two-layer crossfade and slide transforms pass.
  A still-image loading race found during inspection was fixed. Desktop dark
  (1100 × 720) and narrower light (850 × 720) views have no horizontal overflow.
  Theme checks invoke the real theme helper, including its background token.
- [x] Trusted-input playback reaches the end with no media errors. In the local
  development run, 880 animation frames were sampled and the 95th-percentile
  interval was about 7.1 ms. This is local preview evidence, not an export-speed
  or universal hardware performance guarantee.
- [x] 254 frontend tests and 258 native tests pass; two pre-existing native
  display-dependent tests are ignored. TypeScript and the production frontend
  build pass. The Impeccable detector reports no findings for the changed UI.

`scripts/studio-phase6-check.mjs`, `studio-phase6-ui-check.mjs` and
`studio-phase6-playback-check.mjs` target the isolated preview on CDP 9242. Run
from the repository root with `%LOCALAPPDATA%\GlintValidation\Phase6` as the
artifact-directory argument. Export checks create their own media and project;
UI/playback checks expect that fixture project to be open. Artifacts include the
MP4, editable project, raw JSON results and dark/light screenshots. No installer
was rebuilt or installed for Phase 6.

Commits: `502ed14` (schema/export) and `9eaca82` (editor/preview), followed by
the acceptance scripts and this checkpoint record. Stop here; Phase 7 needs a
separate scope decision.

## Editor usability follow-up

The preview and playback controls now stay visible while the scene list and
inspector scroll independently. A wider inspector separates Scene settings from
Look & canvas. When the editor has at most 760 px of available width (including
the navigation rail), a Scenes / Scene settings / Look & canvas switch uses the
area below the preview. Field labels stay on one line; long selected filenames
can scroll horizontally instead of wrapping across the inspector.

Themed Select portals clamp horizontally and flip vertically within the window.
Keyboard highlighting scrolls only the menu, without moving its inspector.
Home and Library navigation retain the local video draft immediately. If draft
storage fails, navigation still requires Save and leave; an active export also
blocks leaving. New/Open continue to confirm replacement of unsaved work.

Home has one Projects entry with Video project (create/resume) and Open saved
project. The latter accepts both `.glint` and `.glint-video`, with confirmation
before replacing a different unsaved video draft. The Home scrolling-capture
shortcut was removed as requested; the capture implementation is retained.

Validation: 254 frontend tests and the production frontend build pass. The
isolated browser check covers dark 1400 x 850 / 1100 x 720 / 850 x 600 and light
850 x 720, preview aspect, one-line labels, inspector overflow, dropdown bounds,
right-edge and upward placement, Home/Library navigation, draft recovery,
combined project filters/routing and failed-storage protection. No browser
runtime errors were recorded. Impeccable reports no findings. Native export
code was unchanged, so this follow-up does not repeat the native export suite.

Run `node scripts/studio-phase6-layout-check.mjs` with Vite and the isolated
native preview on CDP 9242. It reads the open draft for realistic media but
performs all mutations in its own headless Chrome profile with stubbed native
IPC. It verifies that the real preview's draft and route remain unchanged.
Screenshots and `result.json` are under
`%LOCALAPPDATA%\GlintValidation\Phase6\Layout`. No installer was rebuilt.
