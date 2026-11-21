//! Local control channel for the Glint MCP (`glint-mcp`).
//!
//! A per-user named pipe, `\\.\pipe\<app identifier>-control`, that refuses
//! remote clients. Each connection carries newline-delimited JSON requests
//! `{"id", "method", "params"}` and gets `{"id", "result"}` or `{"id", "error"}`
//! back. Everything an agent does to the *running* app goes through here; pure
//! file work happens inside glint-mcp and never needs the app.
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub const RENDER_LABEL: &str = "editor-render";
const RENDER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

pub fn pipe_name(app_identifier: &str) -> String {
    format!(r"\\.\pipe\{app_identifier}-control")
}

/// Start serving on the app's pipe. Called once from setup.
pub fn start(app: &AppHandle) {
    let name = pipe_name(&app.config().identifier);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve(app, &name).await {
            log::warn!("control channel stopped: {error}");
        }
    });
}

#[cfg(windows)]
async fn serve(app: AppHandle, name: &str) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let mut server = ServerOptions::new().first_pipe_instance(true).reject_remote_clients(true).create(name)?;
    log::info!("control channel listening on {name}");
    loop {
        server.connect().await?;
        let connected = server;
        server = ServerOptions::new().reject_remote_clients(true).create(name)?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = handle(app, connected).await {
                log::debug!("control connection ended: {error}");
            }
        });
    }
}
#[cfg(not(windows))]
async fn serve(_: AppHandle, _: &str) -> std::io::Result<()> {
    Ok(())
}

async fn handle<S>(app: AppHandle, stream: S) -> std::io::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(request) => {
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                match dispatch(&app, &method, params).await {
                    Ok(result) => json!({"id": id, "result": result}),
                    Err(error) => json!({"id": id, "error": error}),
                }
            }
            Err(error) => json!({"id": null, "error": format!("Malformed request: {error}")}),
        };
        writer.write_all(format!("{reply}\n").as_bytes()).await?;
        writer.flush().await?;
    }
    Ok(())
}

fn string_param(params: &Value, key: &str) -> Result<String, String> {
    params.get(key).and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("Missing \"{key}\""))
}

async fn dispatch(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "ping" => Ok(json!({
            "app": "glint",
            "version": app.package_info().version.to_string(),
            "identifier": app.config().identifier,
        })),
        "editor_render" => {
            let path = string_param(&params, "path")?;
            let output = string_param(&params, "output")?;
            render_glint(app, &path, &output).await
        }
        "open" => {
            let path = string_param(&params, "path")?;
            open_path(app, &path)?;
            Ok(json!({"opened": path}))
        }
        other => Err(format!("Unknown method \"{other}\"")),
    }
}

/// Open a `.glint` in the editor, an image in the editor, or a video in Studio.
fn open_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let lower = path.to_lowercase();
    if !std::path::Path::new(path).is_file() {
        return Err(format!("No file at {path}"));
    }
    if lower.ends_with(".glint") {
        crate::editor::commands::project_open(app.clone(), app.state(), path.to_string())
    } else if crate::editor::commands::first_image_arg(&[path.to_string()]).is_some() {
        crate::editor::commands::open_image_path(app, path, false)
    } else if let Some(video) = crate::recorder::trim::first_video_arg(&[path.to_string()]) {
        crate::recorder::open_trim_for_external(app, video);
        Ok(())
    } else {
        Err("Glint opens .glint projects, images (PNG/JPEG/WebP/BMP/GIF) and videos (MP4/MOV/WebM/MKV/AVI).".into())
    }
}

// ─── Rendering .glint documents ─────────────────────────────────────────────

struct RenderJob {
    id: u64,
    image_data_url: String,
    width: u32,
    height: u32,
    doc: Value,
}
type Done = tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>;

#[derive(Default)]
struct Jobs {
    next_id: u64,
    queue: VecDeque<RenderJob>,
    waiting: HashMap<u64, Done>,
}
static JOBS: LazyLock<Mutex<Jobs>> = LazyLock::new(Default::default);

fn ensure_render_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(RENDER_LABEL).is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(app, RENDER_LABEL, tauri::WebviewUrl::App("index.html#/editor-render".into()))
        .title("Glint renderer")
        .inner_size(1600.0, 1000.0)
        .decorations(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|e| format!("Couldn't start the renderer: {e}"))
}

/// Render a `.glint` with the editor's own stage and write the PNG to `output`
/// (which must not exist — nothing is ever overwritten).
async fn render_glint(app: &AppHandle, path: &str, output: &str) -> Result<Value, String> {
    if std::path::Path::new(output).exists() {
        return Err(format!("{output} already exists; choose a new output path."));
    }
    let text = tokio::fs::read_to_string(path).await.map_err(|_| format!("Couldn't read {path}"))?;
    let parsed = crate::editor::document::parse(&text)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut jobs = JOBS.lock().unwrap();
        jobs.next_id += 1;
        let id = jobs.next_id;
        jobs.queue.push_back(RenderJob {
            id,
            image_data_url: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&parsed.png)),
            width: parsed.width,
            height: parsed.height,
            doc: parsed.doc,
        });
        jobs.waiting.insert(id, tx);
    }
    ensure_render_window(app)?;
    let _ = app.emit_to(RENDER_LABEL, "render-job", ());
    let png = match tokio::time::timeout(RENDER_TIMEOUT, rx).await {
        Ok(Ok(result)) => result?,
        Ok(Err(_)) => return Err("The renderer stopped before finishing.".into()),
        Err(_) => return Err("Rendering timed out.".into()),
    };
    let decoded = image::load_from_memory(&png).map_err(|e| format!("The renderer produced an unreadable image: {e}"))?;
    tokio::fs::write(output, &png).await.map_err(|e| format!("Couldn't write {output}: {e}"))?;
    Ok(json!({"output": output, "width": decoded.width(), "height": decoded.height()}))
}

/// The render window pulls its next job (or null when idle).
#[tauri::command]
pub fn render_job_next(window: tauri::WebviewWindow) -> Result<Option<Value>, String> {
    if window.label() != RENDER_LABEL {
        return Err("Only the renderer can take render jobs".into());
    }
    Ok(JOBS.lock().unwrap().queue.pop_front().map(|job| {
        json!({"id": job.id, "image_data_url": job.image_data_url, "width": job.width, "height": job.height, "doc": job.doc})
    }))
}

/// The render window reports a finished job: base64 PNG, or an error message.
#[tauri::command(async)]
pub fn render_job_done(window: tauri::WebviewWindow, id: u64, png: Option<String>, error: Option<String>) -> Result<(), String> {
    if window.label() != RENDER_LABEL {
        return Err("Only the renderer can finish render jobs".into());
    }
    let Some(done) = JOBS.lock().unwrap().waiting.remove(&id) else { return Ok(()) };
    let result = match (png, error) {
        (Some(png), _) => base64::engine::general_purpose::STANDARD.decode(png).map_err(|e| e.to_string()),
        (None, Some(error)) => Err(error),
        (None, None) => Err("The renderer returned nothing.".into()),
    };
    let _ = done.send(result);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipe_names_are_per_app_identifier() {
        assert_eq!(pipe_name("com.glint.app"), r"\\.\pipe\com.glint.app-control");
        assert_ne!(pipe_name("com.glint.app"), pipe_name("com.glint.preview.pr1"));
    }

}
