# Phase 4 — Privacy and findability

Status: complete. Acceptance checks and the production build passed, including the follow-up token regression. Phase 3 was accepted by the user after testing; its checkpoint
is `1ab7b63`. Branch: `phase-4-privacy-findability`. Background removal remains
deferred; no model or inference dependency is part of this phase.

## Verified starting points and implementation plan

- `glint/src-tauri/src/ocr/mod.rs` resolves the existing bundled Tesseract engine,
  preprocesses screenshots and currently returns plain text. Add cancellable,
  bounded TSV recognition for word boxes without changing the text panel's output.
- Add pure native sensitive-text detection beside OCR: email, phone, Luhn-validated
  card numbers, IP addresses, JWT-like tokens and common key patterns. Return kinds
  and padded source rectangles to the UI, without persisting detected secrets.
- Screenshot editing is in `glint/src/views/EditorView.tsx` and
  `glint/src/views/editor/EditorStage.tsx`. Put review controls in the existing
  Redact tool's inspector. Scan visible composed content, including image layers;
  suggestions stay transient until explicitly accepted. Acceptance uses opaque
  solid redactions, with accept-one/all and undo.
- `AnnotationNode.tsx` currently uses a fixed 14 px blur/pixelate filter.
  Strengthen detail reduction, prevent overlapping filters from resampling pixels
  underneath solid redactions, and verify flattened PNG/crop behavior. Editable
  `.glint` files retain source pixels and must be identified as editable originals.
- `glint/src-tauri/src/db/mod.rs` owns idempotent capture schema changes. Add the
  OCR/FTS5 schema there without editing the existing SQL-plugin migration text.
  Exclude deleted captures and protect manually assigned names.
- `glint/src/views/LibraryView.tsx` currently filters name/kind/date in memory.
  Extend it with local indexed-text matches, background indexing progress/cancel,
  and existing settings patterns for automatic naming. Retain existing matching.

Task commits: OCR/detectors; screenshot privacy controls and export verification;
library indexing/search/naming; final acceptance evidence. Reuse the established
Taste-based UI and Impeccable usability checks; avoid a redesign.

## Acceptance

- [x] A generated screenshot with an email and valid test card produces both suggestions.
- [x] Nothing is redacted until accepted; accept-one/all and undo work.
- [x] Accepted solid redactions rewrite exported pixels, including later crops.
- [x] Blur and coarse pixelation pass OCR checks on the regression fixture.
- [x] A word present only in screenshot pixels finds the capture in Library.
- [x] Manual names, old documents/settings, cancellation and local-only behavior survive.
- [x] Frontend/native tests, desktop checks and the production build pass.

Solid redaction is the sharing choice for secrets. Blur/pixelation reduce visual
detail and must not be described as providing the same guarantee as an opaque fill.

## Implemented behavior

| Task | Result | Commit |
| --- | --- | --- |
| Local OCR and detection | Existing bundled Tesseract, word geometry, bounded/cancellable scans, six kinds of sensitive-text suggestions, FTS5 schema | `35674fc` |
| Screenshot privacy | Redact inspector, explicit accept-one/all, transient outlines, undo, stronger blur/pixelation, opaque export and protected overlapping filters | `f8aee9f` |
| Library findability | Background indexing, pixel-text search, progress/cancel/retry, optional OCR titles and manual-name preservation | `88e2c98` |
| Runtime hardening | Explicit TSV output for the lean Tesseract bundle, cancellation races, international formats and failed-image retry | `bd407c9` |
| Review usability | Sized, scrollable privacy controls, themed outlines, settings labels and clearer naming scope | `beaf1e2` |
| Desktop regression evidence | Generated fixtures, actual OCR/PNG/crop/Library checks and settings/cancellation checks | `183a6db` |
| Small token recognition | Normalize OCR word splits within JWT segments, preserve complete source boxes, and check six size/theme samples | `e104f15` |

The privacy scan reads visible composed content, including image layers and the
current crop. It returns types and padded rectangles, never the detected secrets.
Suggestions are temporary and excluded from scans and exports. Accepting a
suggestion creates an ordinary editable opaque solid redaction. No source file
is rewritten by scanning or accepting a suggestion.

Only flattened exported images remove the covered source pixels. Editable
`.glint` documents retain originals and marks; the inspector states this before
scanning. Blur/pixelation discard coarse detail before rendering, but can retain
visual clues. OCR and pattern detection can miss text or suggest ordinary values;
review the whole image before sharing.

Library reads screenshot files locally when it opens, using one background OCR
worker and cached file fingerprints. Recordings are excluded. Search retains the
existing name/date/type behavior and adds prefix matches against local FTS5 text.
Deleted captures lose their text rows. A failed image is retried on a later scan.
The worker checks cancellation before saving results so clearing the index cannot
be undone by a late OCR response.

