//! What agents did in Glint, for Settings → Agents.
//!
//! `glint-mcp` (or `glint.exe --mcp`) appends one JSON line per session start
//! and per tool call to `agent-activity.jsonl` in the app's data folder; the app
//! reads it. A file, not the control channel, so file-only tools are recorded
//! even when Glint isn't running. Only the tool, the file *name* it acted on and
//! a few small details (e.g. `theme: light`) are kept — never file contents —
//! and the log is capped.
use serde_json::{json, Map, Value};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

pub const LOG_FILE: &str = "agent-activity.jsonl";
const MAX_BYTES: u64 = 256 * 1024;
const KEEP_LINES: usize = 400;

/// The app's data folder: `GLINT_DATA_DIR`, else `%APPDATA%\<app id>`.
fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("GLINT_DATA_DIR") {
        return Some(PathBuf::from(dir));
    }
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join(super::bridge::app_identifier()))
}

struct Session {
    id: String,
    client: String,
    version: String,
}
static SESSION: OnceLock<Session> = OnceLock::new();

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Record the session once, when the client identifies itself.
pub fn session_started(client: &str, version: &str) {
    let mut fresh = false;
    let session = SESSION.get_or_init(|| {
        fresh = true;
        Session { id: format!("{}-{}", std::process::id(), now_ms()), client: client.to_string(), version: version.to_string() }
    });
    if fresh {
        let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())).unwrap_or_default();
        append(json!({"t": now_ms(), "kind": "session", "s": session.id, "pid": std::process::id(), "exe": exe, "client": session.client, "version": session.version}));
    }
}

/// Tools that only look; recorded as `read` so the app can show actions only.
fn is_read_only(tool: &str) -> bool {
    matches!(
        tool,
        "library_search" | "image_info" | "editor_read" | "editor_catalog" | "video_read" | "video_frames"
            | "video_analyze" | "task_status" | "settings_get" | "list_monitors"
    )
}

fn file_name(value: &Value) -> Option<String> {
    let path = value.as_str()?;
    std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().chars().take(120).collect())
}

fn small(value: &Value) -> Value {
    match value {
        Value::String(s) => json!(s.chars().take(48).collect::<String>()),
        Value::Bool(_) | Value::Number(_) | Value::Null => value.clone(),
        _ => json!("…"),
    }
}

/// The few details that make an entry readable ("theme → light", "mp4").
fn detail(tool: &str, args: &Map<String, Value>) -> Value {
    let pick = |keys: &[&str]| -> Value {
        Value::Object(keys.iter().filter_map(|k| args.get(*k).map(|v| (k.to_string(), small(v)))).collect())
    };
    match tool {
        "settings_set" => match args.get("changes") {
            Some(Value::Object(changes)) => Value::Object(changes.iter().take(6).map(|(k, v)| (k.clone(), small(v))).collect()),
            _ => json!({}),
        },
        "hotkey_set" => pick(&["action", "accelerator"]),
        "capture_screenshot" => pick(&["mode"]),
        "video_export" => pick(&["format"]),
        "show_glint" => pick(&["page"]),
        "recording_control" => pick(&["action"]),
        "image_round_corners" => pick(&["percent"]),
        "video_edit" | "editor_edit" => json!({"edits": args.get("edits").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0)}),
        _ => json!({}),
    }
}

/// The file an action produced, from the tool's JSON reply, else the file it was given.
fn target(args: &Map<String, Value>, reply: Option<&Value>) -> Option<String> {
    let produced = reply.and_then(|r| r.get("output").or_else(|| r.get("result").and_then(|x| x.get("output"))).or_else(|| r.get("path")));
    produced
        .and_then(file_name)
        .or_else(|| ["path", "image"].iter().find_map(|k| args.get(*k).and_then(file_name)))
}

/// Record one tool call. `reply` is the first text block parsed as JSON, if any.
pub fn tool_called(tool: &str, args: &Map<String, Value>, ok: bool, reply: Option<&Value>) {
    let Some(session) = SESSION.get() else { return };
    // A background job that is still running reports again when it finishes (task_status).
    let state = reply.and_then(|r| r.get("state")).and_then(Value::as_str).unwrap_or(if ok { "done" } else { "failed" });
    append(json!({
        "t": now_ms(), "kind": "tool", "s": session.id, "client": session.client, "tool": tool,
        "read": is_read_only(tool), "ok": ok, "state": state, "target": target(args, reply), "detail": detail(tool, args),
    }));
}

fn append(entry: Value) {
    let Some(dir) = data_dir() else { return };
    // Only beside an existing Glint install's data; never create a stray folder.
    if !dir.is_dir() {
        return;
    }
    let path = dir.join(LOG_FILE);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = text.lines().collect();
            let kept = lines[lines.len().saturating_sub(KEEP_LINES)..].join("\n") + "\n";
            let tmp = path.with_extension("jsonl.tmp");
            if std::fs::write(&tmp, kept).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(format!("{entry}\n").as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_keep_names_and_small_details_only() {
        let args = json!({"path": "C:\\Users\\a\\Videos\\demo.mp4", "changes": {"theme": "light", "save_dir": "x".repeat(200)}})
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(target(&args, None).as_deref(), Some("demo.mp4"));
        let reply = json!({"state": "done", "result": {"output": "C:\\Users\\a\\Videos\\demo (Studio).mp4"}});
        assert_eq!(target(&args, Some(&reply)).as_deref(), Some("demo (Studio).mp4"));
        let d = detail("settings_set", &args);
        assert_eq!(d["theme"], "light");
        assert_eq!(d["save_dir"].as_str().unwrap().len(), 48, "long values are cut short");
        assert!(is_read_only("settings_get") && !is_read_only("settings_set"));
    }
}
