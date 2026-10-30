# Glint 0.2.1

This release improves capture sharing, Library responsiveness, screenshot text indexing and the details of the Windows interface. It also introduces the new glass capture icon.

## Capture copy and sharing

- Image copies provide PNG data, an explicit Windows bitmap and a persistent PNG file attachment in a single clipboard transaction. This improves compatibility with image apps and coding agents that expect different clipboard formats.
- Clipboard contention is retried for up to two seconds. A failed automatic copy is reported instead of silently being treated as a success.
- A newer Glint copy supersedes an older pending capture copy. HUD Copy confirms completion after the clipboard write succeeds.
- Attachment files remain available independently of the temporary capture tray.
- Windows clipboard history still has its own [4 MB per-item limit](https://support.microsoft.com/en-us/windows/apps/using-the-clipboard). Full-resolution direct copy is preserved; Glint does not silently shrink captures to fit history.

## Library and screenshot text search

- Home warms the Library metadata and shares one request with other views. The first Library navigation uses the existing session snapshot while reconciling files in the background.
- A temporary refresh failure keeps the previous successful list visible.
- Background OCR uses a dedicated text-only path and at most two workers on CPUs with eight or more logical processors. Smaller CPUs keep one worker. Privacy review keeps detailed word geometry.
- Uniform background margins are skipped without discarding visible pixels, with context retained around the content. Already indexed, unchanged screenshots are reused.
- Engine installation and Search screenshot text now live in Settings > Capture. Model status and download details are shorter; downloads remain explicit and removable.

## Home and interface

- Recent shows at most ten captures, with up to five columns. New captures replace the oldest entry in Recent; the full collection remains in Library.
- Resume follows Recent directly, instead of being pushed to the bottom of a tall window.
- Shortcut keycaps have equal edges and consistent sizing for centered labels.
- Thin native WebView2 scrollbars apply to Extract Text, Settings and editing inspectors, with visible light/dark thumbs and system colors in high-contrast mode.
- The supplied glass capture artwork replaces the application, taskbar, Windows shortcut, installer and tray icon assets. README artwork and feature documentation are updated.

## Installation

Windows x64 setup, MSI and a ZIP with recording sidecars are provided. No OCR or caption engines are bundled. Optional Tesseract uses the same pinned, separate runtime package as 0.2.0; Small and Medium models remain on-demand downloads. Installers retain the existing unsigned distribution setup.

Validation results and coverage limits are recorded in the [release validation report](https://github.com/sanirudh17/Glint/blob/v0.2.1/docs/RELEASE_0.2.1_VALIDATION.md).
