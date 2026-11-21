//! Studio (Trim) projects for agents: read and edit `project.json` with the same
//! model the Trim window uses (src/recorder/studioModel.ts). Every edit batch is
//! applied to a copy, validated by the native exporter's own checks
//! (`studio_render::Project::segments`, mask bounds), and written once,
//! atomically — or not at all. All times are seconds of the *source* video.
use crate::recorder::{studio, studio_masks, studio_render};
use rmcp::schemars;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Deserialize, schemars::JsonSchema)]
pub struct Keyframe {
    /// Source time in seconds.
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
pub struct CaptionLine {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EffectList {
    Zooms,
    Masks,
    Annotations,
    Captions,
}

/// One change to a Studio project. Times are source-video seconds; zoom focus and
/// annotation points are 0–1 fractions of the frame; mask rectangles are source pixels.
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum VideoEdit {
    /// Remove footage in [start, end).
    Cut { start: f64, end: f64 },
    /// Bring back previously removed footage in [start, end).
    Restore { start: f64, end: f64 },
    /// Play [start, end) at `speed` (0.5–2).
    SetSpeed { start: f64, end: f64, speed: f64 },
    /// Play the kept clips in this order (every kept clip id from video_read, once).
    Reorder { clip_ids: Vec<i64> },
    /// Undo every cut, speed change and reorder.
    ResetTimeline,
    /// Zoom in on a point (or follow the cursor) for [start, end).
    AddZoom {
        start: f64,
        end: f64,
        /// 1.2–3 (default 2).
        scale: Option<f64>,
        /// Focus point as 0–1 fractions of the frame (default centre).
        focus: Option<Point>,
        /// Track the recorded cursor instead of a fixed point.
        follow_cursor: Option<bool>,
        /// gentle (default), snappy, slow, linear, smooth, accelerate, decelerate, exponential.
        ease: Option<String>,
        /// Seconds to ease in / out, 0–2 (default 0.4).
        ease_in: Option<f64>,
        ease_out: Option<f64>,
    },
    /// Add Glint's automatic zooms on clusters of recorded clicks (keeps manual zooms).
    AutoZooms,
    /// Hide or highlight a region: blur (default), pixelate, solid, or highlight (dims the rest).
    AddMask {
        start: f64,
        end: f64,
        #[serde(rename = "type")]
        mask_type: Option<String>,
        /// Region in source pixels. Ignored when `keyframes` is given.
        x: Option<f64>,
        y: Option<f64>,
        w: Option<f64>,
        h: Option<f64>,
        /// A moving region: the rectangle at several source times.
        keyframes: Option<Vec<Keyframe>>,
        /// 8–80 (default 28).
        strength: Option<f64>,
        /// Fill for "solid" (default "#161a20").
        color: Option<String>,
        /// 0–1.
        opacity: Option<f64>,
        /// Blur everything outside the region instead.
        blur_outside: Option<bool>,
    },
    /// Draw on the video for [start, end): pen, highlight, arrow, rectangle, ellipse or text.
    AddAnnotation {
        kind: String,
        start: f64,
        end: f64,
        /// 0–1 frame fractions. Arrow/rectangle/ellipse: two points (from, to); text: one point.
        points: Vec<Point>,
        /// Default "#ef5555".
        color: Option<String>,
        /// Line width as a fraction of the frame, 0.001–0.04 (default 0.006).
        width: Option<f64>,
        /// Text size as a fraction of the frame, 0.01–0.2 (default 0.05).
        size: Option<f64>,
        text: Option<String>,
    },
    /// Add one caption line (also turns captions on).
    AddCaption { start: f64, end: f64, text: String },
    /// Replace all caption lines (also turns captions on).
    SetCaptions { captions: Vec<CaptionLine> },
    /// Show or hide captions in the export.
    SetCaptionsEnabled { enabled: bool },
    /// Change fields of a zoom, mask, annotation or caption by id (camelCase keys as in video_read).
    Update { id: String, patch: Map<String, Value> },
    /// Delete a zoom, mask, annotation or caption by id.
    Remove { id: String },
    /// Delete every item in one list.
    Clear { list: EffectList },
    /// Background/frame ("Look"): merged into the current look. Same keys as the image
    /// editor's frame: enabled, background {type: gradient|solid|image|transparent, …},
    /// padding, radius, shadow, aspect, chrome, inset, watermark.
    SetLook { look: Map<String, Value> },
    /// Cursor: visible, size, style (arrow|dot), smoothing 0–1, hideIdle, idleSeconds,
    /// clicks, clickSize, keystrokes, spotlight. Merged.
    SetCursor { cursor: Map<String, Value> },
    /// Crop the source (pixels), or null to remove.
    SetCrop { crop: Option<Keyframe> },
    /// Fade in/out seconds, 0–2.
    SetFades { fade_in: Option<f64>, fade_out: Option<f64> },
    /// Webcam bubble (recordings with a camera): x, y, diameter (0.06–0.6), visible,
    /// shape (circle|rounded|square|rect), layout (overlay|side-by-side|camera-only). Merged.
    SetWebcam { webcam: Map<String, Value> },
    /// Motion blur on zoom/pan moves; intensity 0–1.
    SetMotionBlur { enabled: bool, intensity: Option<f64> },
    /// Audio clean-up: noise reduction, level loudness, remove click sounds.
    SetAudioCleanup { denoise: Option<bool>, level: Option<bool>, click_sounds: Option<bool> },
    /// How the video enters: none, fade, left, right, up, down, zoom-in, zoom-out; seconds 0.05–2.
    SetEntrance { style: String, seconds: Option<f64> },
}

pub struct Project {
    pub folder: PathBuf,
    pub project: Value,
    pub events: Value,
}

pub fn load(video: &Path) -> Result<Project, String> {
    let path = video.to_string_lossy();
    let folder = studio::project_folder(&path).ok_or("This video isn't a Studio project yet. Call video_open first.")?;
    let read = |name: &str| -> Result<Value, String> {
        serde_json::from_slice(&std::fs::read(folder.join(name)).map_err(|e| format!("Couldn't read {name}: {e}"))?)
            .map_err(|e| format!("{name} is damaged: {e}"))
    };
    Ok(Project { project: read("project.json")?, events: read("events.json").unwrap_or(json!({"events": []})), folder })
}

/// The source footprint, from the probe Glint returned.
#[derive(Debug, Clone, Copy)]
pub struct Source {
    pub duration: f64,
    pub width: f64,
    pub height: f64,
}

fn round3(v: f64) -> f64 {
    (v * 1000.).round() / 1000.
}

fn clips(project: &Value) -> Vec<Value> {
    project["clips"].as_array().cloned().unwrap_or_default()
}

fn f(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.)
}

/// Seconds of output the timeline produces.
pub fn output_duration(project: &Value) -> f64 {
    clips(project)
        .iter()
        .filter(|c| c["kept"] == true)
        .map(|c| (f(c, "end") - f(c, "start")) / f(c, "speed").max(0.5))
        .sum()
}

/// Agent-friendly view: everything, minus heavy raster caches.
pub fn summary(project: &Project, video: &Path) -> Value {
    let mut p = project.project.clone();
    for list in ["captions", "annotations"] {
        if let Some(items) = p.get_mut(list).and_then(Value::as_array_mut) {
            for item in items {
                if let Some(o) = item.as_object_mut() {
                    o.remove("raster");
                }
            }
        }
    }
    let mut ordered = clips(&p);
    ordered.sort_by(|a, b| f(a, "order").total_cmp(&f(b, "order")));
    let events = project.events["events"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    json!({
        "path": video.to_string_lossy(),
        "studio_project": project.folder.to_string_lossy(),
        "output_seconds": round3(output_duration(&p)),
        "timeline": ordered,
        "zooms": p["zoomSegments"],
        "masks": p["masks"],
        "annotations": p.get("annotations").cloned().unwrap_or(json!([])),
        "captions": p.get("captions").cloned().unwrap_or(json!([])),
        "captions_enabled": p.get("captionsEnabled").cloned().unwrap_or(json!(false)),
        "look": p["look"],
        "cursor": p["cursor"],
        "crop": p["crop"],
        "fades": {"in": p["fadeIn"], "out": p["fadeOut"]},
        "webcam": p["cam"],
        "motion_blur": p.get("motionBlur").cloned().unwrap_or(Value::Null),
        "audio_cleanup": p.get("audioCleanup").cloned().unwrap_or(Value::Null),
        "entrance": {"style": p.get("contentMotion").cloned().unwrap_or(json!("none")), "seconds": p.get("contentMotionSeconds").cloned().unwrap_or(Value::Null)},
        "recorded_input": {
            "clicks": events.iter().filter(|e| e["kind"] == "click").count(),
            "keystrokes": events.iter().filter(|e| e["kind"] == "key").count(),
        },
    })
}

fn effect_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("mcp-{:x}-{}", nanos & 0xffff_ffff_ffff, NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Port of `editSpans` (studioPolish.ts), generalized: split the clips `affects`
/// selects at the span edges and apply `change` to the pieces inside a span.
fn split_spans(clips: &[Value], spans: &[(f64, f64)], affects: impl Fn(&Value) -> bool, change: impl Fn(&mut Value)) -> Vec<Value> {
    if spans.is_empty() {
        return clips.to_vec();
    }
    let mut next_id = clips.iter().filter_map(|c| c["id"].as_i64()).max().unwrap_or(0) + 1;
    let mut by_order: Vec<&Value> = clips.iter().collect();
    by_order.sort_by(|a, b| f(a, "order").total_cmp(&f(b, "order")));
    let rank = |c: &Value| by_order.iter().position(|o| o["id"] == c["id"]).unwrap_or(0) as f64;
    let mut out = Vec::new();
    for c in clips {
        let (start, end) = (f(c, "start"), f(c, "end"));
        if !affects(c) {
            let mut c = c.clone();
            c["order"] = json!(rank(&c));
            out.push(c);
            continue;
        }
        let mut edges = vec![start, end];
        for &(s, e) in spans {
            edges.push(s.max(start));
            edges.push(e.min(end));
        }
        edges.retain(|t| *t >= start && *t <= end);
        edges.sort_by(f64::total_cmp);
        edges.dedup();
        let pieces = edges.len() + 1;
        for (i, pair) in edges.windows(2).enumerate() {
            let (a, b) = (pair[0], pair[1]);
            if b - a < 1e-7 {
                continue;
            }
            let mid = (a + b) / 2.;
            let mut piece = c.clone();
            piece["id"] = json!(next_id);
            next_id += 1;
            piece["start"] = json!(a);
            piece["end"] = json!(b);
            piece["order"] = json!(rank(c) + i as f64 / pieces as f64);
            if spans.iter().any(|&(s, e)| mid >= s && mid < e) {
                change(&mut piece);
            }
            out.push(piece);
        }
    }
    out
}

/// Port of `regenerateZooms` (studioAutoZoom.ts): zoom on clusters of clicks.
fn auto_zooms(existing: &[Value], events: &Value, duration: f64) -> Vec<Value> {
    let g = &events["geometry"];
    let (gx, gy, gw, gh) = (f(g, "x"), f(g, "y"), f(g, "width").max(1.), f(g, "height").max(1.));
    let point = |e: &Value| (( f(e, "x") - gx) / gw, (f(e, "y") - gy) / gh);
    let dist = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).hypot(a.1 - b.1);
    let all = events["events"].as_array().cloned().unwrap_or_default();
    let mut clicks: Vec<(f64, f64, f64)> = all
        .iter()
        .filter(|e| e["kind"] == "click" && e["x"].is_number() && e["y"].is_number() && f(e, "t") >= 0. && f(e, "t") < duration)
        .map(|e| {
            let (x, y) = point(e);
            (x, y, f(e, "t"))
        })
        .filter(|p| (0.0..=1.0).contains(&p.0) && (0.0..=1.0).contains(&p.1))
        .collect();
    clicks.sort_by(|a, b| a.2.total_cmp(&b.2));
    let mut clusters: Vec<Vec<(f64, f64, f64)>> = Vec::new();
    for c in clicks {
        let join = clusters.last().is_some_and(|g| {
            let (first, last) = (g[0], g[g.len() - 1]);
            !(c.2 - last.2 > 0.9 || dist((c.0, c.1), (first.0, first.1)) > 0.12 || c.2 - first.2 > 5.)
        });
        if join {
            clusters.last_mut().unwrap().push(c);
        } else {
            clusters.push(vec![c]);
        }
    }
    let preserved: Vec<Value> = existing.iter().filter(|s| s["origin"] != "auto" || s["edited"] == true).cloned().collect();
    let mut generated: Vec<Value> = Vec::new();
    for cluster in clusters.iter().filter(|c| c.len() >= 2) {
        if generated.len() >= 512usize.saturating_sub(preserved.len()) {
            break;
        }
        let (first, last) = (cluster[0], cluster[cluster.len() - 1]);
        let n = cluster.len() as f64;
        let focus = (cluster.iter().map(|c| c.0).sum::<f64>() / n, cluster.iter().map(|c| c.1).sum::<f64>() / n);
        let prior_end = generated.last().map(|z| f(z, "end") + 0.8).unwrap_or(0.);
        let start = 0f64.max(first.2 - 0.3).max(prior_end);
        let mut end = duration.min(last.2 + 1.2).min(start + 6.);
        let mut escapes: Vec<&Value> = all
            .iter()
            .filter(|e| e["kind"] == "cursor" && f(e, "t") > last.2 && f(e, "t") < end && e["x"].is_number() && e["y"].is_number())
            .collect();
        escapes.sort_by(|a, b| f(a, "t").total_cmp(&f(b, "t")));
        if let Some(escape) = escapes.into_iter().find(|e| dist(point(e), focus) > 0.3) {
            end = end.min(f(escape, "t") + 0.35);
        }
        if end - start < 0.7 || preserved.iter().any(|s| start < f(s, "end") + 0.8 && end > f(s, "start") - 0.8) {
            continue;
        }
        generated.push(json!({
            "id": format!("auto-{:.6}", first.2), "start": start, "end": end, "scale": 2, "mode": "fixed",
            "focus": {"x": focus.0.clamp(0., 1.), "y": focus.1.clamp(0., 1.)},
            "ease": "gentle", "easeIn": 0.4, "easeOut": 0.4, "origin": "auto", "edited": false,
        }));
    }
    let mut out = [preserved, generated].concat();
    out.sort_by(|a, b| f(a, "start").total_cmp(&f(b, "start")));
    out
}

/// Port of `activitySpans` (studioPolish.ts): idle stretches and bursts of typing.
pub fn activity_spans(events: &Value, duration: f64, typing: bool) -> Vec<(f64, f64)> {
    let mut activity: Vec<&Value> = events["events"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    activity.retain(|e| {
        let t = f(e, "t");
        t.is_finite() && t >= 0. && t <= duration && matches!(e["kind"].as_str(), Some("key" | "click" | "cursor"))
    });
    activity.sort_by(|a, b| f(a, "t").total_cmp(&f(b, "t")));
    let mut last: Option<(f64, f64)> = None;
    activity.retain(|e| {
        if e["kind"] != "cursor" {
            return true;
        }
        if !e["x"].is_number() || !e["y"].is_number() {
            return false;
        }
        let p = (f(e, "x"), f(e, "y"));
        let moved = last.is_none_or(|q| (p.0 - q.0).hypot(p.1 - q.1) >= 2.);
        if moved {
            last = Some(p);
        }
        moved
    });
    let mut out = Vec::new();
    if !typing {
        if activity.is_empty() {
            return out;
        }
        let times: Vec<f64> = std::iter::once(0.).chain(activity.iter().map(|e| f(e, "t"))).chain(std::iter::once(duration)).collect();
        for w in times.windows(2) {
            if w[1] - w[0] > 3. {
                out.push((round3(w[0] + 0.75), round3(w[1] - 0.75)));
            }
        }
        return out;
    }
    let keys: Vec<f64> = activity
        .iter()
        .filter(|e| e["kind"] == "key" && e["down"] != false && e["isModifier"] != true)
        .map(|e| f(e, "t"))
        .collect();
    let mut start = 0;
    for i in 0..keys.len() {
        if i == keys.len() - 1 || keys[i + 1] - keys[i] > 1.2 {
            if i >= start + 4 && keys[i] - keys[start] >= 1. {
                out.push((round3((keys[start] - 0.15).max(0.)), round3((keys[i] + 0.35).min(duration))));
            }
            start = i + 1;
        }
    }
    out
}

fn span(start: f64, end: f64, source: Source) -> Result<(f64, f64), String> {
    if !start.is_finite() || !end.is_finite() || start < 0. || end <= start || start >= source.duration {
        return Err(format!("{start}–{end}s isn't a span of this {:.2}s video.", source.duration));
    }
    Ok((start, end.min(source.duration)))
}

fn merge(target: &mut Value, patch: &Map<String, Value>) {
    if !target.is_object() {
        *target = json!({});
    }
    let object = target.as_object_mut().unwrap();
    for (key, value) in patch {
        match (object.get_mut(key), value) {
            (Some(existing @ Value::Object(_)), Value::Object(inner)) => merge(existing, inner),
            _ => {
                object.insert(key.clone(), value.clone());
            }
        }
    }
}

const LISTS: [&str; 4] = ["zoomSegments", "masks", "annotations", "captions"];

fn list<'a>(project: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !project[key].is_array() {
        project[key] = json!([]);
    }
    project[key].as_array_mut().unwrap()
}

fn find_item<'a>(project: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    let key = LISTS.into_iter().find(|key| project[*key].as_array().is_some_and(|a| a.iter().any(|v| v["id"] == id)))?;
    project[key].as_array_mut()?.iter_mut().find(|v| v["id"] == id)
}

