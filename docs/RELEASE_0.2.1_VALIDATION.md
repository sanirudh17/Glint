# Glint 0.2.1 validation

Windows x64, 30 October 2026. Testing used generated, owned images and an isolated review profile. The running production app and its capture database were not replaced.

| Check | Result |
| --- | --- |
| Frontend | 289 tests across 50 files pass; TypeScript and production build pass. |
| Native | 284 regular tests pass; 18 tests remain explicit integration/display gates. |
| Clipboard | Two real Windows gates pass: PNG/bitmap/file attachment roundtrip and retry while another thread holds the clipboard. A regular regression verifies that a superseded copy cannot overwrite a newer request. |
| Live copy/paste | Copy in the actual review app produces a 1920x1080 image readable by Windows Forms and a backing PNG on disk. Pasting into an actual Edge page produces a valid image/png file at the same dimensions. The browser received SHA-256 0208d0910f0780190d704ffbd39921aa38ad224365fde7670d05acbfaca9bb68. |
| Search quality | 46 owned fixtures, including full-window 11px text. Before and after both find 134 of 135 phrases. No previously found phrase is lost. An aggressive lower-resolution candidate was rejected because it lost a phrase. |
| Index throughput | A real optimized 70-image run decreases from 69,335 ms to 47,957 ms with two bounded workers, about 31% faster on this machine. This is a measured fixture result, not a guarantee for arbitrary collections or hardware. |
| Library cache | Tests verify one shared Home/Library request, immediate session snapshot reuse, retention after a failed refresh and successful retry. The live Library lists all 70 owned entries. |
| Interface | Dark Home shows ten cards; maximized light Home uses five columns and two rows, with Resume directly below. Dark keycaps and light Capture scrolling/material were visually observed. OCR controls are present under Capture and absent under Auto-save. |
| Icon | All six frames of the generated Windows icon are present in the packaged executable. The generated platform icons and README artwork use the supplied image. |
| Packages | NSIS and MSI build. The verifier passes 21 checks over versions, production identity, package contents and checksums. Installers contain Glint and the two recording sidecars, with no OCR or caption engine. |
| Dependencies | npm audit reports zero vulnerabilities. Builds complete with non-gating compiler warnings. |

Artifact sizes and SHA-256 values are recorded in `validation/release-0.2.1.json` and SHA256SUMS.txt. All five assets were downloaded through public URLs and matched local sizes and SHA-256 checksums. GitHub latest resolves to v0.2.1, with the expected updater setup URL. See `validation/release-0.2.1-public.json`.

## Coverage limits

The live UI review used an isolated 0.2.1 native build and the same frontend source. It was not an installation over the running production profile. Fresh end-to-end submissions inside Codex, OpenCode and Antigravity were not completed; the shared native formats, persistent file and actual browser paste were exercised. The OCR-popup-specific desktop automation action timed out, so its thin scrollbar is implemented through shared native WebView2 styling but is not labelled as freshly visually confirmed in that popup.

The unchanged Studio/export features retain the broader 0.2.0 validation record; this patch does not claim a fresh exhaustive pass through every recorder or hardware combination. One existing half-scale OCR phrase is still missed. Windows clipboard history is limited to 4 MB per item; direct copy preserves full resolution. Installers remain unsigned, following the existing distribution setup.
