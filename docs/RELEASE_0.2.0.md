# Glint 0.2.0

Glint 0.2.0 brings Studio recording and video editing, editable cursor-following zoom, video annotations, scrolling screenshots, shared screenshot/video looks, optional local OCR engines and a refined Windows interface.

## Studio recording and editing

- Studio is the default recording workflow. Screen media and editable cursor/input metadata are kept together, while the original source remains available.
- Record a region or full screen with system audio, microphone and an optional webcam. The recording pill retains live audio, webcam, cursor, click, keystroke and spotlight controls.
- Pause, resume, stop or restart from the recording controls. Speaker notes open separately and are excluded from capture.
- Recordings and imported videos open directly in Studio, without briefly showing the old trim interface or a previous recording's controls.
- Save project waits for queued edits and confirms when they are saved. Reopening preserves cuts, ordering, speed, looks, zooms, masks and annotations.
- Split, remove, restore and reorder timeline spans, change per-span speed, and use timing undo/redo. Ctrl+K opens editor commands.

## Cursor-following zoom and cursor effects

- Add fixed-focus or cursor-following zoom segments. Following zoom tracks the recorded pointer while maintaining focus inside the zoomed view and source boundaries.
- Adjust zoom scale, timing, framing offset, entrance/exit duration and easing. Pick a focus point directly in the preview.
- Generate automatic zooms from nearby clicks while preserving manually edited segments.
- Press Ctrl+Alt+Z while recording, or use Zoom on the recording pill, to create a source-time marker. Markers become editable zooms in Studio. This does not magnify the live desktop.
- A capture-excluded confirmation indicates where a zoom was marked. Marking also keeps a stationary cursor visible briefly.
- Edit cursor visibility, smoothing, size, arrow/dot style, idle hiding, click ripple size, spotlight and keystrokes after recording. Preview and export share the same source-time mapping through cuts, speed changes and reordering.

## Video annotations and privacy masks

- Draw during a recording from the pill's Draw controls, then refine those editable vectors in Studio.
- Add and edit timed video annotations from Edit & draw > Annotations. Annotations remain separate from the source and can be positioned and retimed.
- Add blur, pixelation, solid or highlight masks with source-space keyframes. Masks remain attached to source content through zoom and crop.
- Live drawing and zoom confirmation overlays are excluded from the source capture.

## Shared looks and video polish

- Apply solid, gradient, image or transparent looks, padding, aspect ratios, corner rounding, shadows, borders, chrome and watermarks to screenshots and videos.
- Use additional gradient styles, portrait/social output sizes and optional animated gradient backgrounds for video.
- Choose webcam overlay, side-by-side or camera-only layouts, with supported webcam shapes.
- Apply motion presets, title entrances, motion blur, typing/idle speed suggestions, and reviewed silence removal.
- Optional noise reduction, volume leveling and retimed click sounds are available for MP4 exports.
- Optional local English captions use a separately downloaded CPU engine. Review and edit text and timing, burn captions into exports, or remove a source span through its caption and undo that edit. Caption generation supports recordings up to 30 minutes.

## Multi-scene video projects

- Combine videos, still images and title cards into saved .glint-video projects.
- Reorder scenes, trim source ranges, choose cut/crossfade/slide transitions and share a consistent look.
- Preview transitions and export combined audio/video. Title cards support entrance motion and simple decorative shapes.
- Source files are preserved, and project navigation protects unsaved drafts.

## Scrolling capture, GIFs and export

- Capture a manually scrolled area with bounded overlap matching, fixed-panel handling and tolerance for local page updates. Scrolling capture now has a configurable shortcut in Settings.
- Export Quick or Studio GIFs with configurable FPS, maximum width and looping. GIFs are limited to 60 seconds and 25 MB and contain no audio.
- Studio GIFs use the selected look. Transparent GIFs retain crisp edges; MP4 fills transparency with black.
- Reveal the exact exported file through Windows Explorer, copy exported video files, and drag captures into other applications.
- Small audio/video tail differences no longer cause incomplete-output errors or writing extra frames to an already closed encoder pipe. Export errors preserve encoder diagnostics, and supported hardware encoding can fall back to software.