Settings → Auto-save has **Search screenshot text** and **Name captures from text**.
Turning search off cancels indexing and clears stored search text. Automatic names
apply to newly indexed captures, use a meaningful line without detected sensitive
data, and leave manual names intact. Enabling naming does not rename already
cached captures or change filenames.

## Verification

- Frontend: 250 tests passed across 39 files.
- Native: 238 tests passed; two existing display-dependent tests stayed ignored.
  Focused FTS tests also verify actual derived-row removal after deletion.
- Real WebView2 desktop acceptance: all six sensitive-text types detected on the
  fake-data fixture; email and card required. Scanning adds no annotations, and
  an export with unaccepted suggestions is pixel-identical to the baseline.
- Accept-one/all, undo and editable reopen passed. OCR cannot read the fixture's
  accepted email/card in the flattened PNG. A later crop of that PNG contains
  only RGBA `(17,17,17,255)` throughout the tested interior.
- Strengthened blur/pixelation pass the fixture OCR checks. A blur above a solid
  mask cannot resample the original secret underneath it.
- Actual Library search finds `otterfjordmineral`, which exists only in pixels,
  not the title or filename. Generated naming, manual-name preservation, naming
  off, search off/clear, cancellation and corrupt-file retry passed.
- Existing Phase 3 source-layer drop, drag, resize, redaction, save/reopen and
  large mesh responsiveness passed; maximum measured main-thread delay was
  92 ms in this run (hardware/load dependent).
- Dark wide and 760×720 light privacy controls, Library and settings were
  inspected. Privacy action buttons keep their 34 px height while scrolling.
  The UI detector reported no findings.
- Production startup, image-layer-only sensitive text, crop/frame coordinate
  mapping, acceptance and flattened export passed in the installed release.
  Migration preserved all 326 existing capture rows. The original September PNG
  retained its SHA-256; Explorer's command still targets the installed executable.

The user caught a JWT missed in the half-size image-layer example. OCR split the
header and signature into separate words; matching now normalizes those spaces
while mapping back to the complete original word boxes. New tests cover the exact
OCR error, Unicode offsets, structure/boundaries and full/75%/50% samples in both
light and dark. All six types are found in all six samples. The actual inspector
found the remaining JWT in 474 ms; accepting it covered the full token with opaque
replacement pixels, verified in the exported PNG as well as by OCR. Native scan
measurements ranged from 498–1,130 ms in that run, depending on image size and load.
No additional OCR pass or model is used for the correction.

Desktop evidence is in the OS temp directory `glint-phase4-8hhz3ihw`: `result.json`,
`edge-result.json`, `token-result.json`, `token-ui-result.json`,
`standalone-result.json`, `migration-result.json`, exported PNGs, the cropped
flattened PNG and UI captures.
The Phase 3 interaction result remains in `glint-phase3-RUPANp`.
The full acceptance checks used a separate app identifier/database. Production
smoke checks used only owned synthetic documents/captures; their Library exports
were removed. User screenshots were not edited.

The local installed executable was updated with hash verification. Rollback copies
of the prior executable and database are in
`%LOCALAPPDATA%\GlintBuildBackups\20261015-131035-before-phase4`.
The installed/release SHA-256 after the token fix is
`74A1BBE332590DE282B1E31BCAE4604D78A5CA9BB880A6DBF9622B4A4D0967CB`.
The example remains open with all six values redacted for inspection.

Repeat the automated desktop checks only against an isolated validation instance:

```powershell
python scripts/screenshot-phase4-fixture.py
# Start a test instance using the generated validation.conf.json and source.png.
$env:GLINT_CDP_PORT = '9230'
node scripts/screenshot-phase4-check.mjs '<generated temporary directory>'
node scripts/screenshot-phase4-settings.mjs '<generated temporary directory>'
node scripts/screenshot-phase4-token-check.mjs '<generated temporary directory>'
```

## Start and try the build

Quit any older Glint tray instance first: Glint forwards launches to the running
instance, regardless of which branch or executable you launch.

```powershell
cd 'C:\Users\sanir\Claude Code'
git switch phase-4-privacy-findability
cd glint
npm run tauri -- dev
```

Keep the terminal running for development. For a standalone executable, use
`npm run tauri -- build --no-bundle`; the result is
`glint/src-tauri/target/release/glint.exe` relative to the repository root.

Quick manual check:

1. Open a screenshot with a test email/card. Choose **Redact → Scan sensitive text**.
   Review outlines, accept one or all, and try Undo. Nothing should be hidden
   until accepted.
2. Export a PNG, reopen that PNG and crop a redacted area. It should remain a
   solid fill. Share the PNG; keep the editable `.glint` original private.
3. Open Library, wait for text reading, then search for a word visible only inside
   a screenshot. Try the two switches under Settings → Auto-save.

Phase 5 is not started. Background removal remains deferred with the model/runtime
proposal recorded in [Phase 3](STUDIO_PHASE_3.md#deferred-optional-background-removal).
