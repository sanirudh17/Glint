# Glint — Studio Mode & Screenshot Upgrade: Build Plan

*A phase-by-phase spec for a coding agent. October 2026. Easy items are bundled; the highest-value work comes first.*

## 1. How to use this doc (instructions for the agent)

- Work **one phase at a time**, in order. Do not start a phase until the previous phase's acceptance criteria pass.
- Phases 3 and 4 do not depend on Phases 1–2 and can run on a separate branch, after task 1.0 (the shared `LookConfig`) lands.
- Before coding each phase, read the files it touches and state a short plan. Verify every file path and assumption below against the repo, because they come from a read-through and were not compiled or tested.
- Keep Glint **local-first and lean**: no cloud, no accounts, no analytics, no large bundled assets. Prefer procedural generation over shipped images.
- Commit per task with a clear message. Add or update tests where logic is pure (zoom generation, stitching offset, PII detection, project schema migration).
- If a requirement is ambiguous or a task looks much bigger than its size tag (S/M/L), stop and ask rather than guess.
- At the end of each phase, report: what shipped, what was cut, and anything that needs a human decision.

**Everything is merged into the phases.** Each phase in Section 5 already includes the items found in all three research rounds. Sections 2A, 3 and 3A hold the evidence behind each task, so check them before deciding something is out of scope. Appendix A is the corrections log and Appendix B holds the per-app research.

## 2. Context: where Glint is today

Tauri (Rust backend, React/Konva frontend). FFmpeg is bundled.

- **Screenshots:** region, window and full-screen capture, timed delay, OCR. The editor has blur, solid and pixelate redaction, spotlight and step badges. The frame engine supports solid, gradient and transparent backgrounds, padding, corner radius, shadow and aspect (auto, 1:1, 16:9, 4:3). There are 16 gradient presets, all two-stop at 135°.
- **Recording:** MP4 up to 60 fps with system audio, mic and a webcam bubble. Click ripples, keystroke overlay and cursor effects are drawn by an overlay window and **baked into the video while recording**. The trim editor supports multi-cut, per-clip speed and reordering.
- **Missing:** blur or masks in video, zoom, video backgrounds, aspect-ratio export, GIF export, scrolling screenshots, multi-clip projects, and OCR-based library search.

## 2A. Research record, round 1 (original research, kept in full)

This is the research as first delivered, kept so nothing is lost. Later rounds corrected some points (Sections 3 and 3A). The build order in Section 5 replaces the order suggested here. 'Screenshot text' in the request was read as Screen Studio.

### First findings

- **What Glint had:** screenshots with region, window and full-screen capture, OCR, timed delay, blur and redact tools, spotlight, step badges and backgrounds; recording with MP4 up to 60 fps, system audio, mic, webcam bubble, click ripples, keystrokes, cursor effects and multi-cut trimming with per-clip speed. Missing: video masks, zoom, video backgrounds, GIF export, scrolling screenshots.
- **What competitors did:** WinShot X had a replay ring, GIF and MP4 export and a hex-color magnifier. WindowShot had automatic and manual zoom, smooth cursor, backgrounds, camera layouts and aspect ratios including vertical. Shotbase had scrolling and full-page capture and on-device AI naming and tagging. CleanShot X 5.0 had Studio Mode. Screenflare kept blur attached to content through zooms. Cap kept separate screen, cursor and keypress tracks with click-based zoom segments, keyframed masks, gradient or image backgrounds, aspect ratios and 0.25–3x speed. Screen.movie had auto zoom, animated backgrounds, 40+ motion presets, 3D mockups and multi-scene editing.
- **First ranking:** 1) blur or mask regions in video; 2) zoom segments, manual then auto from clicks (the record-time hotkey marker was my idea, not seen in these apps); 3) video backgrounds reusing the screenshot frame engine; 4) aspect-ratio export; 5) GIF export; 6) scrolling screenshots; 7) replay buffer (later dropped by the user); 8) cursor smoothing and motion blur.
- **First skip list:** cloud links, comments and analytics; AI captions; 3D mockups; motion presets; animated shader backgrounds; multi-scene editing. After the user asked to reconsider, motion presets, animated gradients and scoped multi-scene editing moved into the plan.
- **Architecture catch:** click ripples, keystrokes and cursor effects were drawn by an overlay window and baked into the MP4 while recording, so they could not be edited afterward. Blur, zoom and backgrounds are better applied at export through ffmpeg, with click and cursor positions saved to a sidecar file. This came from reading the code, not from testing.

### Revised research (the foundation)

#### Questions answered

