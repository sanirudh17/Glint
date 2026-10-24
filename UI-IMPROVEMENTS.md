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
