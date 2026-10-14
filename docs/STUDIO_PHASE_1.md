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

- 1.0: shared LookConfig, shared controls, cross-window named preset store.
- 1.1: measured compositor comparison; cached Rust CPU composition selected.
- 1.2: cursor-free Studio capture, local event stream, pause-aware video timestamps.
- 1.3: versioned project folders, reopen, autosave, persisted timeline/camera settings.
- 1.4: video look, shared presets, source crop, custom shadow/border, canvas preview.
- 1.5: editable cursor smoothing/style/size/idle hiding, click size, click/key toggles.
- 1.6: MP4 export with hardware probes and x264 retry, progress/cancel, atomic output.

Requested UI refinements reuse Settings' themed Select/Switch components, add
color swatches and custom numeric controls, separate export filename/folder,
and use a compact inspector with a hover-only themed scrollbar.

## Acceptance evidence

- Frontend production build passes; 206 frontend tests pass.
- Native build passes; 212 native tests pass, with two existing
  display-dependent tests skipped. A frame-pixel regression checks rounded
  corners and physical-to-source cursor alignment with crop/DPI and effect toggles.
- The real Tauri app opened the generated Studio folder and exported a 60-second
  1920x1080/60fps MP4 in 33.995 seconds using **AMF hardware encoding**.
- Six synchronized flash/beep markers were generated at 0, 10, 20, 30, 40 and
  50 seconds. Exported audio onsets stayed within 21.25 ms of those timestamps;
  there was no accumulating audio drift. Video duration was 60.000 seconds.
- Source/preset/project logic tests cover crop round-trip, unique ids after
  reopening, reordered cuts/speed time mapping, and negative monitor origins.
- Taste source lint and Impeccable's detector pass for the new controls. The
  inspector was reviewed in the real WebView2 app, preserving Glint's design.
- Final crop regression verified in the real app: typing `2000` does not apply
  `2`, `20` or `200`; Enter clamps to the 1920 px source limit, and a valid 800 px
  crop applies on blur. Numeric steppers remain immediate.
- Background pixel regressions cover solid colors, all 16 gradient endpoints,
  transparent MP4 black, opaque/semitransparent/transparent image pixels,
  radius, shadow color, centered solid/dashed border widths and all aspects.
- Corrected gradient swatch direction, PNG alpha flattening, odd-pixel FFmpeg
  crop precision, dashed border spacing and export shadow intensity.
- Real WebView2 checks confirmed every background mode, image upload, color and
  framing slider, border style and aspect updates the saved project. Four short
  exports (solid, gradient with shadow/dashed border, transparent, alpha image
  with odd-pixel crop) passed output-size and encoded-color checks. The final
  shadow uses a cached linear-time blur; the 0.5-second square fixture completed
  in 4.32 seconds including hardware probing and thumbnail generation.

**Manual acceptance is pending the user's checklist below. Phase 2 has not started.**

## Manual closing checklist

- [ ] Studio panel is compact; scrollbar is hidden at rest and themed on hover.
- [ ] Dropdowns, switches, color swatches and crop steppers work in dark/light themes.
- [ ] Studio recording saves video/events/project, excludes baked cursor/effects,
  handles pause/resume, and opens its editor on Stop.
- [ ] Solid/gradient/image looks, padding, rounding, shadow/borders and all aspects
  match preview and exported MP4.
- [ ] Cursor smoothing/style/size/idle hiding and click/key toggles affect export.
- [ ] Crop keeps the cursor aligned; cuts, speed, reorder and camera overlay work.
- [ ] Close/reopen preserves every edit; a preset saved in either editor loads in both.
- [ ] A real 60-second 1080p60 recording exports with audio aligned from start to end.
- [ ] Cancelling export stops rendering and leaves the source/project intact.
- [ ] Quick recording and existing screenshot documents behave as before.

No Phase 1 feature was intentionally cut. Manual recorder/device combinations and
final user acceptance remain to be confirmed. Generated validation media stays
outside the repository in the OS temp folder; no large assets were added.