fn apply(project: &mut Value, events: &Value, edit: &VideoEdit, source: Source, added: &mut Vec<String>) -> Result<(), String> {
    match edit {
        VideoEdit::Cut { start, end } => {
            let s = span(*start, *end, source)?;
            project["clips"] = json!(split_spans(&clips(project), &[s], |c| c["kept"] == true, |p| p["kept"] = json!(false)));
        }
        VideoEdit::Restore { start, end } => {
            let s = span(*start, *end, source)?;
            project["clips"] = json!(split_spans(&clips(project), &[s], |c| c["kept"] != true, |p| p["kept"] = json!(true)));
        }
        VideoEdit::SetSpeed { start, end, speed } => {
            if !(0.5..=2.).contains(speed) {
                return Err("Speed must be 0.5–2.".into());
            }
            let s = span(*start, *end, source)?;
            project["clips"] = json!(split_spans(&clips(project), &[s], |c| c["kept"] == true, |p| p["speed"] = json!(speed)));
        }
        VideoEdit::Reorder { clip_ids } => {
            let mut all = clips(project);
            let mut kept: Vec<i64> = all.iter().filter(|c| c["kept"] == true).filter_map(|c| c["id"].as_i64()).collect();
            let mut given = clip_ids.clone();
            kept.sort();
            given.sort();
            if kept != given {
                return Err(format!("List every kept clip id exactly once: {kept:?}."));
            }
            let removed_base = clip_ids.len() as f64;
            for c in all.iter_mut() {
                let id = c["id"].as_i64().unwrap_or(-1);
                c["order"] = json!(match clip_ids.iter().position(|i| *i == id) {
                    Some(i) => i as f64,
                    None => removed_base + f(c, "order"),
                });
            }
            project["clips"] = json!(all);
        }
        VideoEdit::ResetTimeline => {
            project["clips"] = json!([{"id": 1, "start": 0.0, "end": source.duration, "kept": true, "speed": 1.0, "order": 0}]);
        }
        VideoEdit::AddZoom { start, end, scale, focus, follow_cursor, ease, ease_in, ease_out } => {
            let (start, end) = span(*start, *end, source)?;
            let id = effect_id();
            let focus = focus.unwrap_or(Point { x: 0.5, y: 0.5 });
            list(project, "zoomSegments").push(json!({
                "id": id, "start": start, "end": end, "scale": scale.unwrap_or(2.),
                "mode": if follow_cursor.unwrap_or(false) { "follow-cursor" } else { "fixed" },
                "focus": {"x": focus.x, "y": focus.y}, "ease": ease.clone().unwrap_or_else(|| "gentle".into()),
                "easeIn": ease_in.unwrap_or(0.4), "easeOut": ease_out.unwrap_or(0.4), "origin": "manual", "edited": true,
            }));
            added.push(id);
        }
        VideoEdit::AutoZooms => {
            let before: Vec<String> = project["zoomSegments"].as_array().map(|a| a.iter().filter_map(|z| z["id"].as_str().map(str::to_string)).collect()).unwrap_or_default();
            let zooms = auto_zooms(project["zoomSegments"].as_array().map(Vec::as_slice).unwrap_or(&[]), events, source.duration);
            added.extend(zooms.iter().filter_map(|z| z["id"].as_str()).filter(|id| !before.iter().any(|b| b == id)).map(str::to_string));
            project["zoomSegments"] = json!(zooms);
        }
        VideoEdit::AddMask { start, end, mask_type, x, y, w, h, keyframes, strength, color, opacity, blur_outside } => {
            let (start, end) = span(*start, *end, source)?;
            let keyframes: Vec<Value> = match keyframes {
                Some(k) if !k.is_empty() => k.iter().map(|k| json!({"t": round3(k.t), "x": k.x, "y": k.y, "w": k.w, "h": k.h})).collect(),
                _ => match (x, y, w, h) {
                    (Some(x), Some(y), Some(w), Some(h)) => vec![json!({"t": round3(start), "x": x, "y": y, "w": w, "h": h})],
                    _ => return Err("A mask needs x, y, w, h (source pixels) or keyframes.".into()),
                },
            };
            let id = effect_id();
            let mut mask = json!({
                "id": id, "start": start, "end": end, "type": mask_type.clone().unwrap_or_else(|| "blur".into()),
                "keyframes": keyframes, "strength": strength.unwrap_or(28.), "color": color.clone().unwrap_or_else(|| "#161a20".into()),
            });
            if let Some(o) = opacity {
                mask["opacity"] = json!(o);
            }
            if let Some(b) = blur_outside {
                mask["blurOutside"] = json!(b);
            }
            list(project, "masks").push(mask);
            added.push(id);
        }
        VideoEdit::AddAnnotation { kind, start, end, points, color, width, size, text } => {
            let (start, end) = span(*start, *end, source)?;
            let id = effect_id();
            let default_text = if kind == "text" { "Text" } else { "" };
            list(project, "annotations").push(json!({
                "id": id, "kind": kind, "start": start, "end": end,
                "points": points.iter().map(|p| json!({"x": p.x, "y": p.y})).collect::<Vec<_>>(),
                "color": color.clone().unwrap_or_else(|| "#ef5555".into()), "width": width.unwrap_or(0.006),
                "text": text.clone().unwrap_or_else(|| default_text.into()), "size": size.unwrap_or(0.05),
            }));
            added.push(id);
        }
        VideoEdit::AddCaption { start, end, text } => {
            let (start, end) = span(*start, *end, source)?;
            let id = effect_id();
            list(project, "captions").push(json!({"id": id, "start": start, "end": end, "text": text}));
            list(project, "captions").sort_by(|a, b| f(a, "start").total_cmp(&f(b, "start")));
            project["captionsEnabled"] = json!(true);
            added.push(id);
        }
        VideoEdit::SetCaptions { captions } => {
            let mut lines = Vec::new();
            for c in captions {
                let (start, end) = span(c.start, c.end, source)?;
                let id = effect_id();
                lines.push(json!({"id": id, "start": start, "end": end, "text": c.text}));
                added.push(id);
            }
            lines.sort_by(|a, b| f(a, "start").total_cmp(&f(b, "start")));
            project["captions"] = json!(lines);
            project["captionsEnabled"] = json!(true);
        }
        VideoEdit::SetCaptionsEnabled { enabled } => project["captionsEnabled"] = json!(enabled),
        VideoEdit::Update { id, patch } => {
            if patch.contains_key("id") {
                return Err("An item's id can't be changed.".into());
            }
            let item = find_item(project, id).ok_or_else(|| format!("There's no zoom, mask, annotation or caption with id {id}."))?;
            merge(item, patch);
            if let Some(o) = item.as_object_mut() {
                o.remove("raster");
                if o.contains_key("origin") {
                    o.insert("edited".into(), json!(true));
                }
            }
        }
        VideoEdit::Remove { id } => {
            let key = LISTS
                .into_iter()
                .find(|key| project[*key].as_array().is_some_and(|a| a.iter().any(|v| v["id"] == id.as_str())))
                .ok_or_else(|| format!("There's no zoom, mask, annotation or caption with id {id}."))?;
            list(project, key).retain(|v| v["id"] != id.as_str());
        }
        VideoEdit::Clear { list: which } => {
            let key = match which {
                EffectList::Zooms => "zoomSegments",
                EffectList::Masks => "masks",
                EffectList::Annotations => "annotations",
                EffectList::Captions => "captions",
            };
            project[key] = json!([]);
        }
        VideoEdit::SetLook { look } => merge(&mut project["look"], look),
        VideoEdit::SetCursor { cursor } => merge(&mut project["cursor"], cursor),
        VideoEdit::SetCrop { crop } => {
            project["crop"] = match crop {
                None => Value::Null,
                Some(c) => {
                    let x = c.x.clamp(0., source.width - 2.).round();
                    let y = c.y.clamp(0., source.height - 2.).round();
                    json!({"x": x, "y": y, "w": c.w.clamp(2., source.width - x).round(), "h": c.h.clamp(2., source.height - y).round()})
                }
            }
        }
        VideoEdit::SetFades { fade_in, fade_out } => {
            if let Some(v) = fade_in {
                project["fadeIn"] = json!(v);
            }
            if let Some(v) = fade_out {
                project["fadeOut"] = json!(v);
            }
        }
        VideoEdit::SetWebcam { webcam } => {
            if project["cam"].is_null() {
                project["cam"] = json!({"x": 0.78, "y": 0.72, "diameter": 0.18, "visible": true, "shape": "circle"});
            }
            merge(&mut project["cam"], webcam);
        }
        VideoEdit::SetMotionBlur { enabled, intensity } => {
            project["motionBlur"] = json!({"enabled": enabled, "intensity": intensity.unwrap_or(0.35)});
        }
        VideoEdit::SetAudioCleanup { denoise, level, click_sounds } => {
            let current = project.get("audioCleanup").cloned().unwrap_or(json!({}));
            let pick = |v: &Option<bool>, key: &str| v.unwrap_or(current[key].as_bool().unwrap_or(false));
            project["audioCleanup"] = json!({"denoise": pick(denoise, "denoise"), "level": pick(level, "level"), "clickSounds": pick(click_sounds, "clickSounds")});
        }
        VideoEdit::SetEntrance { style, seconds } => {
            project["contentMotion"] = json!(style);
            if let Some(s) = seconds {
                project["contentMotionSeconds"] = json!(s);
            }
        }
    }
    Ok(())
}

