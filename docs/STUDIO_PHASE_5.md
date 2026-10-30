# Phase 5 — GIF export, scrolling capture and clean capture

Status: functional checkpoint ready; optimized-build performance gate remains open.
Authorized by the user on October 20, 2026 after Phase 4.
Branch: `phase-5-capture-export`, based on `e3782ca`. Main remains unchanged.
Background removal remains deferred. Phase 5 is complete; Phase 6 is authorized
after the optimized performance verification recorded at the end of this file.

## Verified paths and plan

1. Repair the Phase 4 naming regression. `db/text_index.rs` previously named every
   indexed screenshot from the first OCR line and `settings/mod.rs` enabled this by
   default. Make naming opt-in and run a one-time repair limited to
   `title_origin='ocr'`, preserving manual names and the search index.
2. Fix dangling shared image paths. `capture/commands.rs` deletes temporary tray
   files on dismissal and eviction, while `lib/hudIpc.ts` hands those paths directly
   to the drag plugin. Preserve an image snapshot in a separate attachments folder
   before handing it to another app. Editor drag exports and tray Copy path must
   use the same durable storage. No agent-specific integration is needed.
3. Add GIF export to `recorder/TrimView.tsx`. Reuse
   `recorder/studio_export.rs` and `studio_render.rs` for Studio look, zoom and
   privacy, and the existing Quick trim graph for Quick edits. Use bundled FFmpeg
   palette generation/use; offer FPS, width and loop controls, progress and cancel.
   Publish only finished GIFs under a stated size cap; preserve all originals.
4. Add manual scrolling capture using `capture/frozen.rs`'s existing xcap backend
   and the existing region-selection overlay. A background worker collects settled
   frames; pure overlap logic detects displacement and repeated sticky bands,
   rejects ambiguous seams, and caps height/pixel allocation. Finish opens the
   stitched PNG in the existing editable screenshot editor. Manual mode landed first;
   the user subsequently authorized optional auto-scroll to clarify the workflow.
5. Audit clean-capture controls and reuse what exists. Capture settings already
   have 3/5/10 second delays; window capture, path copying, file drag, and the
   latest-capture editor command already exist. Add only missing monitor choice,
   desktop-icon handling, Quick Access auto-close, media-file clipboard support,
   and a configurable latest-capture shortcut. Verify safe notification handling
   before offering an automatic system-setting change.

The UI keeps the established Taste-based app design. Use Impeccable for new
controls within existing panels, progress/error states and keyboard behavior.
No website redesign, model download or cloud dependency is part of this phase.

## Preliminary fixes

- `f429d4a`: OCR naming off by default; one-time title repair and preservation tests.
- `5edc929`: durable attachment paths; image snapshots survive source deletion.
- Native regression run: 240 passed, two pre-existing display tests ignored.
- Installed title repair: 65 generated names removed; all 335 capture records,
  original paths, manual names and OCR search content preserved.
- Real tray dismissal deletes its temporary source while the shared attachment
  remains readable. Durable attachments use app-local storage outside Temp.

## GIF and reveal checkpoint (October 20)

- GIF uses the same Studio look, crop, aspect, zoom and privacy rendering as MP4.
  Solid, gradient and image backgrounds stay opaque. Selecting Transparent in
  Studio gives transparent GIF surroundings; black recording pixels and privacy
  masks stay opaque. There is no separate GIF background toggle.
- Transparency is binary, so GIF edges are crisp and soft shadows are omitted.
  Coverage uses the actual rounded frame geometry, chrome, border and watermark
  pixels, never color-key removal from the recorded screen.
- Render only the selected GIF frame rate for the intermediate Studio pass,
  avoiding unnecessary composition at the source video's higher frame rate.
- Idle editors ignore unrelated native progress events. Encoding progress stops
  at 99% with "Finishing export" until publication completes; the real Export GIF
  button was checked through successful completion and re-enables afterward.
