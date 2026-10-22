# OCR upgrade

Work is isolated on `ocr-upgrade`. No UI-polish styles or window changes are included.

## Choice

Recommend PP-OCRv6 Small based on the actual native screenshot results; offer Medium for comparison, and retain bundled Tesseract as the offline default before optional installation. The implementation runs directly in Rust with OAR-OCR and ONNX Runtime CPU; the app needs neither Python nor a GPU. Explicit downloads install pinned models and CPU runtime: 211.3 MiB for Medium or 108.7 MiB for Small. Recognition makes no network calls.

This is a recommendation for Glint screenshots, not a claim that one model is best at every OCR task.

| Candidate | Fit for Glint | Evidence |
| --- | --- | --- |
| PP-OCRv6 Medium | Optional comparison; stronger Python result did not transfer to the native pipeline | Tested locally through RapidOCR and the native Rust pipeline |
| PP-OCRv6 Small | Recommended: lowest native CER on the tested screenshot corpora | Tested locally through RapidOCR and the native Rust pipeline |
| PP-OCRv6 Tiny | Faster option with more errors on the same fixtures | Tested locally through RapidOCR |
| PP-OCRv5 Mobile | Older baseline with more errors | Tested locally through RapidOCR |
| Tesseract | Retained fast default; no optional download | Tested through Glint's bundled executable and preprocessing |
| OvisOCR3 | Strong general/document OCR candidate; more literal-token errors on the six local screenshots | Actually run locally on the RTX 4050, including an upscaled-input check |
| Indra OCR 1.1 | Promising CPU candidate, but more screenshot transcription errors than native Small; not integrated | Tested locally on 24 unchanged images, plus 2x and no-language-model diagnostic runs |
| TeleOCR | Leading entry in the consulted OmniDocBench v1.6_full document-parsing table | Reviewed benchmark and official model card; not benchmarked locally |
| Chandra 2 | Strong document/layout candidate with model licensing distinct from its source license | Reviewed primary documentation; not benchmarked locally |

The six controlled English screenshot fixtures use light/dark themes and 11/14/18px monospace text. They include code, punctuation, email, IP address and fake credentials. RapidOCR comparison mean character error rates: Small 0.56%, Tiny 3.33%, v5 Mobile 3.52%, bundled Tesseract 4.98%. Those Python comparison results are not the shipped Rust implementation's measured result. Cold comparison runs include initial downloads and are excluded from warm timing comparisons.

Native results are checked separately, including the full-window and tall-image path. The native Medium privacy run passed all ten privacy fixtures (six size/theme variants, two full-window and two tall), checking six types, complete bounds and opaque pixels. Together with six transcription fixtures, this is a 16-image native integration run. The native detector does not shrink a tall screenshot into one small image: it processes overlapping strips and maps coordinates back into the original image. Tests cover complete sensitive-value bounds and opaque redaction pixels, not just whether a category was detected.

Limitations: this fixture set does not establish handwriting, every language, arbitrary layouts or real-world secret-detection recall. OCR/redaction suggestions still require review. Tesseract remains faster; large full-window inputs cost more CPU than small regions. Cancellation is checked between native inference strips and while waiting for the shared engine; an inference already in progress finishes its current strip before returning cancellation.

## Implementation

- One engine selection is shared by Capture Text, Library indexing and primary privacy word geometry. Neural privacy scans also use an independent Tesseract reading and union overlapping suggestions. Medium missed a tall-image IP in an actual regression check; the second reader recovered it. Text extraction itself uses the selected engine, without rewriting its identifiers based on another model.
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

## Accuracy-first reassessment (22 October 2026)

The first six simple fixtures were insufficient to call Small the best. Medium averaged 0.61% CER there, slightly worse than Small's 0.56%, so bigger did not automatically mean better. The harder eight-image corpus uses Consolas/Segoe UI, 11/15px, light/dark, code punctuation, and seeded randomized fake identifiers. The controlled RapidOCR comparisons on that corpus were:

