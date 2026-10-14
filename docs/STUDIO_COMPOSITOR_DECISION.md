# Phase 1.1 compositor decision

Choose **Rust CPU frame composition**, with FFmpeg decoding and encoding. Keep
the implementation small: cached procedural background, soft shadow and rounded
card, row copies for video, then input-event layers. No GPU dependency or assets.

## Measured spike, 2026-10-14

Bundled FFmpeg, generated 60-second 1920x1080/60fps H.264 source with 48kHz AAC
audio. Output is 1920x1080/60fps, with a 1600x900 card, rounded corners and shadow.
Both encode with x264 ultrafast/CRF 21. Run:

```
python scripts/studio-compositor-spike.py
```

- FFmpeg RGBA `geq` corner mask + blurred shadow + overlays: exceeded the
  **120-second timebox**, so it fails the plan's near-real-time threshold.
- Standalone optimized Rust CPU prototype: **28.182 seconds**, about 2.13x real
  time. The background and soft offset shadow are computed once. Card row spans
  avoid per-frame rounded-mask expression evaluation.

Raw results are in `STUDIO_COMPOSITOR_SPIKE.json`. Generated media and the probe
executable remain in the OS temp directory, outside Git. The first unbounded
graph run was stopped; the second run enforced the 120-second limit.

This compares useful prototypes, not perfectly equivalent implementations:
the Rust probe caches a distance-based soft shadow while the graph blurs each
frame. Caching a static FFmpeg plate could improve the graph. It does not resolve
the event-layer/keyframe issue: many cursor samples and arbitrary future zoom or
mask segments would become large nested time expressions or auxiliary streams.
Rust can evaluate arrays of segments and easing functions at each output PTS.

## Boundaries

FFmpeg remains responsible for decode, crop/scale, existing cuts/speed/reorder,
webcam composition, matching audio edits and hardware or x264 encoding. Rust owns
the look and cursor layers. Map output time back to source time before drawing
events; use one edit specification for audio and video. Cache static work and
stream frames with bounded memory. Cancel must stop both subprocesses and leave
the source/project untouched.

Revisit a GPU renderer if the final pipeline misses responsive preview or export
targets. GPU composition, zoom/mask features, and motion blur are outside Phase 1.