/// Checks the Trim window and the native exporter both enforce, so an edited
/// project always opens in Glint and always exports.
pub fn validate(project: &Value, source: Source) -> Result<(), String> {
    let clips = clips(project);
    let mut ids = std::collections::HashSet::new();
    for c in &clips {
        let id = c["id"].as_i64().filter(|id| *id >= 1).ok_or("Clip ids must be positive integers.")?;
        if !ids.insert(id) || !c["kept"].is_boolean() {
            return Err("The timeline is invalid.".into());
        }
    }
    if !clips.iter().any(|c| c["kept"] == true) {
        return Err("That would remove the whole video; keep at least one part.".into());
    }
    for (key, max) in [("annotations", 64usize), ("captions", 1000)] {
        if project[key].as_array().is_some_and(|a| a.len() > max) {
            return Err(format!("Use at most {max} {key}."));
        }
    }
    if let Some(cam) = project["cam"].as_object() {
        let in_unit = |k: &str| cam.get(k).and_then(Value::as_f64).is_some_and(|v| (0.0..=1.0).contains(&v));
        let shape_ok = cam.get("shape").and_then(Value::as_str).is_some_and(|s| matches!(s, "circle" | "rounded" | "square" | "rect"));
        let layout_ok = cam.get("layout").is_none_or(|l| matches!(l.as_str(), Some("overlay" | "side-by-side" | "camera-only")));
        let d_ok = cam.get("diameter").and_then(Value::as_f64).is_some_and(|d| (0.06..=0.6).contains(&d));
        if !(in_unit("x") && in_unit("y") && shape_ok && layout_ok && d_ok && cam.get("visible").is_some_and(Value::is_boolean)) {
            return Err("Webcam needs x, y in 0–1, diameter 0.06–0.6, visible, shape circle|rounded|square|rect.".into());
        }
    }
    if let Some(m) = project.get("motionBlur").filter(|m| !m.is_null()) {
        if !m["enabled"].is_boolean() || !m["intensity"].as_f64().is_some_and(|i| (0.0..=1.0).contains(&i)) {
            return Err("Motion blur intensity must be 0–1.".into());
        }
    }
    if let Some(crop) = project["crop"].as_object() {
        let v = |k: &str| crop.get(k).and_then(Value::as_f64).unwrap_or(-1.);
        if v("x") < 0. || v("y") < 0. || v("w") < 2. || v("h") < 2. || v("x") + v("w") > source.width + 0.5 || v("y") + v("h") > source.height + 0.5 {
            return Err("The crop must lie inside the video.".into());
        }
    }
    let typed: studio_render::Project = serde_json::from_value(project.clone()).map_err(|e| format!("The project is invalid: {e}"))?;
    typed.segments(source.duration)?;
    studio_masks::validate(&typed.masks, source.duration, source.width, source.height)?;
    Ok(())
}