**Scrolling screenshots on Windows: medium difficulty.** The core is simple: scroll, capture, find how far the content moved by matching overlapping rows, then append the new strip. The hard part is the edge cases: sticky headers, smooth-scroll animation, lazy-loaded content, video and DPI scaling. ShareX has it, but [a GitHub issue](https://www.Github.com/ShareX/ShareX/issues/7436) shows users reporting that its newer scroll capture often fails to stitch. Build a manual-scroll mode first, where you scroll and Glint watches and stitches. That avoids injected input and most timing bugs. Add auto-scroll later. Estimate: 1–2 weeks for a solid v1.

**Replay buffer: skip it.** Of the apps compared, only [WinShot X](https://wingetgui.com/apps/Mun1to-winshotx) has a replay ring, and it was not in Shotbase's feature list.

**Multi-scene editing: worth it, but scoped.** [Screen.movie](https://screen.movie) arranges scenes on one timeline with trimming, 40+ motion presets and multi-camera tracks. [Screen Studio](https://screen.studio/) lets you import any video and edit it like a recording. Glint already has multi-cut, reordering and per-clip speed. The missing piece is importing clips and images, one shared look across them, and simple transitions. Don't build a general video editor.

#### Screen recording

Core:

1. **Blur and mask regions on the timeline.** [Cap](https://cap.so/llms-full.txt)'s masks have keyframed position, size and intensity, and [Screenflare](https://screenflare.app/)'s blur stays on the content as the shot zooms and moves.
2. **Zoom segments, manual and auto-from-clicks.** Cap generates zoom segments from clicks, and Screen Studio offers two zoom styles, classic and loupe.
3. **Backgrounds, padding, corners and shadow** on video, reusing the screenshot frame engine. Cap's gradients support angle, noise and animation.
4. **Aspect ratios** (wide, square, vertical). Screen Studio re-aims zooms for each ratio.
5. **Cursor smoothing**, plus hide-when-idle and optional motion blur.
6. **Save a look as a preset.**

Next:

- **GIF export.**
- **Auto speed-up** of typing and idle stretches. Screen Studio detects long typing stretches, and Glint's input hooks can detect them too.
- **Webcam layouts** (beside, above, camera-only). [WindowShot](https://www.windowshot.app/) offers camera layouts including vertical.
- **Multi-clip projects:** import clips and images, add crossfades and title cards, and add 6–8 motion presets.
- **Animated gradient backgrounds:** a slow drift or rotation, not a full shader library.
- **Local captions** (Whisper). They need a model download, so do them last.

Skip for now: 3D device mockups, AI avatars and voiceover, cloud links, comments and analytics.

#### Screenshots

Glint had 16 two-stop gradients, all at 135 degrees, plus solid and transparent. Aspect options were auto, 1:1, 16:9 and 4:3.

1. **Backgrounds overhaul:**
   - **Gradients:** 40–60 presets with an angle slider, three-stop, radial and conic types, mesh-style blends and a grain overlay. Category tabs keep it browsable.
   - **Custom backgrounds:** custom image upload. [CleanShot X](https://cleanshot.com/features) ships 20 backgrounds, supports your own, and has presets.
   - **Auto-balance padding:** CleanShot X's Auto Balance evens out the space around the content.
   - **Colors from the screenshot:** generate a matching gradient using the eyedropper (my idea, not from a competitor).
   - **Keep the installer small:** generate these procedurally instead of shipping wallpapers.
2. **Auto-redact suggestions.** [macshot](https://github.com/sw33tLie/macshot/blob/main/README.md) auto-redacts PII. Glint already bundles Tesseract, so it could flag emails, phone numbers, card numbers and key-like strings for one-click redaction. This was my top screenshot pick.
3. **Redaction that is actually irreversible.** [ShotsGlow](https://www.producthunt.com/products/shotsglow), a Windows CleanShot clone, rewrites the pixels so a crop can't undo the blur, and [CleanShot added randomization](https://cleanshot.com/changelog) to pixelate to prevent depixelization. How Glint's export handles this was not verified.
4. **Search inside screenshots.** [Shotbase](https://creatorstoolbox.com/tools/shotbase) names, tags and summarizes captures with on-device AI. Indexing OCR text in the library and auto-naming from it gets most of that value without a model. Library search was name-based.
5. **Size presets:** 9:16, 4:5, 3:2 and 1.91:1, plus named social presets. [ShotsGlow](https://trustmrr.com/startup/shotsglow) exports to 30 social and App Store sizes.
6. **Window and browser frames:** simple 2D chrome, plus watermark and border options. [Shotbase](https://shotbase.com/) lists watermarks and borders.
7. **Combine multiple images** onto one canvas. CleanShot supports this.
8. **Smaller annotation additions:** curved arrow, text style presets, resize and expand-canvas tools. [Shottr](https://shottr.cc/) has expandable canvas and side-by-side screenshots.
9. **Remove background** for window shots, lower priority. [ShotsGlow](https://www.producthunt.com/p/shotsglow/shotsglow-2) does it with an on-device model, but that adds download size.

Skip: webpage capture at breakpoints (it needs a headless browser) and link sharing, which conflicts with local-first.

#### The architectural decision

Screen Studio records without the cursor, then redraws it from synced movement data. That is what makes smoothing and cursor size editable later, and Cap stores cursor and keypresses as separate tracks. Glint baked click, key and cursor effects into the MP4 as it recorded, so they could not be edited afterward. The fix: record without the cursor (the ffmpeg args already support turning it off), save click, key and cursor events to a sidecar file, and composite zoom, masks, backgrounds and effects at export. Start with ffmpeg expressions (a judgment from reading the code, not tested) and move to a GPU compositor if keyframe easing gets painful; Cap uses a WGPU compositor.

#### Suggested order (superseded by Section 5)

1. Screenshot quick wins: gradients and presets, size presets, OCR search, auto-redact.
2. Sidecar recording and an export-time compositor with backgrounds and aspect.
3. Zoom, masks and cursor smoothing.
4. Scrolling capture and GIF export, which are independent of the above.
5. Multi-clip projects, motion presets and animated gradients.

#### Caveats

- Shotbase's site blocked automated access in round 1, so its details came from third-party listings. Round 3 read shotbase.com directly.
- ShotsGlow claims come from its own site and Microsoft Store listing (checked October 10).
- Crash recovery in Glint's recorder was not verified.
- Several Mac apps offer some features only through cloud accounts; those were filtered out.

## 3. What changed since the first research

- **CleanShot X 5.0 (Sept 1, 2026)** shipped **Studio Mode**. Recording can be done as an editable project, with:
  - smart zooms that follow the cursor;
  - trimming;
  - smoothed cursor movement and an adjustable cursor size;
  - click effects, keystrokes and camera adjustable after recording;
  - motion blur;
  - video backgrounds that reuse its screenshot Background tool, with spacing, shadow and corner radius;
  - landscape, square and vertical export;
  - hardware-encoded rendering.
  - CleanShot's changelog also lists a countdown, pause and restart, but the excerpt I read mixed several versions, so I cannot date them to 5.0.
- **Impact on priorities:** zoom, cursor smoothing, video backgrounds and aspect export are now table stakes, not differentiators. CleanShot's notes, in what I could read, do **not** mention masking or blurring regions of a video, while Screen Studio does. Video blur masks are therefore the feature that most sets Glint apart, and they are the user's top ask.
- **Cap 0.5.7 (July 2026)** added transitions in editor playback and exports, a script window that is kept out of recordings (speaker notes), and CLI/MCP support for AI agents. The first two are useful ideas. Agent support is out of scope.
- **Screen Studio 4.0** (as on its site today) offers loupe zoom, masks that blend into the UI, camera layouts, transcript editing and captions. **Shotbase**, **ShotsGlow**, **WindowShot**, **WinShot X**, **Screenflare** and **Screen.movie**: see Section 3A for the October 10 re-check of each.
- **Moved up:** motion blur (now bundled with zoom) and rendering click ripples and keystrokes at export time. **Moved down or out:** nothing from the earlier plan was dropped, and the replay buffer stays out.

## 3A. Round 3 re-check (October 10, 2026)

Shotbase, WinShot X, WindowShot, Screen.movie and Screenflare were re-read from their own sites on October 10. CleanShot X, Cap and Screen Studio were covered in round 2. macshot and Shottr were not re-checked, so their round 1 findings stand. ShotsGlow was re-checked on October 10 from shotsglow.com and its Microsoft Store listing (see Appendix B).

| App | Latest seen | New or newly confirmed | Effect on the plan |
| --- | --- | --- | --- |
| [Shotbase](https://shotbase.com/changelog) (Mac) | 1.5.0, Sept 24, 2026; first stable release Aug 5 | Local AI model choice; Quick Access can auto-close; Option-Command-O opens the latest capture in the editor; recordings start styled by default; steadier motion framing when the pointer changes direction; timeline effects can be cut at the playhead; drop images into the editor to annotate (1.4.0); fixes for lost video crops and cursor misalignment (1.3.3). Feature list also names scrolling and webpage capture, animated screenshots, 3D transforms, perfect padding, social presets, text extraction, tags, summaries, capture tray history and reminders. | Default look on new Studio recordings; cut segments at the playhead; test crop persistence and cursor alignment; OCR search covers the text, names and tags without AI. Skip reminders, webpage capture and link sharing. |
| [WinShot X](https://winshotx.com/en/) (Windows, free, MIT) | Microsoft Store listing since Sept 7, 2026 | 2.55 MB installer with no FFmpeg (Windows writes the video in hardware); selection painted in 114 ms and 33 MB of memory while capturing, by its own measurements against the Snipping Tool. 6x magnifier with hex color, window snapping, number-key monitor select, 3 or 5 second timer, hide desktop icons, GIF and MP4 at 15 to 60 fps, zoom on every click decided after recording from saved clicks, A to B trim, export speed 0.5x to 4x, copy file path, last 15 to 60 seconds replay. Blur is manual mosaic only. | Confirms the click-log sidecar design; adds clean-capture options and performance targets; raises the FFmpeg size question. Replay stays out. |
| [WindowShot](https://www.windowshot.app/) (Windows) | Site as of Oct 10; $9 early-bird, $29 regular, one-time | Auto and manual zoom from recorded clicks, smooth cursor, backgrounds, camera layouts beside, above or below, Vertical Focus for Shorts, Reels and TikTok, aspect ratios, MP4 only. Screenshot tool: backgrounds, crop, annotate, blur. | Confirms zoom, cursor, backgrounds and aspect as the expected set for Windows. |
| [Screen.movie](https://screen.movie/updates) (Mac) | 1.3, Oct 5, 2026; launched Aug 20 | Zoom animation presets; cinematic focus, blur and bokeh; custom shadow colors; better motion blur; cursor click-size control; hide desktop icons and notifications while recording; copy and paste timeline styles; animated shader backgrounds; animated text and shapes; multi-camera tracks; GPU export engine; AI voiceover, music and effects as a paid add-on; cloud links. Screenshot editor gained pen, arrow and layer order. | Adds shadow color, click size, clean capture, zoom ease presets, layer order and pen and arrow tools. Skip AI audio, cloud, 3D mockups and multi-camera. |
| [Screenflare](https://screenflare.app/) (Mac) | v0.1.24 as read | Auto-zoom on clicks, cursor smoothing, backdrops, blur that stays on content, silence trimming, captions, shortcuts overlay, presets, editable screenshots. | Details in Appendix B; its extra items are merged into Phase 7. |
| CleanShot X (Mac) | 5.0, Sept 1, 2026 | Studio Mode (see above). | Drives Phases 1 and 2. |
| Cap (Windows and Mac) | 0.5.7, July 2026 | Transitions in export, script window hidden from recordings. | Phase 6 and Phase 7. |
| Screen Studio (Mac) | 4.0 | Loupe zoom, masks, camera layouts, transcript editing. | Phases 2 and 7. |

Everything new from this table that changes a task is merged into the phase it belongs to in Section 5.

## 4. The architecture decision everything depends on

Screen Studio and Cap record the screen **without the cursor** and store cursor, click and key events as separate synced data. That is why smoothing, cursor size, click effects, zoom and masks can all be edited afterward. Glint currently bakes effects into the video, so none of this is possible.

**Decision:** add a **Studio recording mode** with this shape:

1. Capture the screen with no cursor and no baked overlays.
2. Write an `events` sidecar (cursor path, clicks, key presses, window and monitor geometry, DPI, timestamps relative to video start).
3. Store the result as a **project folder**: `video.mp4`, `events.json`, `project.json`. The `project.json` holds the look, zoom segments, mask regions, cursor settings and cuts.
4. Apply everything at **export** in a compositor.

Keep today's **Quick mode** (baked effects, instant MP4) as the default so nothing regresses. Studio mode is a toggle on the recorder, like CleanShot's "Record in Studio Mode".

## 5. Phase plan

### Phase 1 — Studio recording core and video look (L)

Bundles the foundation with the cheap wins that reuse existing code: backgrounds, aspect ratios and cursor cleanup.

**1.0 Extract a shared `LookConfig` (S).** Pull background (solid, gradient, image), padding, corner radius, shadow, border and aspect out of the screenshot frame model into one typed config and a preset store. Screenshots and video must use the same type. Save and load named presets.

**1.1 Compositor spike, timeboxed to one day (M).** Compare two approaches and write the decision into `docs/`:

- (a) an FFmpeg filter graph: background, rounded-corner mask, shadow and overlay, with expressions for zoom and mask keyframes;
- (b) a Rust frame compositor: decode to raw frames, composite on CPU or GPU, and pipe to an FFmpeg encoder.

Start from (a) if a 60-second 1080p60 export with background, rounded corners and shadow runs at or near real time, and keyframed zoom is expressible without a pile of piecewise expressions. Otherwise pick (b). Do not over-engineer.

GPU-powered export is where several apps went (Screen.movie 1.3, Cap's WGPU compositor), so revisit the choice if export speed is poor.

**1.2 Studio recording mode (L).** Add a "Studio mode" toggle to the recorder. When on:

- capture without the cursor and without baked click, keystroke or cursor overlays;
- write `events.json` with a high-rate cursor path, clicks, key events (modifier-aware), capture region, monitor and DPI;
- save a project folder and open the Studio editor on stop.

Check whether the current capture backend can disable cursor drawing. Keep audio and webcam handling as they are today.

**1.3 Studio editor shell (M).** Opens after a Studio recording. It has a preview canvas, a timeline reusing the existing trim editor (cuts, speed, reorder) and a side panel. Autosave the project. Add a version field to `project.json` from day one.

**1.4 Look panel for video (M).** Reuse the screenshot frame UI against `LookConfig`: background, padding, radius, shadow, preset picker. Add aspect presets for video: 16:9, 1:1, 9:16 and 4:5, plus auto.

Also in the look: custom shadow color and border styles (Screen.movie 1.04 and 1.11), copy and paste of a look between clips or scenes (Screen.movie 1.07; it falls out of the preset store), and a default look applied automatically to new Studio recordings so the first export already looks finished (Shotbase 1.5.0).

**1.5 Cursor layer (M).** Re-draw the cursor from `events.json`:

- smoothing (a spring or bezier follower, with an intensity slider);
- cursor size and style;
- hide when idle;
- click ripple and keystroke overlay, now rendered at export and individually toggleable.

Also: a click-size control and a choice of cursor style (Screen.movie 1.11, Shotbase 1.5.0).

**1.6 Export (M).** Export MP4 through the chosen compositor. Detect hardware encoders (NVENC, QSV, AMF) and fall back to x264 if that is not already done. Show progress and allow cancel.

**Acceptance:**

- A Studio recording opens in the editor and exports with a background, aspect change, smoothed cursor and toggled click effects.
- Quick mode behaves exactly as before.
- Project reopens with all settings intact.
- A 60-second 1080p60 export finishes without audio drift.
- Screenshot presets and video presets are the same objects.

* A video crop survives save and reopen, and the cursor stays aligned after edits (Shotbase fixed both in 1.3.3, so expect them to break).

### Phase 2 — Zoom, masks and motion blur (L)

The two features the user asked for first, plus motion blur because it only matters when things move.

**2.1 Zoom segments (M).** A timeline track of `{start, end, scale, focus | follow-cursor, easeIn, easeOut}`. Scale roughly 1.2×–3×, ease about 300–500 ms. Add, drag, resize and delete segments. Zoom must stay inside the frame (clamp focus). Add a loupe-style zoom option only if time allows.

Also in zoom: follow-cursor mode keeps the pointer in frame and holds steady when the pointer changes direction (Shotbase 1.2.0 and 1.5.0); ease presets such as gentle, snappy and slow (Screen.movie 1.08); segments can be split at the playhead (Shotbase 1.5.0); focus points are re-aimed when the export aspect ratio changes so the action stays in frame (Screen Studio); and an optional loupe-style zoom that magnifies a circle instead of the whole frame (Screen Studio).

**2.2 Auto-zoom from clicks (M).** Generate segments from `events.json`: cluster clicks that are close in time and space, ignore isolated accidental clicks, enforce a minimum gap between zooms, and zoom out when the cursor travels far. Provide "Regenerate" without erasing segments the user edited by hand. Test the generator as pure logic.

**2.3 Optional record-time marker (S).** A hotkey during Studio recording drops a marker that becomes a zoom segment in the editor. This is the "zoom while recording" ask, done safely.

**2.4 Mask track (L).** The top privacy feature:

- rectangles with keyframed position and size over time (drag on the preview to create; duplicate; copy to other times);
- types: **blur**, **pixelate**, **solid**;
- masks are defined in **source-video coordinates**, so they stay attached to the content when the video zooms or pans;
- the mask is applied on the source pixels **before** zoom scaling and compression;
- default to the whole clip duration, with easy trimming of the mask's time range.

**2.5 Highlight mode (S).** Reuse the mask engine to dim everything except a chosen rectangle, which matches Screen Studio's highlight.

Extend it to cinematic focus: blur or dim everything outside the focus region (Screen.movie 1.11). Mask and effect segments can be split at the playhead too (Shotbase 1.5.0).

**2.6 Motion blur (S).** Optional light blur on fast zoom, pan and cursor movement. Default off or low. If it costs a lot of render time, ship it as a toggle with a warning.

**Acceptance:**

- Auto-zoom produces sensible segments on a typical click-heavy demo, and manual edits survive regeneration.
- A blur mask drawn over an API key stays attached through a zoom and the exported file contains no readable text there (verify by extracting frames and running OCR).
- Exports with 20+ zoom and 5+ mask segments stay stable.
- Privacy note in the UI: the project still holds the unmasked source; only the export is safe to share, with an option to delete or bake the original.

### Phase 3 — Screenshot looks bundle (M)

All small changes to the same panel, shipped together. Independent of Phases 1–2 once 1.0 exists.

- **Gradients overhaul:** 40–60 presets to start (ShotsGlow advertises 150+), in categories (vivid, soft, dark, pastel, brand-neutral); an angle slider; three-stop, radial and conic types; mesh-style blends built from layered radial gradients; an optional grain/noise overlay. Generate them procedurally and ship no wallpaper images.
- **Custom image background**, plus a "blurred copy of the screenshot" background.
- **Auto-balance:** even out padding around the content.
- **More aspect and size presets:** 9:16, 4:5, 3:2, 1.91:1, and named social presets (for example OG image, App Store sizes).
- **Frames:** a simple 2D window or browser chrome (Windows, macOS, browser bar), a border, and a watermark option.
- **Style presets** use the shared preset store from 1.0.
- **Combine images:** drop another screenshot onto the canvas as a movable layer.

* **Gradient from the screenshot:** build a matching gradient from colors sampled out of the image (an idea from the first research, not from a competitor).
* **Naming:** Auto Balance doubles as Shotbase's 'perfect padding', and the size presets double as its social presets; ship each as one feature.
* **Annotation additions:** curved arrow, text style presets, resize and expand-canvas tools, side-by-side layout of two images, layer-order controls, and pen and arrow tools (CleanShot, Shottr, Screen.movie).
* **Pixel magnifier with hex color readout** in the capture crosshair (WinShot X).
* **Screenshots stay editable after saving:** marks remain movable when the file is reopened (Screenflare, and CleanShot's editable project file). Check how Glint saves annotations.
* **Remove background** for window captures, low priority and opt-in because it needs an on-device model download (ShotsGlow).
* Custom shadow color and border styles share the `LookConfig` work in Phase 1.

**Acceptance:** every new option works in preview and export, defaults produce a good-looking result in one click, and old documents open unchanged.

### Phase 4 — Privacy and findability bundle (M)

Both parts use the OCR the app already has.

- **Auto-redact suggestions:** after OCR, detect emails, phone numbers, card numbers (Luhn check), IP addresses, JWT-like tokens and common API-key patterns. Show them as suggested redactions with accept-one or accept-all. Never auto-apply silently.
- **Verify irreversibility:** confirm exported pixels are rewritten, not layered, so cropping or editing the export cannot recover content. Make pixelate use randomization or a safe cell size, and confirm blur radius is strong enough that text is unreadable. Add tests, including a crop test.
- **Search inside screenshots:** index OCR text in the library with SQLite FTS5, search it from the library search box, and auto-name captures from the first meaningful OCR line or window title (with an off switch).

**Acceptance:** a screenshot containing an email and a card number gets both suggested; accepted redactions are unrecoverable in the exported file; library search finds a capture by a word that appears only inside the image.

### Phase 5 — GIF export, scrolling screenshots and clean-capture options (L)

Two independent capture features, plus a bundle of small capture options.

- **GIF export (S–M)** from a screenshot-free recording: palettegen and paletteuse, with controls for FPS, width and loop. Works from Quick clips and Studio projects (applying the look and aspect).
- **Scrolling screenshot (L):**
  1. **Manual-scroll mode first:** the user selects a region and scrolls; Glint captures strips when the content changes and stitches them.
  2. Find the vertical offset between strips by matching overlapping rows. Detect and exclude sticky headers and footers. Handle DPI scaling. Default maximum height about 20,000 px.
  3. **Auto-scroll later** (simulated mouse wheel, with delay settings) as an optional mode.
  4. Known hard cases to handle gracefully or document: smooth-scroll animation, lazy loading, video or animated regions, sticky elements.

**Scrolling-capture risk.** ShareX's newer scroll capture has user reports of failing to stitch, so expect edge cases. Estimate: 1–2 weeks for a solid manual-scroll v1.

**Clean-capture options (S each, built in one pass):**

- Hide desktop icons during a capture (WinShot X, Screen.movie).
- Hide notifications while recording, using Windows Focus Assist if it can be toggled safely (Screen.movie 1.07).
- Capture timer of 3, 5 or 10 seconds (WinShot X, Snipping Tool).
- One-click window capture with window snapping, and a number key to pick a monitor (WinShot X).
- Copy the file path as text, and paste a GIF or video as a file (WinShot X).
- A Quick Access that auto-closes after a capture, and a shortcut to open the latest capture in the editor (Shotbase 1.5.0).

**Acceptance:** a long web page and a long chat window stitch without visible seams in manual mode. GIFs under a stated size cap look acceptable.

Each clean-capture option can be switched off, and capture latency and idle memory have a measured target (Section 7).

### Phase 6 — Multi-clip projects (M–L)

Scoped multi-scene editing, not a general video editor.

- Import video clips and images into a project as scenes. Reorder, trim and set a duration for images.
- One shared `LookConfig` across scenes, with per-scene override optional.
- Transitions: cut, crossfade and slide. A simple **title card** (text on a gradient).
- Export the combined project through the same compositor.

**Acceptance:** three clips plus a title card export as one video with transitions and a consistent look.

### Phase 7 — Polish, à la carte (S each)

Completed scope and verification: [STUDIO_PHASE_7.md](STUDIO_PHASE_7.md).
Optional local English captions were included by user choice; multi-camera and
multi-display recording remain deferred.

Pick what time allows; each is independent.

- Motion presets: 6–8 easing and entrance styles for zoom and title cards.
- Slow-drifting animated gradient background (cheap, applied at export).
- Webcam layouts: overlay, side-by-side, camera-only, plus shape options.
- Auto speed-up of typing and idle stretches (uses key events).
- Local captions with a downloadable speech model (optional download, off by default).
- Speaker notes window hidden from recordings.
- Verify and add if missing: countdown, pause/resume, restart, click sounds.

* Auto-trim silent stretches of a recording while keeping audio in sync (Screenflare).
* Audio cleanup at export: background-noise reduction and volume leveling, which FFmpeg audio filters can do locally (Screenflare).
* Export niceties: an estimated file size before exporting, and copying the finished video to the clipboard (Screenflare).
* Crop the recording to a sub-area inside the editor (Screenflare).
* A command palette (Ctrl+K) for editor actions, and undo steps that say what they undid (Screenflare).
* Animated text and shapes for title cards (Screen.movie).
* Editing captions as text, where deleting a caption line deletes that span of video; only if captions are built (Screenflare).
* Multi-camera recording with each camera as its own track (Screen.movie). Large and optional.
* Recording several windows or displays at once with switchable focus in the editor (Screenflare). Large and optional; leave for last.

## 6. Explicit non-goals

- **Replay buffer** ("save the last 30 seconds").
- Cloud links, comments, view analytics and accounts.
- AI voiceover or avatars, 3D device mockups, multi-scene timelines beyond Phase 6.
- Webpage capture at custom breakpoints (needs a headless browser).
- AI agent/CLI integrations.

* Capture reminders (Shotbase) and object removal (Shottr).
* Shotbase's 'animated screenshots' and 3D transforms; its site does not say what they do.

## 7. Cross-cutting rules

- **Backward compatibility:** existing screenshots, recordings and settings must open unchanged. Migrate project files with a version field.
- **Performance:** keep preview responsive at 1080p. Heavy work (export, stitching, OCR) goes off the UI thread with progress and cancel.
- **Privacy:** everything stays on-device. Any optional model download is opt-in and explained in the UI.
- **UI discipline:** new controls go inside existing panels where possible. If the UI starts to feel crowded, hide advanced options behind an "Advanced" fold instead of adding top-level buttons.
- **Testing:** unit-test pure logic (zoom generation, mask math, stitch offset, PII detectors, schema migration). For visual output, add a small set of golden-frame checks.

* **Performance target:** measure capture latency and idle memory against WinShot X's published numbers (114 ms and 33 MB, its own measurements on one machine) and set a target before Phase 5 ships.

## 8. Open questions for a human

1. Compositor choice after the Phase 1.1 spike (FFmpeg graph vs Rust frame pipeline).
2. Whether Studio mode becomes the default recorder mode once it is stable.
3. Whether to ship auto-scroll or stay manual-only for scrolling screenshots.
4. Whether captions (a model download) belong in the product at all.

5) Whether installer size matters enough to explore Windows hardware video encoding for plain recording. WinShot X ships a 2.55 MB installer without FFmpeg, while Glint bundles FFmpeg, which the compositor would still need.

## 9. Sources behind this plan

CleanShot X 5.0 release notes and coverage; Screen Studio's site (v4.0); Cap's documentation and 0.5.7 release notes; Shotbase, WindowShot, WinShot X, Screenflare and Screen.movie product pages and listings (Shotbase was read directly from shotbase.com and its changelog in round 3; round 1 used third-party listings because shotbase.app blocked automated access); ShotsGlow's own site and Microsoft Store listing. These are the vendors' own descriptions, so treat feature claims as claims, not tested behavior.

Round 2 and 3 sources, checked October 10, 2026: [CleanShot X changelog](https://cleanshot.com/changelog), [Shotbase](https://shotbase.com/) and [its changelog](https://shotbase.com/changelog), [WinShot X](https://winshotx.com/en/), [WindowShot](https://www.windowshot.app/), [Screen.movie](https://screen.movie/) and [its updates](https://screen.movie/updates), [Screenflare](https://screenflare.app/), [Screen Studio](https://screen.studio/) and [Cap](https://cap.so/llms-full.txt). These are the vendors' own descriptions, so treat feature claims as claims, not tested behavior.

## Appendix A — Corrections log

- Round 2 dated the countdown, pause and restart options to CleanShot 5.0. The changelog excerpt mixed several versions, so that dating was removed from Section 3.
- Round 2 said no material changes were found for Shotbase, ShotsGlow, WindowShot, WinShot X, Screenflare and Screen.movie without re-checking them. Round 3 re-read Shotbase, WinShot X, WindowShot, Screen.movie and Screenflare (Section 3A). macshot and Shottr were not re-checked. ShotsGlow was re-checked on October 10 and does exist: shotsglow.com and a Microsoft Store listing, by MXF Labs.
- Round 1 described WinShot X only by its replay ring, GIF and MP4 export and magnifier. It is a free, open-source Windows app whose zoom is decided after recording from saved click data, which supports the sidecar design in Section 4.
- Round 1 said Shotbase's site blocked automated access. shotbase.com, a different domain from shotbase.app, was readable in round 3.

## Appendix B — What each app does, and where it feeds the plan

**CleanShot X (Mac)** — Studio Mode in 5.0: smart zooms, trimming, cursor smoothing, motion blur, video backgrounds, post-recording cursor, keystroke and camera controls, landscape, square and vertical export (Phases 1–2). Screenshots: Background tool with 20 built-in backgrounds, your own images, presets and Auto Balance; combine images; pixelate randomization and secure blur; editable project file; scrolling capture (Phases 3–4).

**Screen Studio (Mac, 4.0)** — records without the cursor and redraws it from event data (the Section 4 decision); classic and loupe zoom; auto and manual zoom; cursor smoothing, hide when idle, loop cursor; motion blur; aspect switching that re-aims zooms; masks for sensitive data and a highlight dim; camera layouts; backgrounds and presets; GIF export; show shortcuts; click sounds; speaker notes; countdown, pause and crash recovery; transcript editing and captions.

**Cap (Windows and Mac, open source, Tauri/Rust)** — separate screen, cursor and key tracks; click-based zoom segments; keyframed masks; gradient and image backgrounds; aspect ratios; 0.25–3× speed; a WGPU compositor; 0.5.7 added transitions in playback and export and a script window hidden from recordings.

**Screenflare (Mac)** — auto-zoom on clicks, cursor smoothing, backdrops, blur that stays on content through zooms, silence trimming, one-click captions, webcam bubble editable after recording, on-screen shortcuts, preset looks, MP4, GIF and clipboard export; stills get the same backdrops, blur, pixelate and spotlight, plus on-device text capture.

**Screen.movie (Mac, $39 one-time, v1.3 on Oct 5, 2026)** — auto zoom that follows the cursor with keyframes and zoom ease presets; 40+ motion presets; animated shader backgrounds; 3D device mockups; cinematic focus, blur and bokeh; custom shadow colors; motion blur; cursor size and click-size control; a multi-scene timeline with copy and paste of styles; up to two cameras as separate tracks; hide desktop icons and notifications while recording; a notch toolbar; animated text and shapes; a GPU export engine; AI voiceover, music and sound effects as a paid add-on; cloud share links. Feeds Phases 1–3, 6 and 7. The 3D mockups, multi-camera, AI audio and cloud sharing are out of scope.

**WindowShot (Windows, $9 early-bird, $29 regular, one-time, up to 2 devices)** — auto zoom from recorded clicks with an adjustable amount and editable zoom points; smooth cursor; backgrounds; camera layouts beside, above or below, plus Vertical Focus for Shorts, Reels and TikTok; aspect ratios; webcam, mic and system audio; MP4 export only. Screenshot tool: backgrounds, crop, annotate, blur, padding, rounded corners and shadow. A Windows-first rival that confirms zoom, cursor, backgrounds and aspect as the expected set.

**WinShot X (Windows, free, MIT open source, by Mun1to)** — 2.55 MB installer with no FFmpeg (Windows writes the video in hardware); selection painted in 114 ms and 33 MB of memory while capturing, by its own measurements against the Snipping Tool. Capture: 6x magnifier with hex color, window snapping and one-click window capture, number-key monitor select, 3 or 5 second timer, hide desktop icons, numbered steps, mosaic, text extraction. Recording: GIF and MP4 at 15, 30 or 60 fps, system audio plus mic, zoom on every click decided after recording from saved click data, A to B trim, export speed 0.5x, 2x or 4x, copy file path, paste a GIF or video as a file. The replay ring (last 15, 30 or 60 seconds) is deliberately not planned. Blur is manual only.

**Shotbase (Mac, $13 a month billed yearly or $25 monthly; 1.5.0 on Sept 24, 2026)** — screenshots, scrolling capture, webpage capture (out of scope), automatic zooms and 3D motion editing in one editor, backgrounds, frames, borders, shadows, watermarks, 'perfect padding', social presets and annotations; optional local AI (Apple silicon) that names, tags and summarizes captures; text extraction, smart search, capture tray history, capture reminders and share links. 1.5.0 added local model choice, Quick Access auto-close, Option-Command-O to open the latest capture in the editor, styled recordings by default and steadier motion framing. 1.4.0 added dropping images into the editor to annotate. 1.3.3 fixed lost video crops and cursor alignment. Feeds Phases 1–4. Its 'animated screenshots' item is unclear from the site.

**ShotsGlow (Windows)** — designed backdrops, blur that survives a crop, on-device background removal, 30 social and App Store export sizes. Checked October 10 on shotsglow.com and its Microsoft Store listing: 150+ gradient backdrops, curved and tapered arrows, redaction that survives a later crop, on-device background removal, $9 one-time, by MXF Labs. A browser-only tool called ShotGlow (shotglow.app) is unrelated.

**macshot and Shottr (Mac)** — auto-redact of personal data, composing multiple captures, paste-as-layer, scrolling capture, backdrops, OCR, expandable canvas and side-by-side layouts.
