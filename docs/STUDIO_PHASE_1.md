# Studio Phase 1 verification and acceptance

Source: the supplied October 2026 plan, copied verbatim to `docs/BUILD_PLAN.md`.
The repository root is above `glint/`. No `AGENTS.md` applies. The working tree
was clean at baseline `8bc27c3`.

## Verified assumptions

| Plan concept | Existing implementation | Finding |
| --- | --- | --- |
| Screenshot frame model | `glint/src/editor/useEditorStore.ts`, `composition.ts` | Solid, gradient, transparent; padding/radius/shadow/aspect. Window/browser chrome already exists. Image and border do not. |
| Gradients | `glint/src/editor/gradients.ts` | 16 two-stop procedural presets at 135 degrees. |
| Recorder | `glint/src-tauri/src/recorder/mod.rs`, `ffmpeg.rs` | DDA capture with GDI fallback; both support cursor exclusion. |
| Recording effects | `glint/src-tauri/src/recorder/fx/{mod,hooks,window}.rs` | Effects bake into the source. Hooks emit display events without persistence. |
| Webcam/audio | `recorder/{audio,cam,pipes}.rs`, `src/recorder/RecCam.tsx` | WASAPI audio; optional separate camera track already exists. Preserve both camera modes. |
| Video editor | `glint/src/recorder/TrimView.tsx`, `trimModel.ts`, `TrimTimeline.tsx`, `TrimFilmstrip.tsx` | Cuts, speed, reorder and fades exist. No persisted video project, look or crop. |
| Export | `glint/src-tauri/src/recorder/trim.rs` | FFmpeg trim with progress; fixed x264, no cancel. Hardware probing exists for recording only. |
| Binaries | `glint/src-tauri/binaries/` | FFmpeg and FFprobe present locally, excluded from Git. |
| Screenshot documents | `glint/src-tauri/src/editor/document.rs` | Existing versioned documents store frontend JSON. Keep legacy defaults. |

Phase 1 acceptance explicitly requires video crop persistence despite listing crop
again in Phase 7. Include a basic source-coordinate crop in Phase 1. Zoom/masks,
gradient expansion and other later phases remain out of scope.

## Tasks

- 1.0: shared LookConfig and cross-window named preset store; frontend build and 197 tests pass.
- 1.1: compositor comparison and decision pending.
- 1.2–1.6: pending.

## Acceptance evidence

Pending implementation and integration checks. No criterion is claimed complete yet.