/// Apply a batch atomically: all edits succeed and are written once, or nothing changes.
pub fn edit(video: &Path, edits: &[VideoEdit], source: Source) -> Result<Value, String> {
    if edits.is_empty() {
        return Err("No edits given.".into());
    }
    let loaded = load(video)?;
    let mut project = loaded.project.clone();
    let mut added = Vec::new();
    for (i, edit) in edits.iter().enumerate() {
        apply(&mut project, &loaded.events, edit, source, &mut added).map_err(|e| format!("Edit {} failed, nothing was changed: {e}", i + 1))?;
    }
    validate(&project, source).map_err(|e| format!("Nothing was changed: {e}"))?;
    studio::write_project(&loaded.folder, &project)?;
    Ok(json!({"added": added, "output_seconds": round3(output_duration(&project))}))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: Source = Source { duration: 10., width: 1280., height: 720. };

    fn project() -> Value {
        let mut p = studio::initial_project(10.);
        p["version"] = json!(2);
        p
    }

    fn run(p: &mut Value, edits: Value) -> Result<Vec<String>, String> {
        let edits: Vec<VideoEdit> = serde_json::from_value(edits).map_err(|e| e.to_string())?;
        let mut added = Vec::new();
        for e in &edits {
            apply(p, &json!({"events": []}), e, SOURCE, &mut added)?;
        }
        validate(p, SOURCE)?;
        Ok(added)
    }

    #[test]
    fn cuts_speed_and_restore_split_the_source_timeline_like_trim() {
        let mut p = project();
        run(&mut p, json!([{"op": "cut", "start": 2, "end": 4}, {"op": "set_speed", "start": 6, "end": 8, "speed": 2}])).unwrap();
        let kept: Vec<(f64, f64, f64)> = clips(&p).iter().filter(|c| c["kept"] == true).map(|c| (f(c, "start"), f(c, "end"), f(c, "speed"))).collect();
        assert_eq!(kept, vec![(0., 2., 1.), (4., 6., 1.), (6., 8., 2.), (8., 10., 1.)]);
        assert!((output_duration(&p) - 7.).abs() < 1e-9);
        run(&mut p, json!([{"op": "restore", "start": 2, "end": 3}])).unwrap();
        assert!((output_duration(&p) - 8.).abs() < 1e-9);
        let ids: std::collections::HashSet<i64> = clips(&p).iter().map(|c| c["id"].as_i64().unwrap()).collect();
        assert_eq!(ids.len(), clips(&p).len(), "clip ids stay unique");
    }

    #[test]
    fn cutting_everything_or_bad_values_is_refused() {
        let mut p = project();
        assert!(run(&mut p, json!([{"op": "cut", "start": 0, "end": 10}])).unwrap_err().contains("whole video"));
        let mut p = project();
        assert!(run(&mut p, json!([{"op": "set_speed", "start": 0, "end": 1, "speed": 4}])).is_err());
        let mut p = project();
        assert!(run(&mut p, json!([{"op": "add_zoom", "start": 1, "end": 3, "scale": 9}])).is_err(), "native zoom validation applies");
        let mut p = project();
        assert!(run(&mut p, json!([{"op": "add_mask", "start": 1, "end": 3, "x": 1200, "y": 10, "w": 200, "h": 50}])).is_err(), "masks must fit the frame");
    }

    #[test]
    fn reorder_requires_every_kept_clip() {
        let mut p = project();
        run(&mut p, json!([{"op": "cut", "start": 4, "end": 5}])).unwrap();
        let kept: Vec<i64> = clips(&p).iter().filter(|c| c["kept"] == true).map(|c| c["id"].as_i64().unwrap()).collect();
        assert!(run(&mut p, json!([{"op": "reorder", "clip_ids": [kept[0]]}])).is_err());
        run(&mut p, json!([{"op": "reorder", "clip_ids": [kept[1], kept[0]]}])).unwrap();
        let mut ordered = clips(&p);
        ordered.retain(|c| c["kept"] == true);
        ordered.sort_by(|a, b| f(a, "order").total_cmp(&f(b, "order")));
        assert_eq!(f(&ordered[0], "start"), 5.);
    }

    #[test]
    fn effects_are_added_updated_and_removed_by_id() {
        let mut p = project();
        let added = run(&mut p, json!([
            {"op": "add_zoom", "start": 1, "end": 3, "focus": {"x": 0.2, "y": 0.3}},
            {"op": "add_mask", "start": 0, "end": 10, "type": "pixelate", "x": 10, "y": 10, "w": 300, "h": 40},
            {"op": "add_annotation", "kind": "arrow", "start": 2, "end": 5, "points": [{"x": 0.1, "y": 0.1}, {"x": 0.4, "y": 0.4}]},
            {"op": "add_caption", "start": 0.5, "end": 2, "text": "Hello"},
            {"op": "set_look", "look": {"background": {"type": "gradient", "gradientId": "dusk"}, "padding": 60}},
            {"op": "set_cursor", "cursor": {"size": 48, "clicks": true}},
            {"op": "set_fades", "fade_in": 0.5, "fade_out": 1},
            {"op": "set_motion_blur", "enabled": true},
            {"op": "set_audio_cleanup", "denoise": true},
            {"op": "set_entrance", "style": "zoom-in", "seconds": 0.8}
        ])).unwrap();
        assert_eq!(added.len(), 4);
        assert_eq!(p["captionsEnabled"], true);
        assert_eq!(p["look"]["padding"], 60);
        run(&mut p, json!([{"op": "update", "id": added[0], "patch": {"scale": 2.5}}, {"op": "remove", "id": added[2]}])).unwrap();
        assert_eq!(p["zoomSegments"][0]["scale"], 2.5);
        assert_eq!(p["annotations"].as_array().unwrap().len(), 0);
        assert!(run(&mut p, json!([{"op": "remove", "id": "missing"}])).is_err());
        run(&mut p, json!([{"op": "clear", "list": "masks"}])).unwrap();
        assert!(p["masks"].as_array().unwrap().is_empty());
    }

    #[test]
    fn auto_zooms_cluster_clicks_and_keep_manual_zooms() {
        let events = json!({"geometry": {"x": 0, "y": 0, "width": 1000, "height": 500}, "events": [
            {"t": 2.0, "kind": "click", "x": 500, "y": 250}, {"t": 2.4, "kind": "click", "x": 510, "y": 255},
            {"t": 7.0, "kind": "click", "x": 100, "y": 100}
        ]});
        let manual = json!({"id": "m", "start": 8.0, "end": 9.0, "origin": "manual", "edited": true});
        let zooms = auto_zooms(&[manual], &events, 10.);
        assert_eq!(zooms.len(), 2, "one cluster of two clicks plus the manual zoom");
        let auto = zooms.iter().find(|z| z["origin"] == "auto").unwrap();
        assert!((f(auto, "start") - 1.7).abs() < 1e-9);
        assert!((auto["focus"]["x"].as_f64().unwrap() - 0.505).abs() < 1e-9);
    }

    #[test]
    fn activity_finds_idle_gaps_and_typing_bursts() {
        let mut events = vec![json!({"t": 0.5, "kind": "click", "x": 1, "y": 1})];
        for i in 0..8 {
            events.push(json!({"t": 6.0 + i as f64 * 0.2, "kind": "key", "down": true}));
        }
        let events = json!({"events": events});
        assert_eq!(activity_spans(&events, 10., false), vec![(1.25, 5.25)], "the 2.6 s tail after the last key is not idle");
        assert_eq!(activity_spans(&events, 10., true), vec![(5.85, 7.75)]);
    }
}
