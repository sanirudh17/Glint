"""Evaluate Indra 1.1 locally on Glint's unchanged, owned screenshot corpus.

Development only: indra-ocr==1.1.2, onnxruntime==1.31.0, Pillow.
Generate the fixtures with the existing OCR fixture scripts first. Recognition
is CPU-only; only public model files are downloaded, never input images.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import statistics
import time

import cv2
from huggingface_hub import HfApi, snapshot_download
import indra_ocr
import numpy as np
from PIL import Image


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        next_row = [i]
        for j, right in enumerate(b, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (left != right)))
        row = next_row
    return row[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(os.environ["LOCALAPPDATA"]) / "GlintValidation/OcrUpgrade")
    parser.add_argument("--revision", default="v1.1.0", help="Model revision expected by Indra package 1.1.2")
    parser.add_argument("--upscale", type=int, choices=[1, 2], default=1)
    parser.add_argument("--no-language-model", action="store_true", help="Diagnostic ablation; not Indra defaults")
    args = parser.parse_args()
    root = args.root
    accuracy = json.loads((root / "accuracy-fixtures.json").read_text(encoding="utf-8"))
    simple = json.loads((root / "benchmark.json").read_text(encoding="utf-8"))
    privacy = json.loads((root / "privacy-fixtures.json").read_text(encoding="utf-8"))
    simple_files = sorted({r["fixture"] for r in simple["results"]})
    cases = [dict(case, corpus="exact") for case in accuracy]
    cases += [dict(file=file, expected=simple["expected"], corpus="simple") for file in simple_files]
    cases += [dict(case, corpus="privacy") for case in privacy]
    revision = HfApi().model_info("datalab-to/indra-ocr", revision=args.revision).sha
    model_path = Path(snapshot_download(
        "datalab-to/indra-ocr", revision=revision,
        cache_dir=root / "indra-hf-cache",
        allow_patterns=["*.onnx", "meta.json", "lm*.npz", "LICENSE", "README.md", "config.json"],
        ignore_patterns=["math*.onnx", "math_meta.json"],
    ))
    model_files = {
        p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
        for p in sorted(model_path.iterdir()) if p.is_file()
    }
    start = time.perf_counter()
    engine = indra_ocr.load(path=model_path, threads=4, mode="ocr", providers=["CPUExecutionProvider"])
    if args.no_language_model:
        engine.ocr.lms.clear()
        engine.ocr.lm = None
    load_ms = (time.perf_counter() - start) * 1000
    report = {
        "engine": "indra-ocr", "package_version": importlib.metadata.version("indra-ocr"),
        "model_revision": revision, "model_tag": args.revision,
        "packages": {p: importlib.metadata.version(p) for p in ["onnxruntime", "numpy", "opencv-python-headless", "Pillow"]},
        "platform": platform.platform(), "threads": 4, "provider": "CPUExecutionProvider",
        "upscale": args.upscale, "model_load_ms": load_ms, "model_files": model_files,
        "language_model": not args.no_language_model,
        "normalization": "case-sensitive Levenshtein CER after whitespace normalization; no identifier correction",
        "privacy_limit": "Raw transcription and line boxes only; not a production Glint privacy scan",
        "results": [],
    }
    suffix = ("" if args.upscale == 1 else f"-{args.upscale}x") + ("-no-lm" if args.no_language_model else "")
    output = root / f"indra-benchmark{suffix}.json"
    values = [
        ("Email", "hello@example.com"), ("Card number", "4111 1111 1111 1111"),
        ("Phone", "+1 415 555 0199"), ("IP address", "192.168.1.100"),
        ("API key", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"),
        ("JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345"),
    ]
    # Warm the inference path; keep model load separate from repeated image timings.
    with Image.open(root / accuracy[0]["file"]) as image:
        engine.ocr(cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2GRAY))
    for case in cases:
        with Image.open(root / case["file"]) as image:
            image = image.convert("RGB")
            if args.upscale != 1:
                image = image.resize((image.width * args.upscale, image.height * args.upscale), Image.Resampling.BICUBIC)
            gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
        start = time.perf_counter()
        page = engine.ocr(gray)
        elapsed = (time.perf_counter() - start) * 1000
        text = normalize(page.text)
        result = {
            "corpus": case["corpus"], "file": case["file"], "ms": elapsed, "text": text,
            "rotation": page.rotation, "skew": page.skew,
            "lines": [{"text": line.text, "box": [v / args.upscale for v in line.box], "confidence": line.conf} for line in page.lines],
        }
        if "expected" in case:
            expected = normalize(case["expected"])
            result["cer"] = distance(expected, text) / len(expected)
        if case["corpus"] == "exact":
            result.update(key_exact=case["key"] in text, token_exact=case["token"] in text)
        if case["corpus"] == "privacy":
            # These measure literal transcription, not regex detection or mask coverage.
            result["sensitive_exact"] = {kind: value in text for kind, value in values}
            result["reference_bounds"] = case["bounds"]
        report["results"].append(result)
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(json.dumps({k: v for k, v in result.items() if k not in ["text", "lines", "reference_bounds"]}), flush=True)
    report["summary"] = {}
    for corpus in ["exact", "simple", "privacy"]:
        rows = [r for r in report["results"] if r["corpus"] == corpus]
        stats = {"samples": len(rows), "median_ms": statistics.median(r["ms"] for r in rows)}
        if corpus != "privacy":
            stats["mean_cer"] = statistics.mean(r["cer"] for r in rows)
        if corpus == "exact":
            stats.update(key_exact=sum(r["key_exact"] for r in rows), token_exact=sum(r["token_exact"] for r in rows))
        if corpus == "privacy":
            stats["exact_values"] = sum(sum(r["sensitive_exact"].values()) for r in rows)
            stats["reference_values"] = len(rows) * len(values)
        report["summary"][corpus] = stats
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2), flush=True)


if __name__ == "__main__":
    main()
