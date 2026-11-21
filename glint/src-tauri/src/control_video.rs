//! Video work for the Glint MCP, served over the control channel (`crate::control`).
//!
//! Quick calls (probe, import, frames) answer directly. Anything that can run for
//! minutes (export, silence analysis, caption engine download, transcription)
//! starts a *task* and answers at once with its id; the agent then polls
//! `task_status` (with progress) or `task_cancel`. Agent clients time out on long
//! requests, so no request here ever waits on a long job.
//!
//! Every task reuses the exact command the Trim window runs, and takes the same
//! one-at-a-time slot, so an agent can never run an export alongside the user's.
use crate::recorder::{captions, gif, polish, studio, studio_export, trim};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const MAX_FRAMES: usize = 12;
const FINISHED_TASK_TTL: Duration = Duration::from_secs(3600);

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Export,
    Polish,
}

enum State {
    Running,
    Done(Value),
    Failed(String),
}

struct Task {
    kind: Kind,
    label: String,
    cancel: Option<Arc<AtomicBool>>,
    state: State,
    started: Instant,
    finished: Option<Instant>,
}

static TASKS: LazyLock<Mutex<HashMap<u64, Task>>> = LazyLock::new(Default::default);
/// Seeded from the clock so ids from an earlier app run are never mistaken for new ones.
static NEXT_TASK: LazyLock<AtomicU64> = LazyLock::new(|| {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() % 100_000).unwrap_or(0);
    AtomicU64::new(seed * 1000)
});

fn spawn_task<F>(kind: Kind, label: &str, cancel: Option<Arc<AtomicBool>>, work: F) -> Value
where
    F: std::future::Future<Output = Result<Value, String>> + Send + 'static,
{
    let id = NEXT_TASK.fetch_add(1, Ordering::Relaxed) + 1;
    {
        let mut tasks = TASKS.lock().unwrap();
        tasks.retain(|_, t| t.finished.is_none_or(|at| at.elapsed() < FINISHED_TASK_TTL));
        tasks.insert(
            id,
            Task { kind, label: label.to_string(), cancel, state: State::Running, started: Instant::now(), finished: None },
        );
    }
    tauri::async_runtime::spawn(async move {
        let result = work.await;
        if let Some(task) = TASKS.lock().unwrap().get_mut(&id) {
            task.state = match result {
                Ok(value) => State::Done(value),
                Err(error) => State::Failed(error),
            };
            task.finished = Some(Instant::now());
        }
    });
    json!({"task": id, "state": "running", "label": label})
}

fn task_status(id: u64) -> Result<Value, String> {
    let tasks = TASKS.lock().unwrap();
    let task = tasks.get(&id).ok_or_else(|| format!("No task {id} (finished tasks are kept for an hour; Glint may have restarted)."))?;
    let elapsed = task.finished.unwrap_or_else(Instant::now).duration_since(task.started).as_secs_f64();
    Ok(match &task.state {
        State::Running => {
            let progress = match task.kind {
                Kind::Export => studio_export::progress(),
                Kind::Polish => polish::progress(),
            };
            json!({"task": id, "label": task.label, "state": "running", "progress": (progress * 10.).round() / 10., "elapsed_seconds": elapsed.round()})
        }
        State::Done(result) => json!({"task": id, "label": task.label, "state": "done", "progress": 100, "elapsed_seconds": elapsed.round(), "result": result}),
        State::Failed(error) => {
            // A cancelled export can surface as a broken-pipe error from ffmpeg.
            let flagged = task.cancel.as_ref().is_some_and(|flag| flag.load(Ordering::Relaxed));
            let cancelled = flagged || error.to_lowercase().contains("cancel");
            json!({"task": id, "label": task.label, "state": if cancelled { "cancelled" } else { "failed" }, "error": error, "elapsed_seconds": elapsed.round()})
        }
    })
}

fn task_cancel(id: u64) -> Result<Value, String> {
    let tasks = TASKS.lock().unwrap();
    let task = tasks.get(&id).ok_or_else(|| format!("No task {id}."))?;
    if !matches!(task.state, State::Running) {
        return Ok(json!({"task": id, "cancelled": false, "reason": "already finished"}));
    }
    match (&task.cancel, task.kind) {
        (Some(flag), _) => flag.store(true, Ordering::Relaxed),
        (None, Kind::Polish) => polish::studio_polish_cancel(),
        (None, Kind::Export) => {}
    }
    Ok(json!({"task": id, "cancelled": true}))
}

fn str_param<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params.get(key).and_then(Value::as_str).ok_or_else(|| format!("Missing \"{key}\""))
}

fn existing_video(params: &Value) -> Result<String, String> {
    let path = str_param(params, "path")?.to_string();
    if !std::path::Path::new(&path).is_file() {
        return Err(format!("No video file at {path}"));
    }
    Ok(path)
}

fn studio_video(params: &Value) -> Result<(String, std::path::PathBuf), String> {
    let path = existing_video(params)?;
    let folder = studio::project_folder(&path).ok_or("This video isn't a Studio project yet. Call video_open first.")?;
    Ok((path, folder))
}

