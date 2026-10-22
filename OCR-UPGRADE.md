# OCR upgrade

Work is isolated on `ocr-upgrade`. No UI-polish styles or window changes are included.

## Choice

Use PP-OCRv6 Small as an optional local accuracy engine, with bundled Tesseract retained as the fast, offline default. The implementation runs directly in Rust with OAR-OCR and ONNX Runtime CPU; the app needs neither Python nor a GPU. One explicit 108.7 MiB download installs the pinned models and runtime. Recognition makes no network calls.

This is a recommendation for Glint screenshots, not a claim that one model is best at every OCR task.

| Candidate | Fit for Glint | Evidence |
| --- | --- | --- |
| PP-OCRv6 Small | Chosen accuracy option; compact CPU models and source geometry | Tested locally through RapidOCR and the native Rust pipeline |
| PP-OCRv6 Tiny | Faster option with more errors on the same fixtures | Tested locally through RapidOCR |
| PP-OCRv5 Mobile | Older baseline with more errors | Tested locally through RapidOCR |
| Tesseract | Retained fast default; no optional download | Tested through Glint's bundled executable and preprocessing |
| Chandra 2 | Strong document/layout candidate, but its document-generation pipeline and model licensing are a less direct fit for a small CPU screenshot utility | Reviewed primary documentation; not benchmarked locally |

The six controlled English screenshot fixtures use light/dark themes and 11/14/18px monospace text. They include code, punctuation, email, IP address and fake credentials. RapidOCR comparison mean character error rates: Small 0.56%, Tiny 3.33%, v5 Mobile 3.52%, bundled Tesseract 4.98%. Those Python comparison results are not the shipped Rust implementation's measured result. Cold comparison runs include initial downloads and are excluded from warm timing comparisons.

Native results are checked separately, including the full-window and tall-image path. The native detector does not shrink a tall screenshot into one small image: it processes overlapping strips and maps coordinates back into the original image. Tests cover complete sensitive-value bounds and opaque redaction pixels, not just whether a category was detected.

Limitations: this fixture set does not establish handwriting, every language, arbitrary layouts or real-world secret-detection recall. OCR/redaction suggestions still require review. Tesseract remains faster; large full-window inputs cost more CPU than small regions. Cancellation is checked between native inference strips and while waiting for the shared engine; an inference already in progress finishes its current strip before returning cancellation.

## Implementation

- One engine selection is shared by Capture Text, Library indexing and privacy word geometry.
- Existing settings migrate to Tesseract. Download/engine switching is explicit.
- Downloads have exact size and SHA-256 checks. Staging is separate from the active engine, cancellable, and cleaned after failure. Runtime/model license notices are retained.
- Switching engines changes the Library text-index fingerprint, so an earlier engine's cached result does not conceal the new engine's output.
- The inconsistent automatic OCR naming feature is removed; existing capture names remain unchanged.
- Recognition is serialized through a cached native engine to bound CPU/memory pressure.

## Reproduce

Validation tools are optional development dependencies, not app dependencies.

1. Run `scripts/ocr-engine-benchmark.py` in a Python environment with RapidOCR 3.10.0, ONNX Runtime 1.31.0 and Pillow. It produces owned screenshot fixtures and `benchmark.json` beneath `%LOCALAPPDATA%/GlintValidation/OcrUpgrade`.
2. Run `python scripts/ocr-privacy-fixtures.py` to generate the ten privacy fixtures.
3. Set `GLINT_OCR_FIXTURES` to that fixture directory and `GLINT_OCR_MODELS` to the directory containing the pinned model/runtime files and installation marker.
4. Run `cargo test --manifest-path glint/src-tauri/Cargo.toml --lib native_screenshot_fixtures -- --ignored --nocapture`. Normal unit tests never download models. The explicit integration test writes `native-result.json` and redacted fixture PNGs.
5. Run the normal Rust/TypeScript test suites and frontend build.

## Primary sources

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) and [PP-OCRv6 model documentation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv6/PP-OCRv6.md)
- [OAR-OCR native Rust implementation](https://github.com/GreatV/oar-ocr) and [model registry](https://github.com/GreatV/oar-ocr/blob/main/docs/models.md)
- [RapidOCR](https://github.com/RapidAI/RapidOCR)
- [ONNX Runtime 1.31.0](https://github.com/microsoft/onnxruntime/releases/tag/v1.31.0)
- [Chandra 2 documentation](https://github.com/datalab-to/chandra/blob/master/README.md) and [model license](https://github.com/datalab-to/chandra/blob/master/MODEL_LICENSE). Apache licensing of source code does not imply the model weights carry the same terms.