- Export no longer rewrites the saved Studio project. Quick/Studio exports,
  dimensions, FPS, looping, every-frame solid privacy, cancellation cleanup and
  unchanged source bytes passed bundled-FFmpeg desktop checks.
- Show in folder uses Windows Shell item selection for files, normalizes existing
  paths, and reports missing files rather than silently opening Explorer Home.
  Real Explorer selection passed for forward slashes, Unicode, spaces, commas and
  ampersands. The actual export-result button also selected its exact GIF.
- The final review GIF is retained under
  `%LOCALAPPDATA%\GlintValidation\Phase5\Exports`; successful UI verification
  deliberately leaves this file available for the user. Earlier missing-file
  errors in the QA window referred to test outputs removed by test cleanup.
- Checks: 250 frontend tests and 242 native tests passed; two pre-existing display
  tests remain ignored. Production Tauri build passed and the installed executable
  matches SHA-256 `D517EEA2CE162A2AB82B79525230DCB03A3A69A3492EA04F24C3069F88A027A7`.
  Installed Shell reveal succeeded; the new GIF command is available. All 335
  existing capture records remain; the durable attachment survives app restart.
  The isolated QA instance was closed after verification, leaving the updated
  installed app running. Its retained review GIF remains available on disk.
- Reproducible checks: `scripts/capture-phase5-gif-check.mjs`,
  `scripts/capture-phase5-gif-ui-check.mjs`, and
  `scripts/capture-phase5-reveal-check.mjs` (QA CDP port 9241).

## Acceptance and measurement

- [x] Generated OCR titles return to normal, manual names and search survive.
- [x] Dragged image paths remain readable after dismissal, eviction and restart.
- [x] Quick and Studio GIF exports apply edits/look, dimensions, FPS and loop.
- [x] GIFs stay below the stated cap; cancellation leaves no published partial file.
- [x] Long web-page and chat fixtures stitch without visible seams in manual mode.
- [x] Sticky bands, no movement, overscroll, ambiguous matches and DPI are checked.
- [x] Every new clean-capture option can be turned off and restores system state.
- [x] Existing capture, editor, privacy and video behavior pass regression checks.
- [x] Capture latency and complete process-tree idle/peak memory are recorded.
- [x] Comparable optimized builds verify latency and idle-memory targets.

Before the new capture features, the installed native process used approximately
69 MB working set with Library open (WebView processes excluded; this is not a
whole-app memory claim). Record the complete process-tree baseline before final
comparison. Target no more than 20% idle-memory growth, keep expensive work off
the UI thread, and target warm region selection/metadata within 250 ms. Record
the actual measured results and explain any missed target before calling this
phase complete.

## Scrolling and clean-capture checkpoint (October 21)

- Home > Scrolling capture > select the scrollable region > Start auto-scroll.
  Pause/Resume controls automatic wheel steps; Finish opens an editable PNG.
  Manual scrolling works without starting auto-scroll. Esc cancels; Enter finishes
  when focus is outside a button or input.
- Small caret/clock changes no longer cause indefinite settling. Prolonged motion
  and uncertain overlaps pause auto-scroll with recovery guidance and keep the
  captured portion. At the bottom, it stops advancing and offers Finish. Limits
  are 20,000 pixels in height, 24 megapixels and five minutes; Finish still saves
  the accumulated portion after reaching a limit.
- Wheel input targets the selected window without moving the pointer. Closing or
  covering that window pauses automatic input. The controller is excluded from
  screen capture. After an alignment failure, scroll back and use smaller steps.
- Actual Chrome desktop fixtures passed at 125% Windows scaling. Manual page
  (800 x 2800) and chat (800 x 3088) matched their unrolled references exactly.
  Automatic page matched exactly; automatic chat had a maximum one-level color
  difference, with zero pixels differing by more than two levels. Pause/Resume
  and bottom detection passed. Video, heavy animation, large jumps, lazy insertion
  above the viewport and uniform pages can still prevent reliable alignment.
- Desktop-icon hiding is off by default. A scrolling session holds its hide guard
  until completion or cancellation, avoiding icon flicker between strips. Actual
  cancellation checks preserved initially visible and initially hidden icons.
