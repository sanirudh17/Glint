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
