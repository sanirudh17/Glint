//! Glint MCP — lets coding agents (Claude Code, Codex, OpenCode, …) use Glint's
//! capture library and editing tools over the Model Context Protocol.
//!
//! Runs as its own small program (`glint-mcp`, stdio transport) that links this
//! library directly. File work (trimming, .glint documents) happens here without
//! the app. Work only the running app can do — rendering with the editor's own
//! stage, opening windows — goes over its local control channel (`bridge`), and
//! Glint is started quietly in the tray if it isn't running. Because this is a
//! separate process it never touches Glint's single-instance lock.
//! Library access is read-only; edits always write new files.
pub mod bridge;
pub mod editor;
pub mod image;
pub mod library;
pub mod video;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ProgressNotificationParam, ServerCapabilities, ServerConfig},
    schemars,
    service::RequestContext,
    tool, tool_handler, tool_router, ErrorData, RoleServer, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const INSTRUCTIONS: &str = "Glint is a Windows screenshot and screen-recording app. \
Use library_search to find the user's captures (by name, date, or text inside screenshots). \
image_info reports an image's size and content bounds; image_trim crops to that content and \
image_round_corners rounds corners, each writing a NEW file — originals are never modified. \
Editor work uses .glint documents (the editor's own project format): editor_create makes one \
from an image; editor_edit adds annotations (arrow, line, rect, ellipse, blur, redact, spotlight, \
text, pen, highlight, numbered steps, image layers) and sets crop, frame/background, corner \
rounding and canvas size; editor_read shows the current state with annotation ids; editor_render \
exports a PNG exactly as the editor's Export would; open_in_glint opens a file in Glint for the \
user. editor_catalog lists gradients, aspect ratios and annotation types. Coordinates are image \
pixels from the top-left. \
Videos are edited as Studio projects, exactly like Glint's Trim window: video_open prepares one \
(never touching the video), video_read shows the timeline and effects with ids, video_edit cuts, \
restores, speeds up and reorders footage and adds zooms (manual, or automatic from recorded clicks), \
masks (blur/pixelate/solid/highlight, moving via keyframes), drawn annotations, captions, the \
background/frame Look, cursor styling, crop, fades, webcam bubble, motion blur, audio clean-up and \
the entrance. All video times are seconds of the SOURCE video. video_frames returns still frames so \
you can look at the footage; video_analyze finds silence, idle stretches and typing bursts to cut \
or speed up; video_captions transcribes speech on this device. video_export renders a new MP4 or \
GIF in the background: it waits up to wait_seconds while reporting progress, then returns a task \
id — keep calling task_status until state is \"done\" (or task_cancel). Exports never overwrite \
files. All paths are absolute Windows paths. Rendering, video work and opening need Glint, which \
is started in the tray if it isn't running.";

