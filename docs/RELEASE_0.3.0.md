# Glint 0.3.0

Coding agents can now use Glint. This release also makes video exports much faster and more reliable, and polishes the whole app.

## Glint for coding agents (MCP)

Glint now includes an MCP server, so agents such as Claude Code, Codex, OpenCode and Antigravity can work with it for you. The server is built into Glint (`glint.exe --mcp`); there is nothing extra to install.

Agents can:

- **Images:** trim to the content's edges, round corners, and annotate with every editor tool: arrows, shapes, text, steps, blur, redaction, highlights, frames and backgrounds. Results are rendered by Glint's own editor.
- **Videos:** do everything the Trim and Studio editor does: cuts, speed, reordering, zooms (including ones that follow the cursor), masks, drawn annotations, captions, Look, cursor styling, fades, webcam, audio clean-up. Exports run in the background with progress and can be cancelled. Agents can also look at frames and find silent or idle stretches to cut.
- **The app:** take screenshots and recordings, change any setting (themes update live), and rebind hotkeys.

Originals are never overwritten: every edit and export is saved as a new file.

**Settings → Agents** lists the agents installed on your PC, shows which are connected (*Active now*, *Last used…*), and keeps a plain-language log of what they did in Glint. Agents that aren't installed are under *Set up another agent*.

Setup takes one line per agent; see the [setup guide](https://github.com/sanirudh17/Glint/blob/main/docs/agents.md).

## Faster, more reliable video exports

These fixes apply to every Studio export, manual or agent:

- **NVIDIA GPUs are used again.** The GPU check tested NVENC with a frame below its minimum size, so exports always fell back to a slower encoder.
- **Frames are composed in parallel.** Decoding, composing and encoding overlap instead of taking turns on one core.
- **Exact frame timing on every cut.** Timelines with many cuts no longer come up short. Before, a short timeline made the fast export fail and silently retry in software, and the picture drifted from the audio.

On a test PC, a 60-second 720p clip with a zoom went from 95 s to 27 s. A 3½-minute edit with 16 cuts and 13 zooms, which used to fail, now exports in about 70 s.

## Polish

- A new, consistent icon set (Hugeicons) across the app.
- Refined Settings, Home, Library, recording controls, Trim/Studio, the image editor and the OCR window.
- Shutter sounds you can preview.
- Dropdown labels are now centred.
- Fixes for capture presentation, scrolling capture, the OCR window and Studio annotation editing.

## Thanks

Capture on mouse release, the editor cache and the Studio toolbar come from #1 by @valenxi0. Thank you!

## Downloads

Windows x64 setup, MSI and an application ZIP with recording sidecars are provided. OCR and caption engines remain separate optional downloads. Installers are unsigned, as before; on first run Windows SmartScreen may ask you to confirm.

See the [release checks](https://github.com/sanirudh17/Glint/blob/v0.3.0/docs/RELEASE_0.3.0_VALIDATION.md).
