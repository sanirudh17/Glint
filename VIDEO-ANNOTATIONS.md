# Editable video annotations

Implemented on `ui-improvements`; nothing is merged into `main`.

The [Slice 0.2.2 article](https://slice.rit3zh.dev/blog/slice-0-2-2) describes drawing marks that can later be moved, restyled and retimed. Glint implements that editing model in Studio and multi-scene video projects, retaining its existing compact controls and teal identity. The X reference was not accessible to the research tool; the article was fetched directly. No Slice code or assets were copied.

## Editing

Open Edit > Annotations in Studio, or Annotations under a selected scene in a video project. Choose pen, highlight, arrow, rectangle, ellipse or text, then draw on the preview. Select a mark to move it, change its color/stroke/text, duplicate or delete it. A Marks track and start/end fields control visibility. Per-mark undo/redo is available; Escape exits drawing, and keyboard undo/delete is scoped to annotations while a mark is active.

Coordinates are normalized to the composition. Source-time intervals survive trims, speed changes and reordering. Vectors remain editable in saved Studio metadata and `.glint-video` projects; old files without annotations retain their existing behavior. Export prepares bounded transparent PNG layers with the same canvas painter used by preview. Native MP4/GIF rendering decodes them once and composites only active marks. Timed marks on still/title scenes use the animated frame path rather than flattening the initial frame forever. Projects support up to 64 marks per scene/Studio recording and 4096 points per stroke; native decoding and painted-pixel budgets bound memory use.

## Recording controls

New recordings always use Studio metadata; the selector no longer asks for a mode. The recording pill retains webcam, click, keystroke and spotlight controls. Live Studio effect changes are timestamped alongside input events and respected by both preview and native export. The editor can disable Follow recorded toggles to apply global effect choices instead. Studio's live FX window is excluded from source capture so those effects remain editable rather than being burned into the source twice. Existing Quick recordings still open.

## Validation

- Frontend tests cover timing boundaries, movement bounds, invalid vectors and recorded effect timing/override.
- Native tests cover defaults, shortcut persistence/conflicts, annotation validation, alpha/time composition and effect timing.
- A real FFmpeg MP4 encode/decode test checks frames before, during and after an annotation interval.
- Actual WebView2 drawing produced a visible arrow and saved its editable vector/timing into the isolated Studio project.
- Actual native review confirmed Studio is the default, the recording pill exposes all three FX toggles plus webcam, a live click-effect change is timestamped, Speaker Notes has one integrated Close button, and the Zoom button saves a marker that becomes a 2x zoom segment in Studio.

Live drawing while capturing is not part of this editing feature; annotations are added in the video editors.

## Opening Studio and marking zooms

The trim workspace waits for both media and Studio metadata before revealing its controls. Reusing an existing window hides the previous workspace until the new target is ready; late waveform results are discarded. External videos use the same readiness handshake.

Ctrl+Alt+Z places a source-time zoom marker around the cursor. It does not zoom the desktop during capture: Studio imports it as an editable 2x focus segment for preview/export. The Zoom button on the recording pill performs the same action and displays confirmation. The shortcut uses a Windows session hotkey on the recorder message-pump thread, with no repeat while held and automatic release when recording stops. If another application has reserved it, the input-hook fallback and Zoom button remain available. Paused recordings reject new markers with a Resume recording message.

Final verification: 269 frontend tests, 272 native tests (7 explicitly gated integration tests), production frontend build and native review build passed. The real MP4 roundtrip passed again after the recording changes. Native Windows key injection generated a Ctrl+Alt+Z marker and confirmation, the saved marker appeared as Zoom 1 in Studio, and RegisterHotKey confirmed the chord became available after Stop. Both a new Studio recording and a previously imported video reopened in the same native Studio window with the correct target. Protected popup pixels are not claimed as screenshot evidence.
