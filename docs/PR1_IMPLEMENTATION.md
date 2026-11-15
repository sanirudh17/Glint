# PR1 implementation preview

Branch: `pr1-implementation`. Based on main commit `68a8957`, which contains the separately verified Studio/media/presentation fixes. This preview has not been merged into main or published as a release.

## Included

- Optional **Capture on mouse release** under Settings > Capture, off by default. Manual selection adjustment and Enter confirmation remain available when it is off. Each capture payload reads the current preference, including in reused overlay windows. Tiny, cancelled, right-button, move and resize gestures do not trigger automatic capture.
- **Open in editor after capture** moved from Auto-save to Capture without changing its persisted key.
- A wider Studio inspector on large windows, consistent side padding, a fixed heading/tab area and a scrolling control area. Narrow-window widths remain bounded.
- Three Studio tabs: Look, Edit & draw, Polish. **Cursor & effects stays in Edit & draw**, following user feedback.
- Existing Home/Library hover action menus remain. Keyboard focus also reveals their buttons. **No custom right-click menu.**
- Cursor timestamps anchor once per recording span, preventing later encoder-progress reports from rewinding or jumping the input clock. Pause/resume and invalid timestamps are covered by tests. The capture backend remains unchanged.
- Unsaved editor-only screenshots reuse a bounded latest-image cache and do not accumulate hidden HUD cards. Existing durable attachment snapshots remain unchanged.
- Capture-on-release selections use a dashed outline without resize handles. Manual confirmation mode retains its handles.
- Studio annotations can be picked and moved directly on the video. The original mark is hidden while its live draft moves; text has a corner resize grip. Drawing tools remain active until switched. Mask drawing and zoom targeting temporarily suspend annotation picking.
- Overlapping Marks have separate timeline lanes and readable labels. A populated Annotations heading uses the same emphasis as the other editing sections.
- One Lucide icon family across Home, Library, HUD, settings and both editors. Navigation and hover controls use larger glyphs; Rename, Copy file and Copy file path have distinct, consistent symbols. The Solar/Hugeicons experiment and its dependencies were removed after feedback.
- Thin native WebView2 scrollbars use matching light/dark theme colors without overriding intentional hidden scrollbars.

## Deliberately excluded

- Forced GDI recording, permanent screenshot retention, destructive timed HUD expiry and the broad shared-animation stylesheet.
- The separate Cursor tab and right-click menu were tried, then removed following feedback. The CSS-duration helper was also removed when its only new menu consumer was dropped; no unused framework is retained.
- Native glass/paint gates, editor focus handoff, crop interactions, custom sizing and export rendering were not replaced by PR code.

## Verification

- Main baseline: 302 frontend tests, 288 native tests, production frontend build and four explicit FFmpeg media gates passed before merging and pushing `68a8957`.
- Preview: 306 frontend tests; 291 native tests passed, with 19 optional tests ignored; frontend and native builds passed.
- Isolated preview checks passed for hover actions, removal of the custom context menu, settings relocation, setting persistence through the UI, manual capture, release capture using final pointer coordinates, fresh preferences in reused overlays, maximized Studio, a fixed padded header, one window-control group, and retained crop/sizing controls. No JavaScript errors were observed in these checks.
- This is targeted coverage, not a claim that every hardware-specific presentation or third-party drag destination has been verified. Baseline limitations remain in `STUDIO_RELIABILITY_REVIEW.md`.

### Latest verification after feedback

- 311 frontend tests and the production TypeScript/Vite build passed. The native suite passed 291 tests, with 19 optional tests ignored; six explicit media gates were also run successfully: reordered cut/audio preservation, audio cleanup/polish, annotation MP4, cursor-follow zoom MP4, GIF palette output, and mixed-scene crossfade/audio/video duration.
- `scripts/pr1-final-review.mjs` passed with generated media in the isolated profile: real pointer selection/movement, old-position pixel removal during dragging, persistent pen/highlight tools, text corner resizing, annotation undo/redo, repeated Play after split/undo/redo, updated-sequence playback, corner cropping and eight handles, Apply/Cancel, custom dimension stepping, zoom, masks alongside annotations, cursor switches, light/dark scrollbars, silence analysis, speaker notes without the progress slider, Save project, and MP4 export with audio.
- The resulting eight-second effects export retained audio. A decoded one-second retained window had an RMS ratio of 0.9992 relative to its source; the reordered-audio native gate separately verifies the expected tone content. This is fixture evidence, not a word-by-word audit of every user recording.
- The capture check passed for both confirmation modes, fresh settings in warmed overlays, no handles and a dashed outline in release mode. The user's original preview preference is restored afterward.
- Final screenshots checked the six separate Marks lanes and unified icons in both themes. Copy file, Copy path and Rename have different glyphs; Library/folder icons render as outlines.
- The isolated preview has no caption transcription engine installed. Current live transcription was therefore not reverified; earlier baseline evidence and caption model/render tests do not substitute for that missing live check. Battery Saver/driver-specific presentation and third-party drag destinations retain the documented limitations.

Evidence: `%LOCALAPPDATA%\GlintValidation\PR1FinalReview\results.json`, `marks-lanes-final.png`, `library-light.png`, `library-dark.png`; `%LOCALAPPDATA%\GlintValidation\PR1Implementation\checks.json`.

## Try it

The running native preview is named **Glint PR1 Preview** and uses the separate `com.glint.preview.pr1` profile. It does not use the installed app's database. The preview executable is in `%LOCALAPPDATA%\GlintValidation\PR1Implementation\bin\glint-pr1-preview.exe`; its static frontend is served from this worktree on `http://127.0.0.1:5181`.

Review Capture settings, Home/Library hover actions, and Studio's wider Edit & draw inspector. Capture on mouse release remains off until explicitly enabled. The demonstration video contains synthetic cursor events for inspecting controls; it is not evidence of real recording-clock accuracy.

## Attribution

Adapted selectively from [valenxi0's PR #1](https://github.com/sanirudh17/Glint/pull/1), reviewed at `cc038a4acbf04d4afb933e263acf2ea730ee5a55`. The implementation commit includes the contributor's co-author identity from the PR commits. The recent baseline reliability fixes remain separately authored and recorded.