| Engine | Mean character error rate (lower is better) |
| --- | --- |
| PP-OCRv6 Medium | 1.45% |
| PP-OCRv6 Small | 1.67% |
| Bundled Tesseract | 7.15% |

All three still misread at least one character in the long randomized token in every variant. These are exact, case-sensitive strings, so good average CER is not a guarantee that a copied credential is correct. Results deliberately report both CER and exact identifier matches. Upscaling was also tested; it did not consistently improve the Paddle models, so it was not adopted without evidence.

OvisOCR3 was run locally with its official plain-OCR prompt, pinned revision `5f6ce6932efee9ec10c30746db55bd780214b7fd`, BF16 on the RTX 4050. Mean CER on the six original screenshots was 3.99%. A 2x-input check improved the 11px dark example from 7.04% to 1.41%, but that single case is not an aggregate result. This establishes a task-specific weakness on our literal tokens, not a general ranking against OvisOCR3 on documents or handwriting. No screenshots were sent to a remote inference service.

The consulted OmniDocBench **v1.6_full** table lists TeleOCR 96.91, OvisOCR2 96.47 and PaddleOCR-VL-1.6 96.34 overall. This is a combined document score (text, tables and formulas), not a screenshot-token exactness rate. Chandra 2 reports 85.8 on its olmOCR-Bench evaluation, a different benchmark that cannot be numerically compared with those scores. OvisOCR3's newer general-OCR and word-spotting capabilities make it worth testing, but its vendor-reported scores do not replace local evidence.

