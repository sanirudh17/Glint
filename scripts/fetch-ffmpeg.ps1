# fetch-ffmpeg.ps1 — populate glint/src-tauri/binaries with the FFmpeg + FFprobe
# sidecars Glint's recorder and trim editor shell out to, named with the Tauri
# target-triple suffix so `tauri build` bundles them. The two exes are ~100MB
# each and git-ignored, so each machine runs this once after cloning.
#
# Usage (from the repo root):  powershell -File scripts/fetch-ffmpeg.ps1
#
# Downloads a static Windows build from gyan.dev (no install, no admin) and drops
# ffmpeg-x86_64-pc-windows-msvc.exe / ffprobe-x86_64-pc-windows-msvc.exe into the
# bundle folder. Everything stays local — no cloud, nothing persisted elsewhere.
$ErrorActionPreference = 'Stop'

$triple = 'x86_64-pc-windows-msvc'
$dst    = Join-Path $PSScriptRoot '..\glint\src-tauri\binaries'
$ff     = Join-Path $dst "ffmpeg-$triple.exe"
$fp     = Join-Path $dst "ffprobe-$triple.exe"

if ((Test-Path $ff) -and (Test-Path $fp)) {
    Write-Host "FFmpeg + FFprobe sidecars already present in $dst — nothing to do."
    exit 0
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null

$url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$tmp = Join-Path $env:TEMP ("glint-ffmpeg-" + [guid]::NewGuid().ToString('N'))
$zip = "$tmp.zip"

Write-Host "Downloading FFmpeg static build from $url ..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

Write-Host "Extracting ..."
Expand-Archive -Path $zip -DestinationPath $tmp -Force

$srcFf = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe'  | Select-Object -First 1
$srcFp = Get-ChildItem -Path $tmp -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
if (-not $srcFf -or -not $srcFp) { throw "ffmpeg.exe / ffprobe.exe not found in the download." }

Copy-Item $srcFf.FullName $ff -Force
Copy-Item $srcFp.FullName $fp -Force

Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

$size = '{0:N0} MB' -f (((Get-Item $ff).Length + (Get-Item $fp).Length) / 1MB)
Write-Host "Done. FFmpeg + FFprobe sidecars are ready ($size)."