- Optional Quick Access auto-close is off by default. After eight idle seconds it
  closes only the webview, retaining captures. Hover pauses it; drag events also
  suspend the timer. Actual idle/off, hover, retained captures, reopening on a new
  capture and opening the latest capture after auto-close passed.
- The latest-capture shortcut can be bound or disabled. It opens in-memory latest
  pixels during a session, or the newest existing, non-deleted saved screenshot
  after restart. Both command paths and binding/clearing were checked.
- Actual five-card tray eviction deleted its temporary source while the shared
  attachment remained byte-identical. Clear/dismissal and process restart also
  preserved it. Copy path now snapshots images off the UI thread too.
- Windows clipboard checks confirmed one exact CF_HDROP file path for GIF and
  video copy, with the prior clipboard restored afterward. Video validation here
  checks file transport, not decoding.
- Monitor keys/buttons use the selected display origin and scale. Negative
  origins have unit coverage; only one physical display was available, so actual
  multi-monitor switching remains a hardware review item.
- Automatic notification suppression is deferred. The documented FocusSession API
  is a Limited Access Feature requiring an unlock token. Glint offers Notification
  settings rather than changing undocumented registry state. See
  [Microsoft API requirements](https://learn.microsoft.com/en-us/uwp/api/windows.ui.shell.focussessionmanager.trystartfocussession?view=winrt-28000).
- Repeated captures exposed a Tauri once-listener race on duplicate paint events.
  Bounded listeners now accept repeated acknowledgements and unregister afterward.
  Duplicate-event and invalid-selection recovery checks passed.
- UI checks covered dark/light tokens and wide/compact settings layouts. The idle
  Library scan button and explanatory sentence are removed; OCR search and active
  scan/error handling remain.
- Verification: 250 frontend tests and 248 native tests passed; two existing
  display-dependent tests remain ignored. TypeScript and the final native compile
  check passed. These capture changes have not replaced the installed executable.
  The latest running build is the isolated development preview, with identifier
  `com.glint.validation.phase5.capture` and its own database.

### Performance evidence and remaining gate

Warm capture-start to available selection metadata, five samples per build:
installed baseline 281/276/277/290/279 ms; development preview
463/471/458/474/466 ms. Both exceed the 250 ms target. The path includes an
existing deliberate 200 ms hide/compositor delay; the preview also runs
unoptimized native code and Vite. No latency improvement is claimed.

Complete native-plus-WebView process-tree measurements (shared working pages can
be counted in more than one process):

| Context | Working set | Private bytes |
| --- | ---: | ---: |
| Installed baseline, Library | 680,558,592 | 585,637,888 |
| Development preview, idle Library | 873,218,048 | 530,042,880 |
| Development preview, peak during real page/chat checks | 1,666,306,048 | 1,151,352,832 |

Observed idle working-set growth is about 28%, above the 20% target, while private
bytes are lower. Build modes and retained WebView/window states differ, so these
numbers cannot establish the optimized release regression. Keep the release
performance gate open until comparable optimized builds are measured. No full
production rebuild was performed for these capture changes. Do not start Phase 6.

Reproduction scripts: `capture-phase5-scroll-check.mjs` (`GLINT_SCROLL_AUTO=1` for
automatic mode), `capture-phase5-clean-check.mjs`, `capture-phase5-icons-check.mjs`,
`capture-phase5-file-copy-check.ps1` (STA), `capture-phase5-latency-check.mjs` and
`capture-phase5-measure-scroll.ps1`. They target the isolated preview on CDP 9242;
latency comparison additionally expects the installed baseline on 9240.
Artifacts: `%LOCALAPPDATA%\GlintValidation\Phase5\CaptureCheck`.

Background removal stays deferred, without a model download or inference runtime.
Main remains unchanged; work is saved on `phase-5-capture-export`.

## Full-screen scrolling follow-up (October 21)

The user reported that full-browser selections failed where smaller regions worked,
capture sometimes failed on its first attempt, and the controller flashed white.

- Alignment now identifies moving columns instead of mixing fixed navigation and
  margins into the match. Tall browser chrome is excluded based on the actual
  moving region. Similar paragraphs get a finer pixel comparison, including small
  distinguishing letters/digits between the sparse anchors. Genuinely ambiguous
  matches, reverse scrolling and excessive jumps still leave the image unchanged.
- Flat stationary side panels extend their background while preserving their top
  navigation and bottom controls once, avoiding repeated footer borders at joins.
  Patterned backgrounds are not guessed. Temporary uncertainty stops further wheel
  input and gets a three-second retry period before pausing with recovery guidance.
- Startup waits for the selection overlay to hide. The controller has explicit
  Preparing/Ready states, and Start/Finish stay disabled during preparation. Its
  native surface is transparent, boot theme/accent are set before HTML loads, OS
  transitions are disabled, and React reveals it after status and two paint frames.
  DWM composition is flushed before establishing the initial reference frame.
  Resume reacquires the target window instead of retaining an initial hit-test error.
- Regression evidence: a maximized Chrome window was selected at 1920 x 1020,
  excluding the taskbar, on 125% Windows scaling. Automatic page output was
  1920 x 2917; chat output was 1920 x 3205. Both reference comparisons had zero
  differing pixels and zero maximum channel error. Pause/Resume and bottom
  detection passed in the same run. Browser content comparisons include the fixed
  sidebar; its border is no longer repeated.
- Smaller manual captures also passed exactly: page 800 x 2800, chat 800 x 3088.
  Both test runs deliberately delayed overlay acknowledgement by 400 ms and checked
  first-visible controller content in dark and light themes. Four consecutive
  controller creation/start cycles passed on the final code.
- Checks: 251 native tests and 250 frontend tests passed; two existing native
  display-dependent tests remain ignored. TypeScript passed. New unit regressions
  cover large fixed layouts, repeated paragraphs and stationary sidebar controls.
- Reproduce the full-window automatic check with `GLINT_SCROLL_LARGE=1`,
  `GLINT_SCROLL_AUTO=1`, `GLINT_SCROLL_LIFECYCLE=1`, `GLINT_MANUAL_FOCUS=1` and
  `GLINT_PIN_FIXTURE=1`, then run `scripts/capture-phase5-scroll-check.mjs` against
  the existing CaptureCheck artifact directory. The test uses a fresh local Chrome
  profile each run. CDP disconnects now reject pending requests, so test cleanup
  cannot hang waiting for a window that has already closed.

The isolated development preview contains these fixes. The installed executable
and the outstanding optimized-build performance gate are unchanged.

## YouTube and changing-feed follow-up (October 21)

The paused-video report was reproduced on a public YouTube watch page in a fresh,
unsigned-in Chrome profile, selecting the full browser above the taskbar. Before
the fix, auto-scroll stopped after about 4.6 seconds with the alignment error,
one strip and `scrollY = 0`. A paused player does not make the rest of the page
pixel-static: thumbnails and other local updates can still change after the
initial reference frame.

- Keep the existing strict matcher as the fast path. A fallback now matches
  detailed patches distributed across the page and excludes patches changing
  between consecutive samples. Fixed chrome and sidebars cannot vote for a
  nonzero scroll offset. Local changes without displacement can refresh the
  matching reference without rewriting the captured output.
- Repeated feed text gets a finer comparison of stable moving pixels, excluding
  changing tiles and fixed header/footer bands. Conflicting reflow, horizontal
  movement, weak evidence and genuinely ambiguous offsets still reject the step
  without altering the accumulated image.
- The same public YouTube video now passed twice in succession, scrolling back
  to the top between attempts. With the video paused throughout, both attempts
  reached `scrollY = 1800` in the comments and extended the capture to
  1920 x 2720 / 18 strips, in about 17 seconds. No alignment pause occurred.
- An on-screen animated feed fixture completed 35 native wheel steps to the
  bottom, including Pause/Resume, producing a 1920 x 4453 editable PNG. The
  comparison excludes only the 24 known animated preview rectangles (276,480
  pixels); all other pixels stayed within one channel level of the browser's
  unrolled reference. Chrome uses grayscale text rendering in the fixture to
  avoid comparing desktop LCD text against CDP grayscale text.
- Checks: 253 native tests passed; two existing display-dependent tests remain
  ignored. Regressions cover local video updates, repeated paragraphs with an
  animated region, and rejection of competing reflow and horizontal movement.
  JavaScript syntax, Rust formatting and whitespace checks passed. No frontend
  production code changed in this follow-up.
- Full-window ordinary page/chat captures also passed on this code: 1920 x 2917
  and 1920 x 3205, with zero differing pixels and zero maximum channel error.
  The harness returns its owned browser to foreground after the result editor,
  so Chrome can paint the unrolled reference screenshot.

Run `scripts/capture-phase5-live-page-check.mjs` against the CaptureCheck artifact
directory for the paused public YouTube reproduction. It repeats capture after
scrolling back to the top, asserts progress into the comments, and writes status
traces and before/after screenshots for each attempt. For the animated feed, use
the full-window automatic fixture command above with `GLINT_SCROLL_ONLY=feed`.
This is not an authenticated Twitter/X test. Major page reflow or insufficient
stable content can still require pausing; changing content is captured as snapshots.

The installed executable, deferred background removal and optimized-build
performance gate remain unchanged. Phase 6 has not started.

## Final optimized performance gate — passed (October 21)

This supersedes the open performance gate in the earlier checkpoint notes.
The user accepted the functional checks and authorized Phase 6 once this gate
passed, without another approval step.

Both executables were built with `tauri build --no-bundle` using the same Rust
toolchain, dependency cache and WebView2 version. The pre-Phase-5 baseline is
`e3782ca`; the candidate contains the final scrolling fixes and the compositor
wait change in `76df0fb`. Each uses an isolated identifier, a fresh WebView
profile, the same 87 captures with copied thumbnails, and a 1100 x 720 Library.
Builds ran sequentially, with compilation finished before measurement. All nine
native/WebView processes are included; shared working pages can be counted more
than once, so these are comparative process-tree totals, not physical RAM claims.

| Measurement | Baseline | Phase 5 candidate |
| --- | ---: | ---: |
| Warm metadata, median / range (10 trials) | 305 / 301–324 ms | 111 / 107–174 ms |
| Warm overlay visible, median / range | 320 / 310–344 ms | 125 / 118–196 ms |
| Idle working set, median (5 samples) | 671,825,920 B | 661,114,880 B |
| Idle private bytes, median | 384,339,968 B | 372,420,608 B |
| Working set after 11 capture/cancel cycles | 997,326,848 B | 1,031,421,952 B |
| Private bytes after those cycles | 648,245,248 B | 677,134,336 B |

All candidate warm selection measurements pass the 250 ms target. Idle working
set is 1.59% lower and private bytes are 3.10% lower, passing the maximum 20%
growth target. The existing fixed 200 ms hide delay is replaced by `DwmFlush`,
off the event thread, with the conservative delay retained if composition fails.
Three captures with a bright main-window sentinel found zero sentinel pixels in
the frozen desktop. No installer was built or installed and main is unchanged.

The video regression also verifies that playback may settle on a different frame
from the initial reference and then scroll successfully. Enough stable page
content is still required; continuously changing video or major reflow can pause
capture while retaining completed strips. Do not promise a fixed one-second
timeout for arbitrary animated pages.

Reproduce with `capture-phase5-performance-check.mjs <artifact-directory> <label>
<CDP-port> <owned-PID>` against each seeded optimized executable, then
`capture-phase5-hidden-window-check.mjs <artifact-directory> <CDP-port>`.
Raw measurements and three frozen-frame checks are under
`%LOCALAPPDATA%\GlintValidation\Phase5\Perf`. Full native checks: 253 passed,
two existing display-dependent tests ignored. Phase 5 is complete.
