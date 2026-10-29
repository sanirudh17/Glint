# UI improvements

Isolated on `ui-improvements`, based on the committed OCR upgrade. Nothing is merged into `main`.

## Direction

Refine the existing Glint interface: keep Manrope, the teal accent, the icon rail, the capture grid, and familiar editing workflows. Controls stay at 28–32px, body text at 12–13px, icons at 14–16px. Add 4px between related form groups where needed; reduce excessive outer gutters instead of scaling the whole app up. Large previews remain the focus.

Taste app-screen direction: True-black flat, seed 2044167774, retaining the brand palette and type. Adapt its neutral surfaces and lightness hierarchy to Glint's existing charcoal. The user's brief takes precedence over the dealt large shell and inverted primary: retain the narrow navigation rail and teal action buttons. Impeccable's Operate/polish guidance governs bounded review; UI UX Pro Max's compact density guidance informs alignment, accessible names, and control states. This is a refinement of the current implementation, not a replacement design system.

## References

- [CleanShot X screenshots](https://cleanshot.com/screenshots): keep capture content prominent, group markup controls by their job, keep sharing actions together.
- [CleanShot recording](https://cleanshot.com/screen-recording): preview, editing controls and output actions form one workspace.
- [Shotbase](https://shotbase.com/): restrained grouped controls and clear selected states, consistent treatment across stills, recordings and the library. The supplied `.app` address was unavailable; the current official product site is `.com`.

These are interaction and grouping references, not copied assets or a macOS skin. Reference images downloaded for inspection stay outside the repository.

## Scope

- Shared buttons, inputs, selects, switches and field labels; default/hover/focus/disabled states.
- Main shell flush with the top; compact window controls without the separate Glint title strip.
- Borderless annotation/trim windows with integrated minimize, maximize/restore and close controls. Studio close retains its existing save guard.
- Home, Library and Settings gutters; label/switch alignment; storage path and notification controls.
- Editor toolbars and Done action; compact Studio panels, transport buttons and video-project inspector.

## Validation

- Production frontend build and TypeScript checks passed; 265 tests passed, including compact-window popup placement, narrow viewports and upward placement.
- Native review executable built successfully with FFmpeg, FFprobe and Tesseract sidecars. All review captures, models and settings use an isolated profile.
- Actual WebView2 review covered Home, Library, Appearance, Capture and Storage at normal and compact sizes in light/dark themes; annotation preview and Frame controls; Studio frame playback/waveform loading; video-project title-card preview and editable fields. Maximize/restore changed the actual native window state.
- Capture Area uses white lettering/icons on the selected accent in light mode and black lettering/icons on the selected accent in dark mode. Projects now uses the native popup layer with viewport-clamped placement, resize/scroll updates, wrapped descriptions and native outside-click/Escape dismissal.
- Taste source checks passed for the reviewed components. Impeccable's source scan reported only the retained sidebar width transition; preserving the familiar expand/collapse interaction is intentional.
- External drag into a terminal, audible audio output and a complete multi-clip export were not repeated in this styling pass. No claim is made that those workflows received a fresh end-to-end test.

The review executable and screenshots are under `%LOCALAPPDATA%\GlintValidation\UIImprovements`. Nothing is merged into `main`.

## Responsive follow-up

Settings sections and help text now use the available panel width, including maximized windows; selects grow within a bounded readable width. Video-project inspectors scale from 320 to 440px with the workspace, Studio from 344 to 440px, and screenshot right-hand panels from 292 to 380px. Existing compact-window layouts still apply. Done uses the shared 16px, 1.5px-stroke checkmark before its label.

Production build passed after this follow-up. Actual WebView2 inspection confirmed Settings expands at restored and maximized sizes, and the editor renders the left-hand Done icon and wider Privacy review panel.

## Capture surfaces and crop controls (24 October)

- Crop ratios, apply/cancel and keyboard guidance occupy a separate dock above the image. The canvas viewport accounts for that row, so full-window images still leave the controls outside the crop area.
- The Done action uses a lighter double-check completion glyph, aligned before the label.
- OCR review, scrolling controls, recording selection and the recording pill share compact control proportions, clearer grouping, wrapping and focus states. Protected recording controls retain capture exclusion.
- Scrolling capture is configurable under Hotkeys, with the same persistence, conflict checks, clearing and restoration as other capture actions. A configured global shortcut opened region selection and the scrolling controller in the isolated native review app.
- Speaker Notes has borderless integrated window controls instead of native chrome plus a duplicate Close button.

Screenshot-text search remains optional. Native PP-OCRv6 Small plus the actual SQLite FTS search found all 48 expected queries across 16 owned cases with zero recognition errors. Six 1920x1080 screens cover document, terminal and dashboard layouts in both themes; eight small-font cases and two blank/transparent cases cover further limits. Median processing time was about 0.94 seconds per image on this machine (background indexing); results are in `validation/library-search-2026-10-24.json`. These are controlled fixtures, not a claim that arbitrary photos, tiny lettering or identifiers are recognized perfectly. The Settings description now states that limitation.

Actual WebView2 checks covered the unobstructed crop dock, OCR popup, recording selector, scrolling-shortcut launch, and drawing/saving an editable video arrow. The recording pill and scrolling controller can be excluded from screen capture; accessibility/state inspection remains available. A separate headless preview command was rejected by automatic approval review, so it was not used as visual evidence. The user's active recording was left untouched.

Final follow-up checks: 269 frontend tests and 272 native tests passed (7 native tests require explicit integration fixtures). The production frontend build passed. Video annotations, Studio recording behavior and startup changes are documented separately in VIDEO-ANNOTATIONS.md.

## Editor refinement follow-up

The screenshot editor keeps Images, Frame and Corners together, with Drag, Export and Done as its three output actions. Copy remains available from the HUD. Contextual styling has its own compact row, keeping sliders and color choices visible without horizontal scrolling. Crop uses one compact row outside the image, with a grouped aspect selector, current pixel dimensions and Apply crop/Cancel; the selected ratio remains constrained during resizing.

Privacy review opens only through Find sensitive text and closes when changing tools. Blur has a dedicated strength slider and a deterministic pixel blur instead of shared color/stroke controls and coarse whitening. Step badges are smaller, independently sized and center the actual numeral glyph bounds. Spotlight uses aligned SVG shape icons and omits layer-order actions, since its shared dim layer does not use that ordering.

Recording selection separates its instruction from the input controls. The pill retains audio, camera and effects, and adds a compact live-drawing strip. The capture-excluded drawing surface keeps marks editable in Studio. Studio saves and export validation are recorded in VIDEO-ANNOTATIONS.md.

Validation for this follow-up: 273 frontend tests, 274 native tests (8 gated integration tests), TypeScript/production build and optimized native review build passed. The synthetic audio-tail export and annotation MP4 roundtrip passed. The complete reported 38.229-second recording exported successfully with 2294 video frames; the source and project were preserved. The app was launched only after implementation and automated checks. Windows kept a full-screen video above it; the user then opened Studio and chose to complete the remaining visual/live-drawing review later. No completed interactive live-stroke or new theme screenshot check is claimed for this follow-up. The app is left running for that review.


## Neutral themes, cursor following, and reversible glass (29 October)

New Studio zooms and recording zoom marks use Follow cursor when recorded cursor coordinates are available. Existing saved zooms remain unchanged, and Fixed point remains selectable. Start/End determines the sustained zoom interval; the existing smoothed source-time camera and edge protection are shared with native export. A curved-path regression covers sustained scale and cursor visibility. Ordinary imported videos without cursor metadata retain fixed-point controls.

Dark surfaces, borders, and secondary text now use neutral black/gray rather than blue-gray. Seek's `app/src/appearance.rs` and `app/src/instance.rs` informed a separate optional desktop-acrylic implementation, neutral tint, translucent controls, and compositor-rounded corners. It is Windows acrylic, not Apple's refractive Liquid Glass. The native material requires Windows 11 build 22621 or later; unsupported systems retain solid surfaces. See Microsoft's DWM_SYSTEMBACKDROP_TYPE documentation: https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type.

The independently reversible glass change includes Appearance > Acrylic glass, persisted settings and cross-window updates, distinct translucent app/settings/editor rails, capture metadata footers, and frosted normal/accent controls in both themes. Capture-excluded full-screen selectors and ink overlays keep their existing affinity and geometry. No source/export pixels acquire the app-window glass effect.

Turning glass off first paints the opaque frontend for two animation frames, then covers the native WebView before removing its backdrop. This prevents the uncovered desktop frame. Tests cover the ordering, unavailable native support, and stale responses. Pointer-click focus no longer keeps a navigation tooltip visible; keyboard focus still shows it. Editor styling controls are centered and No fill uses a centered Lucide SVG. Video resume applies the selected clip's playback rate before playing and handles rejected play requests rather than leaving false playing state.

Validation: 279 frontend tests and 275 native tests passed (8 native integration tests remain gated). Production TypeScript/Vite and native review builds passed. The native DWM backdrop readback returned material 3 (desktop acrylic). Actual WebView screenshots showed dark Home and light Appearance, including frosted rails, capture details, and buttons. The updated isolated review app was restarted with approval after the checks. The one-frame transition itself and live cursor-following export were not recorded afresh in this pass; final user review remains distinct from automated coverage. Nothing merged into main.


## Editor first-frame gate and utility glass

The native editor now builds and reloads hidden, seeded with the persisted theme/accent. A real editor_present command reveals it after image decoding, settings/material setup, font readiness and two paint frames; the previously emitted editor-ready event had no native consumer. Reused windows do not restore/show before readiness. Presentation is one-shot per open and is cancelled on close, so ordinary look edits do not refocus the editor. Decode failures present an actionable message instead of leaving a hidden window indefinitely.

Three regression tests cover delayed material/font readiness and cancellation between paint frames. All 282 frontend and 275 native tests passed (8 native integration tests gated); production frontend and native review builds passed. The isolated app was restarted with the new native executable. Cold and reused opens completed with the owned fixture, confirmed through native window/accessibility state. A covering window prevented direct visual confirmation of the brief transition; no high-frame-rate no-flash claim is made.

The GIF export strip, export-result surface, crop dock, image-list surface, floating zoom controls and screenshot inspector now use distinct quieter glass tints in both themes. Image/video pixels and transparency grids remain untouched.
