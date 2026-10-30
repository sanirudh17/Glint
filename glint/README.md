# Glint development

Glint is a local-first Windows screenshot and Studio recording editor built with Tauri, Rust, React, TypeScript and SQLite. See the repository README for features and installation.

## Run

Use Node.js 24 LTS. From this directory:

```powershell
npm install
npm run tauri dev
```

Fetch FFmpeg/FFprobe once with `../scripts/fetch-ffmpeg.ps1`. OCR and caption engines are optional downloads from Settings and Studio; none belongs in installer resources.

## Validate

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

Ignored integration tests require the owned fixtures and runtimes described in the release validation report. They must be run explicitly.

## Package

```powershell
npm run tauri build
```

The NSIS setup and MSI are written under `src-tauri/target/release/bundle` (or the configured Cargo target directory). Do not include OCR model directories or Tesseract in the installers. The separately downloadable Tesseract asset is created by `../scripts/package-ocr-tesseract.py` and pinned by hash in `src-tauri/src/ocr/managed.rs`.

Production data uses `%APPDATA%/com.glint.app` and `%LOCALAPPDATA%/com.glint.app`. Use a separate application identifier and profile for development and live acceptance checks.
