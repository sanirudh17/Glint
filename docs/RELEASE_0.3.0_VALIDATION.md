# Glint 0.3.0 release checks

Windows x64, 21 November 2026.

## Tests

- 323 native unit tests pass, including the agent-detection, activity-log, Studio project-edit and export-timing tests.
- 5 stdio end-to-end tests pass, driving `glint.exe --mcp` exactly as an agent does.
- 314 frontend tests pass, and TypeScript checks pass.

## Live checks against a release build

Run on a preview identity, separate from the installed app:

- Image rendering, the full video flow (open, silence analysis, cuts, zooms, masks, captions, export with progress, the export-clash guard, cancellation) and whole-app control (settings, hotkeys, fullscreen screenshot, recording) pass.
- Real Claude Code sessions drove Glint through `glint.exe --mcp`: trimming, rounding and theme switching. The theme repainted live in about 0.2 s.
- Each session was recorded in Settings → Agents.

## Export performance

On a Windows 11 laptop with an RTX 4050:

- NVENC is selected again; the old GPU probe used a frame below NVENC's minimum size.
- A 60 s 720p clip exports in 19 s without zoom (was 40 s) and 27 s with a zoom (was 95 s).
- A 3 min 37 s edit with 16 cuts and 13 zooms exports in 68 s on the first attempt. Before, it fell short of its frame count and retried in software.
- Renderer MP4 round-trip tests (cursor-follow zoom, reordered cuts with audio tones, annotations, audio polish, GIF palette) pass in release mode.

## Packaging

- Optimized x64 executable, setup and MSI build successfully.
- All 21 packaging checks pass: version consistency, production identity, installer, MSI and ZIP contents, the optional OCR pin and checksums.
- The separate `glint-mcp.exe` is no longer built or bundled; `glint.exe --mcp` is the MCP server.

Artifact sizes and SHA-256 values are recorded in `validation/release-0.3.0.json` and the distributed `SHA256SUMS.txt`.

## Not covered

- Setup steps for GitHub Copilot CLI, Cursor, Claude Desktop, Oh My Pi, Pi and Grok Build follow each tool's documented configuration. Those tools were not installed on the test PC.
- Installers retain the existing unsigned distribution setup.
- OCR and caption engines remain optional downloads.