fn probe_json(probe: &trim::ProbeResult) -> Value {
    json!({
        "duration": probe.duration_secs,
        "width": probe.width,
        "height": probe.height,
        "fps": probe.fps,
        "has_audio": probe.has_audio,
        "has_webcam": probe.has_cam,
    })
}

/// `Some(result)` for the methods handled here; `None` for unknown methods.
pub async fn dispatch(app: &AppHandle, method: &str, params: Value) -> Option<Result<Value, String>> {
    Some(match method {
        "video_probe" => probe(app, &params).await,
        "video_import" => import(app, &params).await,
        "video_frames" => frames(app, &params).await,
        "video_export_start" => export_start(app, &params),
        "video_silence_start" => silence_start(app, &params),
        "captions_status" => captions::studio_captions_status(app.clone()).map(|ready| json!({"installed": ready})),
        "captions_install_start" => Ok(spawn_task(Kind::Polish, "Download caption engine", None, {
            let app = app.clone();
            async move { captions::studio_captions_install(app).await.map(|_| json!({"installed": true})) }
        })),
        "captions_generate_start" => captions_start(app, &params).await,
        "task_status" => params.get("task").and_then(Value::as_u64).ok_or_else(|| "Missing \"task\"".to_string()).and_then(task_status),
        "task_cancel" => params.get("task").and_then(Value::as_u64).ok_or_else(|| "Missing \"task\"".to_string()).and_then(task_cancel),
        _ => return None,
    })
}

async fn probe(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = existing_video(params)?;
    let probe = trim::recorder_trim_probe(app.clone(), path.clone()).await?;
    let mut out = probe_json(&probe);
    out["studio_project"] = json!(studio::project_folder(&path).map(|f| f.to_string_lossy().to_string()));
    out["open_in_trim"] = json!(open_in_trim(app, &path));
    Ok(out)
}

/// Whether the visible Trim window is editing this video (its autosave would win).
fn open_in_trim(app: &AppHandle, path: &str) -> bool {
    let visible = app
        .get_webview_window(crate::recorder::windows::TRIM_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let same = |a: &str| {
        let canon = |p: &str| std::fs::canonicalize(p).map(|p| p.to_string_lossy().to_lowercase()).unwrap_or_else(|_| p.to_lowercase());
        canon(a) == canon(path)
    };
    visible
        && app
            .state::<crate::recorder::RecorderTrimState>()
            .0
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|target| same(&target.path))
}

/// Make (or reuse) the Studio project beside a video, as opening it in Trim does.
async fn import(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = existing_video(params)?;
    let probe = trim::recorder_trim_probe(app.clone(), path.clone()).await?;
    studio::studio_import(app.clone(), path.clone()).await?;
    let folder = studio::project_folder(&path).ok_or("Studio project could not be prepared")?;
    let mut out = probe_json(&probe);
    out["path"] = json!(path);
    out["studio_project"] = json!(folder.to_string_lossy());
    Ok(out)
}

