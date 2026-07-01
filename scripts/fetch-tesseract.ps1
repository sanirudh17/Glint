# fetch-tesseract.ps1 — populate glint/src-tauri/binaries/tesseract with a
# self-contained Tesseract OCR runtime (exe + DLLs + English data) so Glint's
# Capture Text works out of the box and `tauri build` can bundle it. The folder is
# git-ignored (~160MB), so each machine runs this once after cloning.
#
# Usage (from the repo root):  powershell -File scripts/fetch-tesseract.ps1
#
# It installs Tesseract via winget if it isn't already installed, then copies the
# runtime files into the bundle folder. Everything stays local — no cloud.
$ErrorActionPreference = 'Stop'

$dst = Join-Path $PSScriptRoot '..\glint\src-tauri\binaries\tesseract'
if (Test-Path (Join-Path $dst 'tesseract.exe')) {
    Write-Host "Tesseract bundle already present at $dst — nothing to do."
    exit 0
}

# Locate an installed Tesseract; install via winget if absent.
$installed = @(
    'C:\Program Files\Tesseract-OCR',
    'C:\Program Files (x86)\Tesseract-OCR'
) | Where-Object { Test-Path (Join-Path $_ 'tesseract.exe') } | Select-Object -First 1

if (-not $installed) {
    Write-Host "Tesseract not found — installing via winget (UB-Mannheim.TesseractOCR)..."
    winget install -e --id UB-Mannheim.TesseractOCR --silent --accept-package-agreements --accept-source-agreements
    $installed = @(
        'C:\Program Files\Tesseract-OCR',
        'C:\Program Files (x86)\Tesseract-OCR'
    ) | Where-Object { Test-Path (Join-Path $_ 'tesseract.exe') } | Select-Object -First 1
}
if (-not $installed) {
    throw "Tesseract still not found after install. Install it manually, then re-run."
}

Write-Host "Copying runtime from $installed -> $dst ..."
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'tessdata') | Out-Null
Copy-Item (Join-Path $installed 'tesseract.exe') $dst -Force
Copy-Item (Join-Path $installed '*.dll') $dst -Force
Copy-Item (Join-Path $installed 'tessdata\eng.traineddata') (Join-Path $dst 'tessdata') -Force

$size = '{0:N0} MB' -f ((Get-ChildItem $dst -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "Done. Bundled Tesseract is ready ($size)."
