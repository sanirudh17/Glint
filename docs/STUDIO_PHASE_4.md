# Phase 4 — Privacy and findability

Status: in progress. Phase 3 was accepted by the user after testing; its checkpoint
is `1ab7b63`. Branch: `phase-4-privacy-findability`. Background removal remains
deferred; no model or inference dependency is part of this phase.

## Verified paths and implementation plan

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

- [ ] A generated screenshot with an email and valid test card produces both suggestions.
- [ ] Nothing is redacted until accepted; accept-one/all and undo work.
- [ ] Accepted solid redactions rewrite exported pixels, including later crops.
- [ ] Blur and coarse pixelation pass OCR checks on the regression fixture.
- [ ] A word present only in screenshot pixels finds the capture in Library.
- [ ] Manual names, old documents/settings, cancellation and local-only behavior survive.
- [ ] Frontend/native tests, desktop checks and the production build pass.

Solid redaction is the sharing choice for secrets. Blur/pixelation reduce visual
detail and must not be described as providing the same guarantee as an opaque fill.
