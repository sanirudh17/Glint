# Glint 0.2.2

This patch improves window presentation, project resume and Home spacing while preserving Glint's acrylic appearance.

## Window presentation and acrylic

- Main stays hidden until settings, desktop material, fonts and its first UI frame are ready. The timed fallback that could reveal an unfinished window has been removed.
- WebView2 receives the transparent default background before its controllers are created.
- Native paint protection prevents the window class from clearing the resized surface white before the WebView repaints.
- Acrylic keeps its active appearance while the window remains visible, including when maximized. Minimized and hidden windows deactivate normally so reopening can sample the current desktop.
- Maximize and restore use native resize transitions, separate from the stable tray-opening path. The existing dark/light glass palette and dropdown materials are retained.
- The normal window keeps its established 1100 by 720 logical-pixel default size.

## Home

- Recent retains compact 16:9 previews and a maximum of ten captures.
- Moderate section spacing separates New capture, Recent and Resume without stretching the previews vertically.
- Maximized Home balances available height around the Recent block. Home without resumable projects does not reserve a phantom Resume row.

## Project resume and editor

- Main remains available while a project or image decodes; it minimizes only after the prepared editor appears.
- A hidden main window is no longer briefly shown just to minimize it during editor opening.
- Each editor open has a presentation identifier. An old image decode or delayed frame cannot present a newer request or consume its pending state.
- Closing the editor cancels pending loads and presentation.

## Installation and compatibility

Windows x64 setup, MSI and a ZIP with recording sidecars are provided. No OCR or caption engines are bundled. Optional engines remain explicit downloads, and capture clipboard formats are unchanged. Installers retain the existing unsigned distribution setup.

Windows acrylic may resample and shift the blurred backdrop as window bounds change. This accepted compositor behavior is preserved rather than replaced with a simulated background.

Validation results and coverage limits are recorded in the [release validation report](https://github.com/sanirudh17/Glint/blob/v0.2.2/docs/RELEASE_0.2.2_VALIDATION.md).

All five public downloads were verified against the local files byte for byte and by SHA-256. See the [published asset verification](https://github.com/sanirudh17/Glint/blob/main/validation/release-0.2.2-public.json).
