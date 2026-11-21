//! `.glint` editor documents for agents: create from an image, inspect, and edit
//! with the same model the editor uses (src/editor/model.ts). Rendering happens
//! in the running app (control channel → hidden editor stage), so output is
//! identical to the editor's own Export.
use base64::Engine;
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// The gradient catalogue the app ships (single source of truth).
pub const GRADIENTS_JSON: &str = include_str!("../../../src/look/gradients.json");

/// Every style option the editor offers. All optional; omitted fields keep the
/// editor's defaults (red #E5484D, stroke 3, font 24).
#[derive(Debug, Clone, Default, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    /// Stroke / text / pen colour, e.g. "#E5484D".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Line thickness in pixels (default 3). Highlighter strokes draw at 4× this width.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    /// Blur strength for "blur" boxes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur_radius: Option<f64>,
    /// Badge diameter for "step" markers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_size: Option<f64>,
    /// Interior fill for rect/ellipse; omit for none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    /// 0–1, applies to the fill only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_opacity: Option<f64>,
    /// Dashed stroke for line/arrow/rect/ellipse.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashed: Option<bool>,
    /// Arrow: also draw a head at the start point.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrow_start: Option<bool>,
    /// Redact: "solid" block (default) or "pixelate" mosaic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redact_style: Option<RedactStyle>,
    /// Spotlight: bright-region shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<Region>,
    /// Arrow/line bend, −1…1 (0 = straight).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub curve: Option<f64>,
    /// Text look.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_preset: Option<TextPreset>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RedactStyle { Solid, Pixelate }
#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Region { Rect, Ellipse }
#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TextPreset { Plain, Heading, Label, Code }

