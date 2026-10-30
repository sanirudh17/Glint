# Glint 0.2.0 release validation

Validated on Windows x64 on 30 October 2026. The release decision uses targeted checks across the implemented Studio and capture phases, rather than claiming an exhaustive new manual pass through every popup or hardware combination.

## Automated and native acceptance

| Area | Result |
| --- | --- |
| Frontend | 287 tests across 49 files pass on Vitest 5.0.5; TypeScript and production Vite build pass. |
| Native core | 281 tests pass. Fourteen integration/display tests are explicit gates; thirteen current-feature gates were exercised separately. The remaining historical Indra candidate benchmark is not a shipped engine. |
| Recording/export | Recorder suite: 123 checks pass, including real annotation MP4, audio-tail/cleanup/click-sound export, fixed and cursor-following zoom, scene crossfade and GIF encode/decode checks. |
| Cursor/zoom | Fixed focus remains locked; following focus moves in decoded MP4 frames. The following export also passed on the machine's AMD AMF encoder. Smoothing, crop, negative monitor origins, DPI mapping, marker activity, retiming and manual-over-auto priority are covered by pure/native tests. |
| Capture | 39 capture checks pass, including real Windows display capture and window enumeration, plus scrolling overlap, fixed regions and localized-update fixtures. |
| OCR/privacy | Small engine font/theme and sensitive-token geometry fixtures pass. Medium exact-text corpus completes. Six live model/runtime downloads match pinned sizes and SHA-256 values. |
| Screenshot text search | 122/123 phrases found in 42 owned screenshots, zero engine errors. Ordinary readable categories pass; the miss is a half-size phrase with an OCR spelling error. |
| Optional OCR lifecycle | Separate Tesseract archive verified, extracted, used on owned text and removed. Incomplete archives are rejected before extraction. Removing one engine preserves others. A loaded neural model is removed, reports a retained runtime when needed, reinstalls successfully and completes runtime cleanup on next startup. |
| Caption engine | Existing hash-verified tiny.en model transcribes owned synthesized speech locally; source-time caption parsing, silence padding and invalid-caption rejection pass. |
| Updater | Matching stable tag/setup filename required; traversal, encoded paths, standalone binaries and mismatched versions are rejected. |
| Dependencies | Tauri core/frontend API/CLI aligned to 2.12.4; npm audit reports zero known vulnerabilities after compatible patches and the test-runner upgrade. |
| Lint | Cargo Clippy completes successfully. Non-gating existing lint warnings remain. |

## Package verification

Both the NSIS setup and MSI build successfully. `scripts/verify-release.py` passes 21 checks over versions, production identifier, recording sidecars, package files and checksums. The MSI File table contains only glint.exe, ffmpeg.exe and ffprobe.exe. The NSIS file list and the ZIP distribution contain no Tesseract, ONNX runtime, OCR weights or caption engine.

The Tesseract ZIP is a separate optional download asset, not an application installer resource. Its SHA-256 matches the application pin. Small/Medium models and ONNX Runtime download from the pinned upstream URLs only after Install is pressed.

The executable ProductVersion is 0.2.0. Application data keeps the production identifier com.glint.app. Testing uses owned media and separate validation profiles; no user capture was added to the repository or release assets.

Checksums and sizes are recorded in `validation/release-0.2.0.json` and the release's SHA256SUMS.txt. Public download verification is performed after publication and recorded separately.

## Manual scope and limits

Fresh visual observation covered the compact dark Home cards, dark acrylic Appearance surface and its open frosted theme menu. The interface also retains the refinements iterated through the user's screenshots. Further manual testing was narrowed at the user's direction after the targeted checks passed. This report does not label the OCR install/remove buttons, every popup, live drawing, or every physical audio/camera combination as freshly manually tested.

Recognition can miss small, blurred or unusual text and exact identifiers. Privacy suggestions require review and acceptance. Windows transparency and capture exclusion depend on supported OS/compositor behavior. A loaded ONNX DLL may require restarting Glint to finish disk cleanup. Multi-camera and simultaneous multi-display recording remain deferred. The installers retain the existing unsigned setup.
