# Studio reliability review

Working branch: `fix/studio-media-and-presentation`, based on Glint 0.2.3. These changes have not been published as a release.

Pre-merge checks repeated on 2026-11-15: 302 frontend tests, 288 native tests, production frontend build, and all four explicit FFmpeg media gates passed. Review also guarded delayed presentation recovery after close/minimize and restored framing when adjusting a border-free video's look. Cross-application drop and hardware-specific presentation limits below remain unverified; they are not represented as complete coverage.

## Changes

- Carbon-style native paint gate for persistent windows: cloak before showing, prepare the backing surface, acknowledge fresh renderer frames, then reveal. Each opening has a token to reject stale acknowledgements. Home stays in place until the screenshot editor is revealed and focused. Editor prewarming follows Home's first acknowledged paint; hidden Studio prewarming cannot take focus. Battery Saver uses themed solid fallback surfaces.
- Studio opens maximized. Source cropping supports drawing from corners, moving the selection, eight resize handles, keyboard adjustment, Full frame, Apply and Cancel. Apply/Cancel use the existing button primitives.
- Custom output dimensions update during typing and preserve proportions automatically. The fields fit the inspector. The redundant fill-frame button is consolidated into the output menu's original-video option.
- Opening speaker notes no longer activates the Polish progress bar. Its native window presentation is preserved. Errors still appear and duplicate opening requests are disabled while pending.
- Playback resets pending seeks after timing changes and advances reordered clips when the source reaches its end.
- Automatic idle/typing acceleration requires quiet audio as well as matching input activity. Silence analysis checks both stereo channels and uses a conservative threshold. Removing a clip with possible speech requests confirmation.
- Eligible plain cuts use FFmpeg directly instead of passing every video frame through the CPU compositor. Effects still use the compositor. Paused previews avoid repainting the same frame continuously.
- Native drag lifetime now ends on the plugin's completion/cancellation callback. Card gestures suppress text selection; attachment snapshots remain durable. Library thumbnails load lazily and decode asynchronously. Thin WebView2 scrollbars use theme tokens.

## Evidence and limits

- Latest frontend suite: 302 tests passed; TypeScript/Vite production build passed.
- Native suite: 288 passed, 19 optional tests ignored. Four explicit FFmpeg media gates also passed, including reordered audio tones, audio cleanup, annotation export and cursor-follow zoom.
- Live acceptance covered edited MP4/GIF timing, caption pixels, animated backgrounds/titles, camera layouts, retimed click sounds, real local transcription, transcription cancellation and silence detection.
- Live controls checks covered playback after splitting, 480 × 270 export, original-size border-free export, corner crop drawing, movement, eight handles, Apply and Cancel, and maximized Studio. Custom preview updated without blur in about 37 ms in one controlled check. Linked dimension stepping was checked in both directions.
- The final speaker-notes progress and proportions-toggle removals were checked through tests/build only, following the request to avoid further app launches.
- The supplied recordings were read without changing originals. Sampled retained speech windows did not show a loss exceeding 90% of source energy. Saved cuts did remove audible material; the first supplied original was already nearly silent over its first approximately 50 seconds. This is sampled evidence, not a word-by-word audit.
- A production Library process crash has not been reproduced. Controlled navigation had no JavaScript errors. Lazy thumbnails reduce eager decoding; this does not establish that every reported crash has been eliminated. A larger temporary metadata stress run was not counted as image-rendering validation because its new thumbnail paths were outside the permitted asset scope; those rows were removed.
- Completion callbacks and durable attachment handling are covered by tests. A real cross-application drop into Codex/OpenCode/Antigravity has not been confirmed. Native GUI drag automation was interrupted by changes to the selected window; it is not reported as a successful drop.
- The user confirmed the editor paint gate removed the observed flashes. First-launch gray-surface handling received subsequent focus/prewarming safeguards; universal behavior under Battery Saver, GPU contention and every driver is not established. There is no guarantee of performance independent of system load.

## Pull request assessment

[PR #1: Improve screenshot workflows, Studio cursor playback, and capture cleanup](https://github.com/sanirudh17/Glint/pull/1) is closed and unmerged. There are no open pull requests at review time. It changes 49 files, with 2,116 added and 263 removed lines.

| Proposal | Assessment |
| --- | --- |
| Keyboard-accessible screenshot context menus and moving capture preferences into Capture | Useful. Preserve discoverable primary actions and the approved glass styling. |
| Durable capture caching, bounded temporary files and native drag-completion callbacks | Good reliability changes. The current working branch independently fixes the drag-completion lifetime. |
| Independent HUD expiry, hover/drag pauses and preventing expired cards from returning | Good behavior when expiry remains understandable. Review the proposed eight-second timeout and 700 ms exit against current preferences. |
| Monotonic cursor/input timing and backward-compatible cursor-clean metadata | Strong fixes. Validate pause/resume and old projects with baked-in cursors. |
| Cursor-free GDI capture for all new Studio recordings | Useful capability, but forcing GDI globally needs comparison with Desktop Duplication on high-resolution/multi-display systems. Prefer a tested backend choice or fallback. |
| Optional automatic permanent screenshot deletion | Keep explicit opt-in and Never as the default. Require strict file ownership checks; a recycle-bin path would be more forgiving. |
| Shared motion stylesheet and Studio tab/toolbar restructuring | Review separately. Broad presentation changes should not be bundled into the focused stability fixes. |

Recommendation: adopt the reliability fixes selectively, then evaluate capture backend, retention and UI restructuring as separate changes. The author's reported test results belong to that PR; they are not verification of this branch. No PR changes were merged as part of this review.
