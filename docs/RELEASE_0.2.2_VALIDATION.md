# Glint 0.2.2 validation

Windows x64, 2 November 2026. Live review used generated captures, an owned project and an isolated development profile. The existing production installation and capture database were not replaced.

| Check | Result |
| --- | --- |
| Frontend | 289 tests across 50 files pass. TypeScript and the production frontend build pass. |
| Native | 286 tests pass; 18 explicit integration/display gates remain ignored. |
| Editor presentation | Regression tests reject stale presentation identifiers, duplicate claims, cancelled requests and unrequested frames. |
| Acrylic | A live maximized native window retained a visibly reflected backdrop after settling. Runtime inspection retained glass mode and transparent document surfaces across maximize/restore. The user accepted the final development preview. |
| Window size | Runtime inspection confirms 1100 by 720 logical pixels when restored and the display work area when maximized. |
| Appearance preservation | The established dark/light material palette, dropdown styling, control tokens and icon assets are unchanged. |
| Production build | Optimized x64 executable, NSIS setup and MSI build successfully. Executable product/file versions are 0.2.2. |
| Packaging | All 21 verifier checks pass: matching versions and locks, production identity, setup/MSI/ZIP contents, checksums and the pinned optional Tesseract asset. No OCR or caption runtime/weights are included in the installers or application ZIP. |

Local artifact sizes and SHA-256 values are recorded in `validation/release-0.2.2.json` and the distributed `SHA256SUMS.txt`.

## Coverage limits

The final preview was reviewed in the running development app using the same source as this patch. This was not an installation over the active production profile. There was no new frame-by-frame capture benchmark or exhaustive pass through every recorder, hardware, clipboard consumer or Windows configuration. The automated project-resume visual check was interrupted when the target window became unavailable; presentation regression tests pass, and this report does not claim a completed fresh visual resume test.

Windows acrylic can resample and shift its blurred backdrop when window bounds change. This compositor behavior was accepted during review. The release retains the existing unsigned Windows distribution setup and optional, separately downloaded OCR engines.
