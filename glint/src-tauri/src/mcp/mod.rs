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

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

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
pixels from the top-left. All paths are absolute Windows paths. Rendering and opening need Glint, \
which is started in the tray if it isn't running.";

const RENDER_TIMEOUT: Duration = Duration::from_secs(120);

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