/// Still frames at source times, as base64 JPEGs, for an agent to look at.
async fn frames(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = existing_video(params)?;
    let times: Vec<f64> = params
        .get("times")
        .and_then(Value::as_array)
        .ok_or("Missing \"times\"")?
        .iter()
        .map(|t| t.as_f64().filter(|t| t.is_finite() && *t >= 0.).ok_or("Times must be seconds ≥ 0"))
        .collect::<Result<_, _>>()?;
    if times.is_empty() || times.len() > MAX_FRAMES {
        return Err(format!("Ask for 1–{MAX_FRAMES} frames at a time."));
    }
    let width = params.get("width").and_then(Value::as_u64).unwrap_or(960).clamp(160, 1920);
    let probe = trim::recorder_trim_probe(app.clone(), path.clone()).await?;
    let binary = polish::ffmpeg(app)?;
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let workspace = crate::recorder::scene_commands::Workspace::temporary()?;
        let never = AtomicBool::new(false);
        let mut out = Vec::new();
        for (i, t) in times.iter().enumerate() {
            let t = t.min((probe.duration_secs - 0.05).max(0.));
            let file = workspace.0.join(format!("frame{i}.jpg"));
            let mut cmd = polish::command(&binary);
            cmd.args(["-y", "-v", "error", "-ss", &format!("{t:.3}"), "-i", &path, "-frames:v", "1"])
                .args(["-vf", &format!("scale='min({width},iw)':-2"), "-q:v", "4"])
                .arg(&file);
            polish::run(cmd, &never, Duration::from_secs(30))?;
            let bytes = std::fs::read(&file).map_err(|_| format!("No frame at {t:.2}s"))?;
            out.push(json!({"t": t, "jpeg": base64::engine::general_purpose::STANDARD.encode(bytes)}));
        }
        Ok(json!({"frames": out, "duration": probe.duration_secs}))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Export the Studio project to MP4 (default) or GIF in the background.
fn export_start(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let (path, folder) = studio_video(params)?;
    let format = params.get("format").and_then(Value::as_str).unwrap_or("mp4").to_string();
    let options = match format.as_str() {
        "mp4" => None,
        "gif" => {
            let options = gif::Options {
                fps: params.get("fps").and_then(Value::as_u64).unwrap_or(15) as u32,
                width: params.get("width").and_then(Value::as_u64).unwrap_or(960) as u32,
                repeat: params.get("repeat").and_then(Value::as_bool).unwrap_or(true),
            };
            options.validate()?;
            Some(options)
        }
        other => return Err(format!("Unknown format \"{other}\" (use mp4 or gif).")),
    };
    let project: Value = serde_json::from_slice(&std::fs::read(folder.join("project.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    // Take the single export slot now, so a clash is reported immediately.
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<studio_export::ExportState>();
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err("An export is already running (yours or one started in Glint). Wait for it, or cancel it.".into());
        }
        *slot = Some(cancel.clone());
    }
    studio_export::PROGRESS.store(0f64.to_bits(), Ordering::Relaxed);
    let label = format!("Export {}", format.to_uppercase());
    let app = app.clone();
    let flag = cancel.clone();
    Ok(spawn_task(Kind::Export, &label, Some(cancel), async move {
        let result = run_export(&app, &path, project, options, flag).await;
        *app.state::<studio_export::ExportState>().0.lock().unwrap() = None;
        result
    }))
}

async fn run_export(
    app: &AppHandle,
    path: &str,
    project: Value,
    gif_options: Option<gif::Options>,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let project = prepare_for_export(app, path, project).await?;
    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled".into());
    }
    let fade_in = project.get("fadeIn").and_then(Value::as_f64).unwrap_or(0.);
    let fade_out = project.get("fadeOut").and_then(Value::as_f64).unwrap_or(0.);
    let output = match gif_options {
        None => studio_export::perform(app, path, project, cancel, None).await?,
        Some(options) => gif::perform(app, path, Some(project), Vec::new(), fade_in, fade_out, None, options, cancel).await?,
    };
    let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    Ok(json!({"output": output, "bytes": bytes}))
}

/// Captions and drawn marks are painted by the webview (the same painter the
/// Trim preview uses) before the native renderer can composite them.
async fn prepare_for_export(app: &AppHandle, path: &str, project: Value) -> Result<Value, String> {
    let has = |key: &str| project.get(key).and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    if !has("captions") && !has("annotations") {
        return Ok(project);
    }
    let probe = trim::recorder_trim_probe(app.clone(), path.to_string()).await?;
    crate::control::run_render_job(
        app,
        json!({"kind": "prepare-video", "project": project, "width": probe.width, "height": probe.height}),
    )
    .await
}

fn silence_start(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = existing_video(params)?;
    let app = app.clone();
    Ok(spawn_task(Kind::Polish, "Find silence", None, async move {
        let spans = polish::studio_analyze_silence(app, path).await?;
        Ok(json!({"silences": spans}))
    }))
}

async fn captions_start(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let path = existing_video(params)?;
    if !captions::studio_captions_status(app.clone())? {
        return Err("The caption engine isn't installed. Run video_captions with install: true first (a one-time download).".into());
    }
    let probe = trim::recorder_trim_probe(app.clone(), path.clone()).await?;
    let app = app.clone();
    Ok(spawn_task(Kind::Polish, "Transcribe captions", None, async move {
        let lines = captions::studio_captions_generate(app, path, probe.duration_secs).await?;
        Ok(json!({"captions": lines}))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tasks_report_progress_then_results_and_unknown_ids_fail_readably() {
        let id = NEXT_TASK.fetch_add(1, Ordering::Relaxed) + 1;
        TASKS.lock().unwrap().insert(
            id,
            Task { kind: Kind::Polish, label: "Test".into(), cancel: None, state: State::Running, started: Instant::now(), finished: None },
        );
        assert_eq!(task_status(id).unwrap()["state"], "running");
        TASKS.lock().unwrap().get_mut(&id).unwrap().state = State::Failed("Export cancelled".into());
        assert_eq!(task_status(id).unwrap()["state"], "cancelled");
        TASKS.lock().unwrap().get_mut(&id).unwrap().state = State::Done(json!({"output": "x.mp4"}));
        let done = task_status(id).unwrap();
        assert_eq!(done["state"], "done");
        assert_eq!(done["result"]["output"], "x.mp4");
        assert_eq!(task_cancel(id).unwrap()["cancelled"], false);
        assert!(task_status(u64::MAX).unwrap_err().contains("No task"));
    }

    #[test]
    fn cancelling_a_running_task_sets_its_own_flag() {
        let id = NEXT_TASK.fetch_add(1, Ordering::Relaxed) + 1;
        let flag = Arc::new(AtomicBool::new(false));
        TASKS.lock().unwrap().insert(
            id,
            Task { kind: Kind::Export, label: "Export MP4".into(), cancel: Some(flag.clone()), state: State::Running, started: Instant::now(), finished: None },
        );
        assert_eq!(task_cancel(id).unwrap()["cancelled"], true);
        assert!(flag.load(Ordering::Relaxed));
    }
}
