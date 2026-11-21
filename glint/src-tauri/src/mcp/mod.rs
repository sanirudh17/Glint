//! Glint MCP — lets coding agents (Claude Code, Codex, OpenCode, …) use Glint's
//! capture library and editing tools over the Model Context Protocol.
//!
//! Runs as its own small program (`glint-mcp`, stdio transport) that links this
//! library directly. It never starts Glint's windows or tray, so it cannot
//! collide with a running Glint's single-instance lock, works when Glint is
//! closed, and long operations report progress straight to the agent.
//! Library access is read-only; edits always write new files.
pub mod image;
pub mod library;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ErrorData, ServerHandler, ServiceExt,
};
use serde::Deserialize;
use std::path::PathBuf;

const INSTRUCTIONS: &str = "Glint is a Windows screenshot and screen-recording app. \
Use library_search to find the user's captures (by name, date, or text inside screenshots). \
image_info reports an image's size and the bounds of its real content; image_trim crops an \
image to that content (transparent margins or a uniform background) and writes a NEW file — \
originals are never modified. All paths are absolute Windows paths.";

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

/// Successful result as JSON text; a domain failure as a tool error the agent can read.
fn respond<T: serde::Serialize>(result: Result<T, String>) -> Result<CallToolResult, ErrorData> {
    match result {
        Ok(value) => Ok(CallToolResult::success(vec![ContentBlock::json(value)?])),
        Err(message) => Ok(CallToolResult::error(vec![ContentBlock::text(message)])),
    }
}

#[tool_router]
impl GlintMcp {
    /// Find captures in the user's Glint library, newest first.
    #[tool(annotations(title = "Search Glint library", read_only_hint = true, open_world_hint = false))]
    async fn library_search(&self, Parameters(args): Parameters<LibrarySearchArgs>) -> Result<CallToolResult, ErrorData> {
        let limit = args.limit.unwrap_or(20).clamp(1, 200) as usize;
        respond(tokio::task::spawn_blocking(move || library::search(args.query.as_deref(), args.kind, limit)).await.unwrap_or_else(|e| Err(e.to_string())))
    }

    /// Size, transparency and the bounds of an image's real content (what image_trim would keep).
    #[tool(annotations(title = "Inspect image", read_only_hint = true, open_world_hint = false))]
    async fn image_info(&self, Parameters(args): Parameters<ImagePathArgs>) -> Result<CallToolResult, ErrorData> {
        respond(tokio::task::spawn_blocking(move || image::info(&PathBuf::from(args.path))).await.unwrap_or_else(|e| Err(e.to_string())))
    }

    /// Crop an image to its content — transparent margins or a uniform background — and save it as a new PNG.
    #[tool(annotations(title = "Trim image to content", read_only_hint = false, destructive_hint = false, idempotent_hint = false, open_world_hint = false))]
    async fn image_trim(&self, Parameters(args): Parameters<ImageTrimArgs>) -> Result<CallToolResult, ErrorData> {
        respond(
            tokio::task::spawn_blocking(move || {
                image::trim(
                    &PathBuf::from(&args.path),
                    args.output.as_deref().map(std::path::Path::new),
                    args.mode.unwrap_or(image::TrimMode::Auto),
                    args.tolerance.unwrap_or(8),
                    args.padding.unwrap_or(0),
                )
            })
            .await
            .unwrap_or_else(|e| Err(e.to_string())),
        )
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
