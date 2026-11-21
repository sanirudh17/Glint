//! Whole-app control for the Glint MCP, served over the control channel.
//!
//! Every action reuses the path a person's click or hotkey takes, so behaviour
//! and feedback are identical:
//! - settings and hotkeys run the main window's own store actions (validation,
//!   persistence, theme broadcast, taskbar/Explorer side effects) via a small
//!   pull queue the main window drains (`agent_next` / `agent_done`);
//! - captures and recordings call the same native entry points as the hotkeys
//!   and the recording selector, then wait for the result to land.
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const MAIN_LABEL: &str = "main";
const MAIN_TIMEOUT: Duration = Duration::from_secs(30);

type Reply = tokio::sync::oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
struct Queue {
    next_id: u64,
    pending: VecDeque<(u64, Value)>,
    waiting: HashMap<u64, Reply>,
}
static QUEUE: LazyLock<Mutex<Queue>> = LazyLock::new(Default::default);

/// Run `{op, args}` in the main window's store and wait for its answer.
async fn main_request(app: &AppHandle, op: &str, args: Value) -> Result<Value, String> {
    if app.get_webview_window(MAIN_LABEL).is_none() {
        return Err("Glint's main window isn't available.".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let id = {
        let mut q = QUEUE.lock().unwrap();
        q.next_id += 1;
        let id = q.next_id;
        q.pending.push_back((id, json!({"id": id, "op": op, "args": args})));
        q.waiting.insert(id, tx);
        id
    };
    let _ = app.emit_to(MAIN_LABEL, "agent-request", ());
    match tokio::time::timeout(MAIN_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Glint's main window stopped before answering.".into()),
        Err(_) => {
            let mut q = QUEUE.lock().unwrap();
            q.pending.retain(|(i, _)| *i != id);
            q.waiting.remove(&id);
            Err("Glint's main window didn't answer in time (is it still starting?).".into())
        }
    }
}

/// The main window pulls its next agent request (or null).
#[tauri::command]
pub fn agent_next(window: tauri::WebviewWindow) -> Result<Option<Value>, String> {
    if window.label() != MAIN_LABEL {
        return Err("Only the main window serves agent requests".into());
    }
    Ok(QUEUE.lock().unwrap().pending.pop_front().map(|(_, request)| request))
}

/// The main window answers an agent request.
#[tauri::command]
pub fn agent_done(window: tauri::WebviewWindow, id: u64, result: Option<Value>, error: Option<String>) -> Result<(), String> {
    if window.label() != MAIN_LABEL {
        return Err("Only the main window serves agent requests".into());
    }
    if let Some(reply) = QUEUE.lock().unwrap().waiting.remove(&id) {
        let _ = reply.send(match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

fn last_capture_path(app: &AppHandle) -> Option<String> {
    app.state::<crate::capture::LastCaptureState>().0.lock().unwrap().as_ref().map(|c| c.path.clone())
}

fn newest_recording(app: &AppHandle) -> Option<(i64, String)> {
    let db = app.state::<crate::Db>();
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT id, path FROM captures WHERE kind = 'recording' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

fn mode(params: &Value) -> Result<crate::capture::CaptureMode, String> {
    use std::str::FromStr;
    let mode = params.get("mode").and_then(Value::as_str).unwrap_or("fullscreen");
    crate::capture::CaptureMode::from_str(mode).map_err(|_| format!("Unknown capture mode \"{mode}\" (area, window or fullscreen)."))
}

/// Take a screenshot like the hotkey does and wait for it to be committed.
async fn capture(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let mode = mode(params)?;
    let delayed = params.get("delayed").and_then(Value::as_bool).unwrap_or(false);
    let monitor = params.get("monitor").and_then(Value::as_u64).unwrap_or(0) as u32;
    let interactive = !matches!(mode, crate::capture::CaptureMode::Fullscreen);
    let wait = Duration::from_secs(params.get("wait_seconds").and_then(Value::as_u64).unwrap_or(if interactive { 90 } else { 20 }).min(300));
    let before = last_capture_path(app);
    let handle = app.clone();
    if delayed {
        crate::capture::begin_delayed_spawned(&handle, mode);
    } else {
        std::thread::spawn(move || crate::capture::begin_on(&handle, mode, false, crate::capture::CaptureIntent::Screenshot, monitor));
    }
    let started = Instant::now();
    let mut nudged = Instant::now() - Duration::from_secs(1);
    loop {
        tokio::time::sleep(Duration::from_millis(150)).await;
        // Fullscreen waits for a confirming click; confirm it the way a click does,
        // repeating until the overlay has mounted (its commit fires only once).
        if !interactive && nudged.elapsed() >= Duration::from_millis(300) {
            let _ = app.emit("capture-agent-confirm", ());
            nudged = Instant::now();
        }
        if let Some(path) = last_capture_path(app).filter(|p| Some(p) != before.as_ref()) {
            let (width, height) = app
                .state::<crate::capture::LastCaptureState>()
                .0
                .lock()
                .unwrap()
                .as_ref()
                .map(|c| (c.width, c.height))
                .unwrap_or((0, 0));
            return Ok(json!({"path": path, "width": width, "height": height}));
        }
        if started.elapsed() > wait {
            return Err(if interactive {
                "No capture yet: Glint is waiting for the user to select an area or window (or they cancelled).".into()
            } else {
                "The capture didn't complete in time.".into()
            });
        }
    }
}

fn bool_param(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(Value::as_bool)
}

/// Start a recording without the selector: fullscreen or an exact region.
async fn record_start(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let settings = app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().clone();
    let region = params.get("region");
    let int = |k: &str| region.and_then(|r| r.get(k)).and_then(Value::as_i64);
    let mode = if region.is_some() { "region" } else { "fullscreen" };
    if mode == "region" && [int("x"), int("y"), int("w"), int("h")].iter().any(Option::is_none) {
        return Err("A region needs x, y, w and h in screen pixels.".into());
    }
    crate::recorder::recorder_start(
        app.clone(),
        mode.into(),
        int("x").map(|v| v as i32),
        int("y").map(|v| v as i32),
        int("w").map(|v| v as u32),
        int("h").map(|v| v as u32),
        Some(bool_param(params, "system_audio").unwrap_or(settings.record_system_audio)),
        Some(bool_param(params, "microphone").unwrap_or(settings.record_microphone)),
        Some(bool_param(params, "webcam").unwrap_or(settings.record_webcam)),
        Some(settings.record_webcam_movable),
        Some(bool_param(params, "click_effects").unwrap_or(settings.record_click_viz)),
        Some(bool_param(params, "keystrokes").unwrap_or(settings.record_keystrokes)),
        Some(bool_param(params, "spotlight").unwrap_or(settings.record_cursor_spotlight)),
        Some(settings.record_cursor_hide),
        Some(settings.record_cursor_size.clone()),
        Some(bool_param(params, "studio").unwrap_or(true)),
    )
    .await?;
    Ok(json!({"recording": true, "mode": mode}))
}

/// Stop the recording and wait for the saved file.
async fn record_stop(app: &AppHandle) -> Result<Value, String> {
    if crate::recorder::recorder_status(app.clone()).is_none() {
        return Err("Glint isn't recording.".into());
    }
    let before = newest_recording(app).map(|(id, _)| id);
    crate::recorder::recorder_stop(app.clone()).await?;
    let started = Instant::now();
    loop {
        if let Some((id, path)) = newest_recording(app).filter(|(id, _)| Some(*id) != before) {
            return Ok(json!({"id": id, "path": path}));
        }
        if started.elapsed() > Duration::from_secs(120) {
            return Err("The recording stopped but its file wasn't saved in time.".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn show(app: &AppHandle, params: &Value) -> Result<Value, String> {
    let page = params.get("page").and_then(Value::as_str).unwrap_or("home");
    let route = match page {
        "home" => "/home",
        "library" => "/library",
        "settings" => "/settings",
        other => return Err(format!("Unknown page \"{other}\" (home, library or settings).")),
    };
    crate::window::reopen_from_tray(app);
    let _ = app.emit("navigate", route);
    Ok(json!({"shown": page}))
}

/// `Some(result)` for the methods handled here; `None` for unknown methods.
pub async fn dispatch(app: &AppHandle, method: &str, params: Value) -> Option<Result<Value, String>> {
    Some(match method {
        "settings_get" => main_request(app, "settings_get", Value::Null).await.map(|mut s| {
            s["launch_at_startup"] = json!(crate::settings::commands::autostart_get());
            s
        }),
        "settings_set" => settings_set(app, params).await,
        "hotkey_set" => main_request(app, "hotkey_set", params).await,
        "hotkeys_reset" => main_request(app, "hotkeys_reset", Value::Null).await,
        "show" => show(app, &params),
        "capture" => capture(app, &params).await,
        "capture_scroll" => crate::capture::scrolling::capture_scroll_begin(app.clone()).map(|_| json!({"started": true})),
        "monitors" => crate::capture::frozen::monitors().map_err(|e| e.to_string()).map(|monitors| {
            json!(monitors
                .iter()
                .enumerate()
                .map(|(i, m)| json!({"monitor": i, "x": m.x().unwrap_or(0), "y": m.y().unwrap_or(0), "width": m.width().unwrap_or(0), "height": m.height().unwrap_or(0), "scale": m.scale_factor().unwrap_or(1.)}))
                .collect::<Vec<_>>())
        }),
        "record_start" => record_start(app, &params).await,
        "record_stop" => record_stop(app).await,
        "record_status" => Ok(json!(crate::recorder::recorder_status(app.clone()))),
        "record_pause" => crate::recorder::recorder_pause(app.clone()).await.map(|_| json!({"paused": true})),
        "record_resume" => crate::recorder::recorder_resume(app.clone()).await.map(|_| json!({"paused": false})),
        "record_cancel" => crate::recorder::recorder_cancel(app.clone()).await.map(|_| json!({"cancelled": true})),
        _ => return None,
    })
}

/// `launch_at_startup` is an OS setting handled natively; everything else goes
/// through the Settings page's own store actions in the main window.
async fn settings_set(app: &AppHandle, params: Value) -> Result<Value, String> {
    let mut changes = params.get("changes").and_then(Value::as_object).cloned().ok_or("Missing \"changes\"")?;
    if let Some(on) = changes.remove("launch_at_startup") {
        crate::settings::commands::autostart_set(on.as_bool().ok_or("launch_at_startup must be true or false")?)?;
    }
    let mut result = if changes.is_empty() {
        main_request(app, "settings_get", Value::Null).await?
    } else {
        main_request(app, "settings_set", json!({"changes": changes})).await?
    };
    result["launch_at_startup"] = json!(crate::settings::commands::autostart_get());
    Ok(result)
}
