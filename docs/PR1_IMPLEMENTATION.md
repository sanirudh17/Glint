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

## Deliberately excluded

- Forced GDI recording, permanent screenshot retention, destructive timed HUD expiry and the broad shared-animation stylesheet.
- The separate Cursor tab and right-click menu were tried, then removed following feedback. The CSS-duration helper was also removed when its only new menu consumer was dropped; no unused framework is retained.
- Native glass/paint gates, editor focus handoff, crop interactions, custom sizing and export rendering were not replaced by PR code.

## Verification

- Main baseline: 302 frontend tests, 288 native tests, production frontend build and four explicit FFmpeg media gates passed before merging and pushing `68a8957`.
- Preview: 306 frontend tests; 291 native tests passed, with 19 optional tests ignored; frontend and native builds passed.
- Isolated preview checks passed for hover actions, removal of the custom context menu, settings relocation, setting persistence through the UI, manual capture, release capture using final pointer coordinates, fresh preferences in reused overlays, maximized Studio, a fixed padded header, one window-control group, and retained crop/sizing controls. No JavaScript errors were observed in these checks.
- This is targeted coverage, not a claim that every hardware-specific presentation or third-party drag destination has been verified. Baseline limitations remain in `STUDIO_RELIABILITY_REVIEW.md`.

## Try it

The running native preview is named **Glint PR1 Preview** and uses the separate `com.glint.preview.pr1` profile. It does not use the installed app's database. The preview executable is in `%LOCALAPPDATA%\GlintValidation\PR1Implementation\bin\glint-pr1-preview.exe`; its static frontend is served from this worktree on `http://127.0.0.1:5181`.

Review Capture settings, Home/Library hover actions, and Studio's wider Edit & draw inspector. Capture on mouse release remains off until explicitly enabled. The demonstration video contains synthetic cursor events for inspecting controls; it is not evidence of real recording-clock accuracy.

## Attribution

Adapted selectively from [valenxi0's PR #1](https://github.com/sanirudh17/Glint/pull/1), reviewed at `cc038a4acbf04d4afb933e263acf2ea730ee5a55`. The implementation commit includes the contributor's co-author identity from the PR commits. The recent baseline reliability fixes remain separately authored and recorded.