/// One annotation, in image pixel coordinates (origin top-left of the image).
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum NewAnnotation {
    Arrow { x1: f64, y1: f64, x2: f64, y2: f64, #[serde(default)] style: Style },
    Line { x1: f64, y1: f64, x2: f64, y2: f64, #[serde(default)] style: Style },
    Rect { x: f64, y: f64, w: f64, h: f64, #[serde(default)] style: Style },
    Ellipse { x: f64, y: f64, w: f64, h: f64, #[serde(default)] style: Style },
    /// Blur a region (e.g. to hide details softly).
    Blur { x: f64, y: f64, w: f64, h: f64, #[serde(default)] style: Style },
    /// Redact a region: solid block or pixelate (set style.redactStyle).
    Redact { x: f64, y: f64, w: f64, h: f64, #[serde(default)] style: Style },
    /// Dim everything except this region.
    Spotlight { x: f64, y: f64, w: f64, h: f64, #[serde(default)] style: Style },
    Text { x: f64, y: f64, text: String, #[serde(default)] style: Style },
    /// Freehand stroke: flat [x0,y0,x1,y1,…].
    Pen { points: Vec<f64>, #[serde(default)] style: Style },
    /// Translucent (40 %) highlighter stroke: flat [x0,y0,x1,y1,…]. Drawn at 4× strokeWidth,
    /// so strokeWidth 4–6 covers a normal line of text.
    Highlight { points: Vec<f64>, #[serde(default)] style: Style },
    /// Numbered badge; number defaults to the next unused.
    Step { x: f64, y: f64, number: Option<u32>, #[serde(default)] style: Style },
    /// Place another image file as a layer.
    Image { x: f64, y: f64, w: Option<f64>, h: Option<f64>, path: String },
}

/// One edit. Applied in order; the document is validated and saved once at the end.
#[derive(Debug, Clone, Deserialize, schemars::JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Edit {
    /// Add an annotation (gets a new id, drawn above existing ones).
    Add { annotation: NewAnnotation },
    /// Change fields of an existing annotation by id (e.g. {"x": 10, "style": {"color": "#000"}}).
    Update { id: String, patch: Map<String, Value> },
    Remove { id: String },
    ClearAnnotations,
    /// Crop the image (pixels); null removes the crop.
    SetCrop { crop: Option<Rect> },
    /// Merge into the frame/Look: enabled, background ({type:"solid",color} | {type:"gradient",gradientId,angleDeg?} |
    /// {type:"transparent"}), padding, radius, shadow (0–100), shadowColor, border {width,color,style},
    /// aspect ("auto","1:1","16:9","4:3","9:16","4:5","3:2","1.91:1"), outputSize {width,height},
    /// chrome {style:"none"|"window"|"browser", theme:"light"|"dark", buttons:"none"|"mac"|"windows", title, url}.
    SetFrame { frame: Map<String, Value> },
    /// Round the image's own corners (0–100 %, trimmed to transparent on export).
    SetCornerRadius { percent: f64 },
    /// Explicit canvas size in pixels (e.g. to place images side by side); null = fit the image.
    SetCanvas { canvas: Option<Size> },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Rect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }
#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
pub struct Size { pub width: u32, pub height: u32 }

pub struct Document {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub doc: Value,
}

pub fn read(path: &Path) -> Result<Document, String> {
    let text = std::fs::read_to_string(path).map_err(|_| format!("Couldn't read {}", path.display()))?;
    let parsed = crate::editor::document::parse(&text)?;
    Ok(Document { png: parsed.png, width: parsed.width, height: parsed.height, doc: parsed.doc })
}

fn write(path: &Path, document: &Document) -> Result<(), String> {
    let text = crate::editor::document::assemble(&document.png, document.width, document.height, document.doc.clone(), env!("CARGO_PKG_VERSION"))?;
    std::fs::write(path, text).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

/// New `.glint` from an image (any supported format). `output` defaults to
/// "<name>.glint" beside the image; existing files are never overwritten.
pub fn create(image: &Path, output: Option<&Path>) -> Result<PathBuf, String> {
    let decoded = super::image::load(image)?;
    let mut png = Vec::new();
    decoded.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let output = match output {
        Some(path) if path.exists() => return Err(format!("{} already exists; choose a new path.", path.display())),
        Some(path) => path.with_extension("glint"),
        None => numbered(image, "", "glint"),
    };
    let document = Document { png, width: decoded.width(), height: decoded.height(), doc: json!({"annotations": [], "crop": null}) };
    write(&output, &document)?;
    Ok(output)
}

/// `<stem><suffix>.<ext>` beside `input`, numbered so nothing is overwritten.
pub fn numbered(input: &Path, suffix: &str, ext: &str) -> PathBuf {
    let dir = input.parent().unwrap_or(Path::new("."));
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let mut candidate = dir.join(format!("{stem}{suffix}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}{suffix} {n}.{ext}"));
        n += 1;
    }
    candidate
}

/// A compact view of a document for agents (image size, annotations, frame…).
pub fn summary(path: &Path) -> Result<Value, String> {
    let document = read(path)?;
    let annotations: Vec<Value> = document.doc.get("annotations").and_then(Value::as_array).cloned().unwrap_or_default()
        .into_iter()
        .map(|mut a| {
            // Image layers carry their pixels inline; don't flood the agent with base64.
            if let Some(obj) = a.as_object_mut() {
                if obj.contains_key("dataUrl") {
                    obj.insert("dataUrl".into(), json!("<embedded image>"));
                }
            }
            a
        })
        .collect();
    Ok(json!({
        "path": path.display().to_string(),
        "image": {"width": document.width, "height": document.height},
        "annotations": annotations,
        "crop": document.doc.get("crop").cloned().unwrap_or(Value::Null),
        "frame": document.doc.get("frame").cloned().unwrap_or(json!({"enabled": false})),
        "cornerRadius": document.doc.get("cornerRadius").cloned().unwrap_or(json!(0)),
        "canvasSize": document.doc.get("canvasSize").cloned().unwrap_or(Value::Null),
    }))
}

fn new_id(doc: &Value) -> String {
    let taken = doc.get("annotations").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    format!("mcp{stamp:x}{taken:x}")
}

fn style_json(style: &Style) -> Value {
    let mut value = json!({"color": "#E5484D", "strokeWidth": 3, "fontSize": 24});
    if let (Some(base), Ok(Value::Object(set))) = (value.as_object_mut(), serde_json::to_value(style)) {
        base.extend(set);
    }
    value
}

fn image_layer(path: &str, x: f64, y: f64, w: Option<f64>, h: Option<f64>) -> Result<Value, String> {
    let file = Path::new(path);
    let decoded = super::image::load(file)?;
    let (iw, ih) = (decoded.width() as f64, decoded.height() as f64);
    let (w, h) = match (w, h) {
        (Some(w), Some(h)) => (w, h),
        (Some(w), None) => (w, w * ih / iw),
        (None, Some(h)) => (h * iw / ih, h),
        (None, None) => (iw, ih),
    };
    let mut png = Vec::new();
    decoded.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let name = file.file_name().and_then(|n| n.to_str()).unwrap_or("image").to_string();
    Ok(json!({"x": x, "y": y, "w": w, "h": h, "name": name,
        "dataUrl": format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))}))
}

fn annotation_json(annotation: &NewAnnotation, doc: &Value) -> Result<Value, String> {
    let (kind, mut fields, style) = match annotation {
        NewAnnotation::Arrow { x1, y1, x2, y2, style } => ("arrow", json!({"x1": x1, "y1": y1, "x2": x2, "y2": y2}), style.clone()),
        NewAnnotation::Line { x1, y1, x2, y2, style } => ("line", json!({"x1": x1, "y1": y1, "x2": x2, "y2": y2}), style.clone()),
        NewAnnotation::Rect { x, y, w, h, style } => ("rect", json!({"x": x, "y": y, "w": w, "h": h}), style.clone()),
        NewAnnotation::Ellipse { x, y, w, h, style } => ("ellipse", json!({"x": x, "y": y, "w": w, "h": h}), style.clone()),
        NewAnnotation::Blur { x, y, w, h, style } => ("blur", json!({"x": x, "y": y, "w": w, "h": h}), style.clone()),
        NewAnnotation::Redact { x, y, w, h, style } => ("redact", json!({"x": x, "y": y, "w": w, "h": h}), style.clone()),
        NewAnnotation::Spotlight { x, y, w, h, style } => ("spotlight", json!({"x": x, "y": y, "w": w, "h": h}), style.clone()),
        NewAnnotation::Text { x, y, text, style } => ("text", json!({"x": x, "y": y, "text": text}), style.clone()),
        NewAnnotation::Pen { points, style } | NewAnnotation::Highlight { points, style } => {
            if points.len() < 4 || points.len() % 2 != 0 {
                return Err("A pen/highlight stroke needs an even list of at least 2 points: [x0,y0,x1,y1,…].".into());
            }
            let kind = if matches!(annotation, NewAnnotation::Pen { .. }) { "pen" } else { "highlight" };
            (kind, json!({"points": points}), style.clone())
        }
        NewAnnotation::Step { x, y, number, style } => {
            let next = doc.get("annotations").and_then(Value::as_array).map(|list| {
                list.iter().filter(|a| a["type"] == "step").filter_map(|a| a["number"].as_u64()).max().unwrap_or(0) + 1
            }).unwrap_or(1);
            ("step", json!({"x": x, "y": y, "number": number.map(u64::from).unwrap_or(next)}), style.clone())
        }
        NewAnnotation::Image { x, y, w, h, path } => ("image", image_layer(path, *x, *y, *w, *h)?, Style::default()),
    };
    let z = doc.get("annotations").and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|a| a["z"].as_f64()).fold(0.0, f64::max) + 1.0)
        .unwrap_or(1.0);
    let object = fields.as_object_mut().unwrap();
    object.insert("id".into(), json!(new_id(doc)));
    object.insert("type".into(), json!(kind));
    object.insert("z".into(), json!(z));
    object.insert("style".into(), style_json(&style));
    Ok(fields)
}

fn merge(target: &mut Map<String, Value>, patch: &Map<String, Value>) {
    for (key, value) in patch {
        match (target.get_mut(key), value) {
            (Some(Value::Object(existing)), Value::Object(inner)) => merge(existing, inner),
            _ => { target.insert(key.clone(), value.clone()); }
        }
    }
}

/// Apply edits in order and save the document in place. Returns new annotation ids.
pub fn edit(path: &Path, edits: &[Edit]) -> Result<Value, String> {
    let mut document = read(path)?;
    let doc = document.doc.as_object_mut().ok_or("This document has no editable content")?;
    doc.entry("annotations").or_insert_with(|| json!([]));
    let mut added = Vec::new();
    for (index, edit) in edits.iter().enumerate() {
        let fail = |message: String| format!("Edit {} failed: {message}", index + 1);
        match edit {
            Edit::Add { annotation } => {
                let snapshot = Value::Object(doc.clone());
                let value = annotation_json(annotation, &snapshot).map_err(fail)?;
                added.push(value["id"].clone());
                doc.get_mut("annotations").and_then(Value::as_array_mut).unwrap().push(value);
            }
            Edit::Update { id, patch } => {
                if patch.contains_key("id") || patch.contains_key("type") {
                    return Err(fail("an annotation's id and type can't be changed; remove it and add a new one".into()));
                }
                let list = doc.get_mut("annotations").and_then(Value::as_array_mut).unwrap();
                let target = list.iter_mut().find(|a| a["id"] == id.as_str()).ok_or_else(|| fail(format!("no annotation with id \"{id}\"")))?;
                merge(target.as_object_mut().unwrap(), patch);
            }
            Edit::Remove { id } => {
                let list = doc.get_mut("annotations").and_then(Value::as_array_mut).unwrap();
                let before = list.len();
                list.retain(|a| a["id"] != id.as_str());
                if list.len() == before {
                    return Err(fail(format!("no annotation with id \"{id}\"")));
                }
            }
            Edit::ClearAnnotations => { doc.insert("annotations".into(), json!([])); }
            Edit::SetCrop { crop } => {
                if let Some(c) = crop {
                    if c.w <= 0.0 || c.h <= 0.0 || c.x < 0.0 || c.y < 0.0 || c.x + c.w > document.width as f64 || c.y + c.h > document.height as f64 {
                        return Err(fail(format!("crop must lie inside the {}×{} image", document.width, document.height)));
                    }
                }
                doc.insert("crop".into(), serde_json::to_value(crop).unwrap());
            }
            Edit::SetFrame { frame } => {
                let current = doc.entry("frame").or_insert_with(|| json!({}));
                if !current.is_object() { *current = json!({}); }
                merge(current.as_object_mut().unwrap(), frame);
            }
            Edit::SetCornerRadius { percent } => {
                if !(0.0..=100.0).contains(percent) {
                    return Err(fail("corner radius is a percentage, 0–100".into()));
                }
                doc.insert("cornerRadius".into(), json!(percent));
            }
            Edit::SetCanvas { canvas } => {
                doc.insert("canvasSize".into(), serde_json::to_value(canvas).unwrap());
                doc.insert("canvasAutoFit".into(), json!(canvas.is_none()));
            }
        }
    }
    write(path, &document)?;
    Ok(json!({"path": path.display().to_string(), "added": added}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glint-mcp-doc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(dir: &Path) -> PathBuf {
        let image = dir.join("shot.png");
        image::RgbaImage::from_pixel(200, 100, image::Rgba([240, 240, 240, 255])).save(&image).unwrap();
        image
    }

    fn edits(value: Value) -> Vec<Edit> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn create_never_overwrites_and_round_trips_through_the_app_format() {
        let dir = temp("create");
        let image = sample(&dir);
        let doc = create(&image, None).unwrap();
        assert_eq!(doc.file_name().unwrap(), "shot.glint");
        assert_eq!(create(&image, None).unwrap().file_name().unwrap(), "shot 2.glint");
        assert!(create(&image, Some(&doc)).is_err());
        let parsed = read(&doc).unwrap();
        assert_eq!((parsed.width, parsed.height), (200, 100));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn edits_produce_the_editor_model_and_validate() {
        let dir = temp("edit");
        let image = sample(&dir);
        let doc = create(&image, None).unwrap();
        let result = edit(&doc, &edits(json!([
            {"op": "add", "annotation": {"type": "arrow", "x1": 10, "y1": 10, "x2": 90, "y2": 50, "style": {"color": "#000000", "arrowStart": true}}},
            {"op": "add", "annotation": {"type": "step", "x": 20, "y": 20}},
            {"op": "add", "annotation": {"type": "step", "x": 40, "y": 20}},
            {"op": "add", "annotation": {"type": "redact", "x": 100, "y": 10, "w": 50, "h": 20, "style": {"redactStyle": "pixelate"}}},
            {"op": "set_frame", "frame": {"enabled": true, "background": {"type": "gradient", "gradientId": "dusk"}, "padding": 48}},
            {"op": "set_corner_radius", "percent": 20},
            {"op": "set_crop", "crop": {"x": 0, "y": 0, "w": 150, "h": 80}}
        ]))).unwrap();
        assert_eq!(result["added"].as_array().unwrap().len(), 4);
        let view = summary(&doc).unwrap();
        let list = view["annotations"].as_array().unwrap();
        assert_eq!(list[0]["type"], "arrow");
        assert_eq!(list[0]["style"]["arrowStart"], true);
        assert_eq!(list[0]["style"]["strokeWidth"], 3, "editor defaults fill unspecified style");
        assert_eq!((list[1]["number"].as_u64(), list[2]["number"].as_u64()), (Some(1), Some(2)));
        assert_eq!(list[3]["style"]["redactStyle"], "pixelate");
        assert!(list.windows(2).all(|w| w[0]["z"].as_f64() < w[1]["z"].as_f64()));
        assert_eq!(view["frame"]["background"]["gradientId"], "dusk");
        assert_eq!(view["cornerRadius"], 20.0);

        let id = list[0]["id"].as_str().unwrap().to_string();
        edit(&doc, &edits(json!([{"op": "update", "id": id, "patch": {"style": {"color": "#00ff00"}}}]))).unwrap();
        let updated = summary(&doc).unwrap();
        assert_eq!(updated["annotations"][0]["style"]["color"], "#00ff00");
        assert_eq!(updated["annotations"][0]["style"]["arrowStart"], true, "patches merge, not replace");

        assert!(edit(&doc, &edits(json!([{"op": "set_crop", "crop": {"x": 0, "y": 0, "w": 500, "h": 80}}]))).unwrap_err().contains("inside"));
        assert!(edit(&doc, &edits(json!([{"op": "remove", "id": "missing"}]))).is_err());
        assert!(edit(&doc, &edits(json!([{"op": "add", "annotation": {"type": "pen", "points": [1, 2, 3]}}]))).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_edit_batches_leave_the_document_unchanged() {
        let dir = temp("atomic");
        let doc = create(&sample(&dir), None).unwrap();
        let before = std::fs::read(&doc).unwrap();
        let err = edit(&doc, &edits(json!([
            {"op": "add", "annotation": {"type": "rect", "x": 1, "y": 1, "w": 5, "h": 5}},
            {"op": "set_corner_radius", "percent": 400}
        ]))).unwrap_err();
        assert!(err.starts_with("Edit 2 failed"));
        assert_eq!(std::fs::read(&doc).unwrap(), before);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn image_layers_embed_and_summaries_hide_the_pixels() {
        let dir = temp("layer");
        let doc = create(&sample(&dir), None).unwrap();
        let logo = dir.join("logo.png");
        image::RgbaImage::from_pixel(40, 20, image::Rgba([0, 0, 255, 255])).save(&logo).unwrap();
        edit(&doc, &edits(json!([{"op": "add", "annotation": {"type": "image", "x": 5, "y": 5, "w": 80, "path": logo}}]))).unwrap();
        let layer = &summary(&doc).unwrap()["annotations"][0];
        assert_eq!((layer["w"].as_f64(), layer["h"].as_f64()), (Some(80.0), Some(40.0)), "keeps aspect");
        assert_eq!(layer["dataUrl"], "<embedded image>");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn gradient_catalogue_is_the_apps() {
        let list: Vec<Value> = serde_json::from_str(GRADIENTS_JSON).unwrap();
        assert!(list.iter().any(|g| g["id"] == "dusk"));
    }
}