const RENDER_TIMEOUT: Duration = Duration::from_secs(120);
const DEFAULT_WAIT: u64 = 45;
const MAX_WAIT: u64 = 300;

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LibrarySearchArgs {
    /// Words to match against capture names, dates (e.g. "2026-11-20") or text read inside screenshots. Omit for the newest captures.
    pub query: Option<String>,
    /// Restrict to one kind of capture.
    #[serde(default)]
    pub kind: library::Kind,
    /// Maximum results (1–200, default 20).
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImagePathArgs {
    /// Absolute path to a PNG, JPEG, WebP, BMP or GIF file.
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImageTrimArgs {
    /// Absolute path to the image to trim. It is never modified.
    pub path: String,
    /// Where to write the trimmed PNG. Must not exist. Default: "<name> (trimmed).png" beside the input.
    pub output: Option<String>,
    /// What counts as margin. "auto" (default) uses transparency when the border has any, otherwise a uniform border colour.
    pub mode: Option<image::TrimMode>,
    /// Per-channel difference (0–255) still treated as margin. Default 8; raise for noisy JPEG backgrounds.
    pub tolerance: Option<u8>,
    /// Pixels of margin to keep around the content. Default 0 (crop to the absolute edges).
    pub padding: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RoundCornersArgs {
    /// Absolute path to the image. It is never modified.
    pub path: String,
    /// Corner radius as a percentage (0–100); 100 gives the fullest rounding (a pill or circle).
    pub percent: f64,
    /// Where to write the PNG. Must not exist. Default: "<name> (rounded).png" beside the image.
    pub output: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditorCreateArgs {
    /// Absolute path to the source image (PNG, JPEG, WebP, BMP or GIF). It is never modified.
    pub image: String,
    /// Where to write the .glint document. Must not exist. Default: "<name>.glint" beside the image.
    pub output: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DocPathArgs {
    /// Absolute path to a .glint document.
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct OpenArgs {
    /// Absolute path to a .glint document, an image, or a video (MP4/MOV/WebM/MKV/AVI).
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditorEditArgs {
    /// Absolute path to the .glint document to change (saved in place; all edits apply or none do).
    pub path: String,
    /// Edits applied in order.
    pub edits: Vec<editor::Edit>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditorRenderArgs {
    /// Absolute path to the .glint document.
    pub path: String,
    /// Where to write the PNG. Must not exist. Default: "<name> (edited).png" beside the document.
    pub output: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoPathArgs {
    /// Absolute path to the video (MP4/MOV/WebM/MKV/AVI) or a Glint recording.
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoEditArgs {
    /// Absolute path to the video (already opened with video_open).
    pub path: String,
    /// Edits applied in order; all apply or none do.
    pub edits: Vec<video::VideoEdit>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoFramesArgs {
    /// Absolute path to the video.
    pub path: String,
    /// Source times in seconds (1–12 frames).
    pub times: Vec<f64>,
    /// Frame width in pixels (160–1920, default 960).
    pub width: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoAnalyzeArgs {
    /// Absolute path to the video (already opened with video_open).
    pub path: String,
    /// Also find silent stretches in the audio (default true).
    pub silence: Option<bool>,
    /// Seconds to wait for the audio analysis (default 45, max 300).
    pub wait_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoCaptionsArgs {
    /// Absolute path to the video (already opened with video_open).
    pub path: String,
    /// Download the on-device caption engine first if it's missing (one-time download).
    pub install: Option<bool>,
    /// Write the transcript into the project as captions when it finishes in time (default true).
    pub apply: Option<bool>,
    /// Seconds to wait (default 45, max 300).
    pub wait_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VideoExportArgs {
    /// Absolute path to the video (already opened with video_open).
    pub path: String,
    /// "mp4" (default) or "gif" (at most 60 s of output).
    pub format: Option<String>,
    /// GIF only: 5–30 (default 15).
    pub fps: Option<u32>,
    /// GIF only: 320–1920 pixels (default 960).
    pub width: Option<u32>,
    /// GIF only: loop forever (default true).
    pub repeat: Option<bool>,
    /// Seconds to wait before returning a task id to poll (default 45, max 300).
    pub wait_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskArgs {
    /// Task id returned by video_export, video_analyze or video_captions.
    pub task: u64,
    /// task_status only: seconds to wait for it to finish (default 45, max 300).
    pub wait_seconds: Option<u64>,
}

/// Poll a task in the app, reporting progress to the client, until it finishes
/// or the wait runs out. The task keeps running in Glint if we stop waiting.
async fn wait_task(task: u64, wait: Option<u64>, context: &RequestContext<RoleServer>) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(wait.unwrap_or(DEFAULT_WAIT).min(MAX_WAIT));
    let token = context.meta.get_progress_token();
    let mut reported = -1.0;
    loop {
        let mut status = bridge::call("task_status", json!({"task": task}), Duration::from_secs(20)).await?;
        if status["state"] != "running" {
            return Ok(status);
        }
        let progress = status["progress"].as_f64().unwrap_or(0.);
        if let Some(token) = &token {
            if progress > reported {
                reported = progress;
                let label = status["label"].as_str().unwrap_or("Working").to_string();
                let _ = context
                    .peer
                    .notify_progress(ProgressNotificationParam::new(token.clone(), progress).with_total(100.).with_message(label))
                    .await;
            }
        }
        if Instant::now() >= deadline || context.ct.is_cancelled() {
            status["next"] = json!("Still running in Glint. Call task_status with this task id to keep waiting, or task_cancel to stop it.");
            return Ok(status);
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
    }
}

/// The source's length and size from Glint. Refuses while Trim has the video
/// open, because Trim's autosave would overwrite an agent's edits.
async fn video_source(path: &str) -> Result<video::Source, String> {
    let probe = bridge::call("video_probe", json!({"path": path}), Duration::from_secs(60)).await?;
    if probe["open_in_trim"] == true {
        return Err("This video is open in Glint's Trim window. Ask the user to close it first, so Trim's autosave doesn't overwrite your edits.".into());
    }
    let n = |k: &str| probe[k].as_f64().ok_or_else(|| format!("Glint couldn't read the video's {k}."));
    Ok(video::Source { duration: n("duration")?, width: n("width")?, height: n("height")? })
}

#[derive(Clone)]
pub struct GlintMcp {
    #[expect(dead_code, reason = "read by the #[tool_handler] macro")]
    tool_router: ToolRouter<Self>,
}

impl Default for GlintMcp {
    fn default() -> Self {
        Self { tool_router: Self::tool_router() }
    }
}

/// Run blocking file work off the async runtime.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.unwrap_or_else(|e| Err(e.to_string()))
}

/// Successful result as JSON text; a domain failure as a tool error the agent can read.
fn respond<T: serde::Serialize>(result: Result<T, String>) -> Result<CallToolResult, ErrorData> {
    match result {
        Ok(value) => Ok(CallToolResult::success(vec![ContentBlock::json(value)?])),
        Err(message) => Ok(CallToolResult::error(vec![ContentBlock::text(message)])),
    }
}

/// Render a .glint through the running app's editor stage.
async fn render(path: &Path, output: Option<String>, suffix: &str) -> Result<Value, String> {
    let output = match output {
        Some(output) => PathBuf::from(output),
        None => editor::numbered(path, suffix, "png"),
    };
    if output.exists() {
        return Err(format!("{} already exists; choose a new output path.", output.display()));
    }
    bridge::call("editor_render", json!({"path": path.display().to_string(), "output": output.display().to_string()}), RENDER_TIMEOUT).await
}

#[tool_router]
impl GlintMcp {
    /// Find captures in the user's Glint library, newest first.
    #[tool(annotations(title = "Search Glint library", read_only_hint = true, open_world_hint = false))]
    async fn library_search(&self, Parameters(args): Parameters<LibrarySearchArgs>) -> Result<CallToolResult, ErrorData> {
        let limit = args.limit.unwrap_or(20).clamp(1, 200) as usize;
        respond(blocking(move || library::search(args.query.as_deref(), args.kind, limit)).await)
    }

    /// Size, transparency and the bounds of an image's real content (what image_trim would keep).
    #[tool(annotations(title = "Inspect image", read_only_hint = true, open_world_hint = false))]
    async fn image_info(&self, Parameters(args): Parameters<ImagePathArgs>) -> Result<CallToolResult, ErrorData> {
        respond(blocking(move || image::info(&PathBuf::from(args.path))).await)
    }

    /// Crop an image to its content — transparent margins or a uniform background — and save it as a new PNG.
    #[tool(annotations(title = "Trim image to content", read_only_hint = false, destructive_hint = false, idempotent_hint = false, open_world_hint = false))]
    async fn image_trim(&self, Parameters(args): Parameters<ImageTrimArgs>) -> Result<CallToolResult, ErrorData> {
        respond(
            blocking(move || {
                image::trim(
                    &PathBuf::from(&args.path),
                    args.output.as_deref().map(Path::new),
                    args.mode.unwrap_or(image::TrimMode::Auto),
                    args.tolerance.unwrap_or(8),
                    args.padding.unwrap_or(0),
                )
            })
            .await,
        )
    }

    /// Round an image's corners (trimmed to transparent) with the editor's own renderer and save a new PNG.
    /// Use image_trim first to crop to the absolute edges.
    #[tool(annotations(title = "Round image corners", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn image_round_corners(&self, Parameters(args): Parameters<RoundCornersArgs>) -> Result<CallToolResult, ErrorData> {
        let image = PathBuf::from(&args.path);
        let output = args.output.clone().unwrap_or_else(|| editor::numbered(&image, " (rounded)", "png").display().to_string());
        let percent = args.percent;
        let scratch = std::env::temp_dir().join(format!("glint-mcp-round-{}-{:x}.glint", std::process::id(), percent.to_bits()));
        let _ = std::fs::remove_file(&scratch);
        let prepared = blocking({
            let (image, scratch) = (image.clone(), scratch.clone());
            move || {
                editor::create(&image, Some(&scratch))?;
                editor::edit(&scratch, &[editor::Edit::SetCornerRadius { percent }])
            }
        })
        .await;
        let result = match prepared {
            Ok(_) => render(&scratch, Some(output), "").await,
            Err(error) => Err(error),
        };
        let _ = std::fs::remove_file(&scratch);
        respond(result)
    }

    /// Make a new .glint editor document from an image, ready for editor_edit and editor_render.
    #[tool(annotations(title = "Create editor document", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn editor_create(&self, Parameters(args): Parameters<EditorCreateArgs>) -> Result<CallToolResult, ErrorData> {
        respond(
            blocking(move || {
                let path = editor::create(&PathBuf::from(args.image), args.output.as_deref().map(Path::new))?;
                editor::summary(&path)
            })
            .await,
        )
    }

    /// Show a .glint document: image size, annotations (with ids for editor_edit), crop, frame, corners and canvas.
    #[tool(annotations(title = "Read editor document", read_only_hint = true, open_world_hint = false))]
    async fn editor_read(&self, Parameters(args): Parameters<DocPathArgs>) -> Result<CallToolResult, ErrorData> {
        respond(blocking(move || editor::summary(&PathBuf::from(args.path))).await)
    }

    /// Change a .glint document: add, update or remove annotations; set crop, frame/background, corner radius or canvas.
    #[tool(annotations(title = "Edit editor document", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn editor_edit(&self, Parameters(args): Parameters<EditorEditArgs>) -> Result<CallToolResult, ErrorData> {
        respond(blocking(move || editor::edit(&PathBuf::from(args.path), &args.edits)).await)
    }

    /// Export a .glint document to PNG with Glint's own editor, exactly as its Export button would.
    #[tool(annotations(title = "Render editor document", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn editor_render(&self, Parameters(args): Parameters<EditorRenderArgs>) -> Result<CallToolResult, ErrorData> {
        respond(render(&PathBuf::from(args.path), args.output, " (edited)").await)
    }

    /// Open a .glint document, an image or a video in Glint (editor or Studio) for the user to review.
    #[tool(annotations(title = "Open in Glint", read_only_hint = true, open_world_hint = false))]
    async fn open_in_glint(&self, Parameters(args): Parameters<OpenArgs>) -> Result<CallToolResult, ErrorData> {
        respond(bridge::call("open", json!({"path": args.path}), Duration::from_secs(30)).await)
    }

    /// Prepare a video for editing as a Studio project (as opening it in Trim does) and show its state.
    /// The video itself is never modified.
    #[tool(annotations(title = "Open video for editing", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn video_open(&self, Parameters(args): Parameters<VideoPathArgs>) -> Result<CallToolResult, ErrorData> {
        let result = async {
            let probe = bridge::call("video_import", json!({"path": args.path}), Duration::from_secs(120)).await?;
            let path = PathBuf::from(&args.path);
            let mut view = blocking(move || video::load(&path).map(|p| video::summary(&p, &path))).await?;
            for key in ["duration", "width", "height", "fps", "has_audio", "has_webcam"] {
                view[key] = probe[key].clone();
            }
            Ok(view)
        }
        .await;
        respond(result)
    }

    /// Show a Studio project: timeline clips, zooms, masks, annotations and captions (all with ids), Look,
    /// cursor, crop, fades, webcam and output length.
    #[tool(annotations(title = "Read video project", read_only_hint = true, open_world_hint = false))]
    async fn video_read(&self, Parameters(args): Parameters<VideoPathArgs>) -> Result<CallToolResult, ErrorData> {
        let path = PathBuf::from(args.path);
        respond(blocking(move || video::load(&path).map(|p| video::summary(&p, &path))).await)
    }

    /// Edit a Studio project: cut/restore/speed/reorder footage, zooms, masks, annotations, captions, Look,
    /// cursor, crop, fades, webcam, motion blur, audio clean-up, entrance. Validated like Trim; all or nothing.
    #[tool(annotations(title = "Edit video project", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn video_edit(&self, Parameters(args): Parameters<VideoEditArgs>) -> Result<CallToolResult, ErrorData> {
        let result = async {
            let source = video_source(&args.path).await?;
            blocking(move || video::edit(&PathBuf::from(args.path), &args.edits, source)).await
        }
        .await;
        respond(result)
    }

    /// Look at the footage: still frames (JPEG images) at the given source times.
    #[tool(annotations(title = "Video frames", read_only_hint = true, open_world_hint = false))]
    async fn video_frames(&self, Parameters(args): Parameters<VideoFramesArgs>) -> Result<CallToolResult, ErrorData> {
        let reply = bridge::call(
            "video_frames",
            json!({"path": args.path, "times": args.times, "width": args.width.unwrap_or(960)}),
            Duration::from_secs(180),
        )
        .await;
        match reply {
            Err(message) => Ok(CallToolResult::error(vec![ContentBlock::text(message)])),
            Ok(reply) => {
                let mut blocks = Vec::new();
                for frame in reply["frames"].as_array().into_iter().flatten() {
                    blocks.push(ContentBlock::text(format!("Frame at {:.2}s", frame["t"].as_f64().unwrap_or(0.))));
                    blocks.push(ContentBlock::image(frame["jpeg"].as_str().unwrap_or_default(), "image/jpeg"));
                }
                Ok(CallToolResult::success(blocks))
            }
        }
    }

    /// Find stretches worth cutting or speeding up: silent audio, idle time (no input) and bursts of typing.
    #[tool(annotations(title = "Analyze video", read_only_hint = true, open_world_hint = false))]
    async fn video_analyze(&self, Parameters(args): Parameters<VideoAnalyzeArgs>, context: RequestContext<RoleServer>) -> Result<CallToolResult, ErrorData> {
        let result = async {
            let probe = bridge::call("video_probe", json!({"path": args.path}), Duration::from_secs(60)).await?;
            let duration = probe["duration"].as_f64().ok_or("Glint couldn't read the video's length.")?;
            let path = PathBuf::from(&args.path);
            let mut out = blocking(move || {
                let project = video::load(&path)?;
                let pairs = |v: Vec<(f64, f64)>| v.into_iter().map(|(s, e)| json!({"start": s, "end": e})).collect::<Vec<_>>();
                Ok::<_, String>(json!({
                    "duration": duration,
                    "idle": pairs(video::activity_spans(&project.events, duration, false)),
                    "typing": pairs(video::activity_spans(&project.events, duration, true)),
                }))
            })
            .await?;
            if args.silence.unwrap_or(true) {
                let started = bridge::call("video_silence_start", json!({"path": args.path}), Duration::from_secs(20)).await?;
                let task = started["task"].as_u64().ok_or("Glint didn't start the analysis.")?;
                let status = wait_task(task, args.wait_seconds, &context).await?;
                out["silence"] = if status["state"] == "done" { status["result"]["silences"].clone() } else { status };
            }
            out["hint"] = json!("Use video_edit cut (remove) or set_speed (speed up) with these spans.");
            Ok(out)
        }
        .await;
        respond(result)
    }

    /// Transcribe speech on this device into caption lines and (by default) add them to the project.
    #[tool(annotations(title = "Generate captions", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn video_captions(&self, Parameters(args): Parameters<VideoCaptionsArgs>, context: RequestContext<RoleServer>) -> Result<CallToolResult, ErrorData> {
        let result = async {
            let installed = bridge::call("captions_status", json!({}), Duration::from_secs(20)).await?["installed"] == true;
            if !installed {
                if !args.install.unwrap_or(false) {
                    return Err("The on-device caption engine isn't installed. Call again with install: true to download it once.".into());
                }
                let started = bridge::call("captions_install_start", json!({}), Duration::from_secs(20)).await?;
                let status = wait_task(started["task"].as_u64().ok_or("Glint didn't start the download.")?, args.wait_seconds, &context).await?;
                if status["state"] != "done" {
                    return Ok(status);
                }
            }
            let started = bridge::call("captions_generate_start", json!({"path": args.path}), Duration::from_secs(60)).await?;
            let status = wait_task(started["task"].as_u64().ok_or("Glint didn't start transcription.")?, args.wait_seconds, &context).await?;
            if status["state"] != "done" || !args.apply.unwrap_or(true) {
                return Ok(status);
            }
            let lines: Vec<video::CaptionLine> = serde_json::from_value(status["result"]["captions"].clone()).map_err(|e| e.to_string())?;
            if lines.is_empty() {
                return Ok(json!({"captions": [], "note": "No speech was found."}));
            }
            let source = video_source(&args.path).await?;
            let path = PathBuf::from(&args.path);
            let count = lines.len();
            blocking(move || video::edit(&path, &[video::VideoEdit::SetCaptions { captions: lines }], source)).await?;
            Ok(json!({"applied": count, "captions": status["result"]["captions"]}))
        }
        .await;
        respond(result)
    }

    /// Export the edited video to a NEW MP4 (or GIF) beside the source, exactly as Trim's Export does.
    /// Waits up to wait_seconds with progress, then returns a task id for task_status.
    #[tool(annotations(title = "Export video", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn video_export(&self, Parameters(args): Parameters<VideoExportArgs>, context: RequestContext<RoleServer>) -> Result<CallToolResult, ErrorData> {
        let result = async {
            let started = bridge::call(
                "video_export_start",
                json!({"path": args.path, "format": args.format.as_deref().unwrap_or("mp4"), "fps": args.fps, "width": args.width, "repeat": args.repeat}),
                Duration::from_secs(30),
            )
            .await?;
            wait_task(started["task"].as_u64().ok_or("Glint didn't start the export.")?, args.wait_seconds, &context).await
        }
        .await;
        respond(result)
    }

    /// Check a background task (export, analysis, captions), waiting up to wait_seconds for it to finish.
    #[tool(annotations(title = "Task status", read_only_hint = true, open_world_hint = false))]
    async fn task_status(&self, Parameters(args): Parameters<TaskArgs>, context: RequestContext<RoleServer>) -> Result<CallToolResult, ErrorData> {
        respond(wait_task(args.task, args.wait_seconds, &context).await)
    }

    /// Stop a running background task. A cancelled export leaves no partial file.
    #[tool(annotations(title = "Cancel task", read_only_hint = false, destructive_hint = false, open_world_hint = false))]
    async fn task_cancel(&self, Parameters(args): Parameters<TaskArgs>) -> Result<CallToolResult, ErrorData> {
        respond(bridge::call("task_cancel", json!({"task": args.task}), Duration::from_secs(20)).await)
    }

    /// The editor's vocabulary: annotation types, edit ops, aspect ratios and the named gradient backgrounds.
    #[tool(annotations(title = "Editor catalog", read_only_hint = true, open_world_hint = false))]
    async fn editor_catalog(&self) -> Result<CallToolResult, ErrorData> {
        let gradients: Vec<Value> = serde_json::from_str::<Vec<Value>>(editor::GRADIENTS_JSON)
            .unwrap_or_default()
            .into_iter()
            .map(|g| json!({"id": g["id"], "label": g["label"], "category": g["category"]}))
            .collect();
        respond::<Value>(Ok(json!({
            "annotation_types": ["arrow", "line", "rect", "ellipse", "blur", "redact", "spotlight", "text", "pen", "highlight", "step", "image"],
            "edit_ops": ["add", "update", "remove", "clear_annotations", "set_crop", "set_frame", "set_corner_radius", "set_canvas"],
            "aspects": ["auto", "1:1", "16:9", "4:3", "9:16", "4:5", "3:2", "1.91:1"],
            "backgrounds": ["solid", "gradient", "image", "transparent"],
            "gradients": gradients,
        })))
    }
}

#[tool_handler]
impl ServerHandler for GlintMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("glint", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

/// Serve MCP over stdin/stdout until the client disconnects.
pub fn run_stdio() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().map_err(|e| e.to_string())?;
    runtime.block_on(async {
        let service = GlintMcp::default().serve(rmcp::transport::stdio()).await.map_err(|e| e.to_string())?;
        service.waiting().await.map_err(|e| e.to_string())?;
        Ok(())
    })
}