## Optional OCR engines and local search

- No OCR runtime or model is bundled in the installer. Choose Tesseract (English), PP-OCRv6 Small or PP-OCRv6 Medium in Settings > Auto-save and press Install beside the selector.
- Selecting an uninstalled engine never starts a download. Installation shows progress and supports cancellation and retry; downloaded artifacts are pinned by size and SHA-256.
- Remove from disk removes Glint's managed copy without touching a separate system OCR installation. A loaded ONNX runtime may finish deletion after restarting Glint; its model is removed immediately and can be reinstalled.
- Capture Text, screenshot text indexing and sensitive-text review use the selected installed engine. Small is the recommended engine based on the controlled screenshot evaluation; Medium is available as an alternative.
- Search saved screenshots by readable text, name or date. Optional OCR naming does not overwrite manual titles. Disabling text indexing clears its index; deleting or replacing captures removes stale text matches.
- Privacy review suggests possible sensitive text for the user to accept. Installing Tesseract alongside a neural engine enables an additional independent privacy pass. OCR can miss small or blurred text and exact identifiers; review every suggestion.
- All recognition runs locally. Network requests are limited to explicit engine downloads and release checks/downloads; captures are not uploaded.

## Screenshot editor improvements

- Crop aspect controls sit outside the image, with clearer presets, apply/cancel actions and improved resize behavior.
- Tool options match the selected tool: blur uses relevant settings, step badges have smaller centered numbers, and spotlight controls omit irrelevant layer actions.
- Sensitive-text review opens only when requested and closes when leaving the tool.
- The tool rail remains visually quiet. Context options are centered, Copy is directly available, and compact layouts preserve space for the canvas and inspectors.
- Editor presentation waits for its current image, fonts and final material before revealing the workspace. Windows composition handling was updated to reduce the initial white flash.

## Themes and interface refinement

- Neutral dark and light themes replace the previous blue-tinted dark palette.
- Optional Windows acrylic reflects the desktop with shared glass controls, themed choice menus and a safe transition back to solid surfaces. Dark glass uses a tuned 72% black tint for clearer backdrop visibility.
- Choice menus use one floating layer and a consistent frosted finish across Settings and editing inspectors. Expandable Studio sections remain unboxed.
- Light-mode enabled switches use white thumbs. Theme changes preserve explicit and System appearance behavior across windows.
- Home and Library share compact two-line capture details, including useful dimensions for unnamed captures. Library margins use the available width more efficiently.
- Recording cards offer Open video instead of sending video files to the screenshot pin decoder. Screenshot pinning remains available.
- Improved compact-window spacing, save/export footers, hover actions, tooltips, shortcut help and sidebar alignment.

## Compatibility and downloads

- Windows x64; acrylic requires Windows support and enabled system transparency. Solid mode remains available.
- Use the NSIS setup executable for the normal installation/update path, or the MSI for MSI-based deployment.
- The ZIP distribution contains Glint and the recording sidecars; it does not include OCR or caption engines. WebView2 is required.
- The separate Glint-OCR-Tesseract-5.4.0-x64.zip asset is downloaded only when Install is pressed for Tesseract. It is not an application installer.
- SHA256SUMS.txt lists the release asset checksums. Installer signing follows the existing unsigned release setup.
- The updater accepts only the matching Glint setup filename under its own stable release tag; path traversal, encoded paths and standalone executables are rejected.

## Validation

The release review covers the frontend and native suites, real MP4 encode/decode for fixed and cursor-following zoom, annotations and audio cleanup, scene crossfades, GIF output, optional OCR package use/removal, loaded-model removal/reinstall, OCR/privacy fixtures, capture smoke checks and installer contents. Detailed coverage and limits are recorded in the [release validation report](https://github.com/sanirudh17/Glint/blob/v0.2.0/docs/RELEASE_0.2.0_VALIDATION.md).