Additional primary references: [OmniDocBench leaderboard](https://github.com/opendatalab/OmniDocBench), [TeleOCR model](https://huggingface.co/XingChen-AGI/TeleOCR), [OvisOCR3 model and prompts](https://huggingface.co/ATH-MaaS/OvisOCR3), [PaddleOCR-VL-1.6](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6), [olmOCR](https://github.com/allenai/olmocr).

Reproduction additions: `ocr-accuracy-fixtures.py` generates the eight exact-text fixtures; `ocr-accuracy-compare.py` compares the two Paddle tiers and Tesseract; `ocr-vlm-benchmark.py` runs OvisOCR3 locally. These scripts are development tools, not app runtime dependencies. Run the ignored Rust `native_exact_text_corpus` test for the actual native transcription path. Set `GLINT_OCR_TIER=medium` and point `GLINT_OCR_MODELS` at the matching pinned Medium files to test that tier; omit it for Small.

### Final native decision

The actual Rust pipeline changes the recommendation from the Python comparison. On the same eight harder screenshots, the native implementation measured **1.67% mean CER for Small** and **1.89% for Medium**. Medium reproduced the fake API key exactly in one variant, Small in none; neither reproduced the full randomized token exactly. There is no basis for claiming universal or perfect accuracy. Small is the recommended Glint engine because its native aggregate was better, while Medium remains available for other material. This recommendation prioritizes measured native accuracy rather than model size or speed. Both use the independent reader for privacy suggestions.

Verification: 261 frontend tests, 266 standard native tests, explicit native exact-text tests for both tiers, a 16-image native Medium/privacy integration run, real-app switching between both models and Tesseract, saved engine selection, both model download cancellation/retry paths, exact hashes and retained license notices. The six privacy categories were also checked through the actual app command after model switching. The UI-polish worktree was removed; the OCR branch remains unmerged.

## Indra OCR 1.1 evaluation (22 October 2026)

Tested locally on Windows CPU with `indra-ocr==1.1.2`, ONNX Runtime 1.31.0, four intra-op threads and CPUExecutionProvider. Package 1.1.2 expects model tag `v1.1.0`; this resolved to pinned model revision `bd02167fdf2005a19962cc15188f8496a2c87d3b`. All model file hashes, dependency versions, input PNG hashes, recognized strings and per-image measurements are retained in [the evaluation report](validation/indra-1.1-2026-10-22.json). Only public models were downloaded; inference stayed local in a separate development venv. No app dependencies or production engine selection changed.

The inputs are the **same eight exact-text screenshots**, six simpler screenshots and ten privacy fixtures used above. CER is case-sensitive Levenshtein distance after whitespace normalization, without correcting recognized identifiers. The harder corpus results are:

| Pipeline | Mean CER | Exact fake key | Exact long token |
| --- | --- | --- | --- |
| Existing native PP-OCRv6 Small | 1.67% | 0/8 | 0/8 |
| Existing native PP-OCRv6 Medium | 1.89% | 1/8 | 0/8 |
| Indra 1.1, default | 5.29% | 0/8 | 0/8 |
| Indra 1.1, 2x bicubic input | 5.29% | 0/8 | 0/8 |
| Indra 1.1, language-model correction disabled | 4.12% | 0/8 | 0/8 |

The alternative Indra settings are diagnostic ablations, not its advertised default. On the six simpler screenshots, default Indra averaged 3.05% CER; 2x input and disabling the language model each averaged 2.39%. Default Indra's warmed single-observation median on the eight harder images was about 99 ms, excluding model loading (~996 ms) and downloads. This is encouraging for responsiveness, but is not a controlled release-build speed comparison with Glint's native implementation.

Privacy was checked separately from literal string copying. The existing Rust `privacy::detect` consumed Indra's public line text and boxes, without Tesseract fallback or fabricated character coordinates. A matched value therefore receives a conservative whole-line mask. Across ten fixtures (60 reference values), full category-matched box coverage **and opaque mask pixels** succeeded for 52/60 values by default, 55/60 with 2x input, and 54/60 with the language model disabled. All default misses were JWTs. This is a candidate probe, not an integrated app export or production recall guarantee. The ignored test records misses intentionally; its passing status only confirms the evaluation completed. These results do not replace the earlier native Paddle plus independent-reader export checks.

**Decision: keep PP-OCRv6 Small recommended.** Indra is quick and compact, but did not improve screenshot accuracy or exact identifier recognition on this corpus. It remains a research candidate rather than an added engine. These synthetic English results do not establish its ranking on handwriting, scans, other scripts or arbitrary user images. The remaining exact-token errors in Paddle are also unresolved.

Reproduce in a separate Python environment after generating the existing fixtures:

```powershell
python -m pip install indra-ocr==1.1.2 onnxruntime==1.31.0 Pillow==13.0.0
python scripts/ocr-indra-benchmark.py
python scripts/ocr-indra-benchmark.py --upscale 2
python scripts/ocr-indra-benchmark.py --no-language-model
$env:GLINT_OCR_FIXTURES = "$env:LOCALAPPDATA/GlintValidation/OcrUpgrade"
cargo test --manifest-path glint/src-tauri/Cargo.toml --lib evaluate_indra_privacy_geometry -- --ignored
# Repeat the probe with GLINT_INDRA_REPORT set to indra-benchmark-2x.json
# and indra-benchmark-no-lm.json for those diagnostic runs.
```

All three native privacy probes completed, and the eight existing privacy unit tests passed. The benchmark uses PNGs in OCR mode, so digital PDF text-layer extraction cannot inflate the results. Model assets total about 76.1 MB including metadata/license; the model weights use modified OpenRAIL-M terms, distinct from the Apache-2.0 source license. Consult the upstream terms before any distribution decision.

Primary references: [Indra 1.1 release](https://www.datalab.to/blog/indra-ocr-1-1), [package 1.1.2 model loader and expected tag](https://github.com/datalab-to/indra/blob/v1.1.2/indra_ocr/models.py), [pinned model card](https://huggingface.co/datalab-to/indra-ocr/blob/bd02167fdf2005a19962cc15188f8496a2c87d3b/README.md), [pinned model license](https://huggingface.co/datalab-to/indra-ocr/blob/bd02167fdf2005a19962cc15188f8496a2c87d3b/LICENSE).
