//! End-to-end: drive the real `glint-mcp` binary over stdio exactly as an agent
//! does (line-delimited JSON-RPC), against a throwaway library and images.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct Client {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl Client {
    fn start(data_dir: &PathBuf) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_glint-mcp"))
            .env("GLINT_DATA_DIR", data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("start glint-mcp");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut client = Self { child, stdin, stdout, next_id: 1 };
        let init = client.request(
            "initialize",
            json!({"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "glint-test", "version": "1"}}),
        );
        assert_eq!(init["result"]["serverInfo"]["name"], "glint", "{init}");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        client.send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
        client
    }

    fn send(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        loop {
            let mut line = String::new();
            assert!(self.stdout.read_line(&mut line).unwrap() > 0, "glint-mcp closed stdout");
            let message: Value = serde_json::from_str(&line).unwrap_or_else(|e| panic!("non-JSON on stdout ({e}): {line}"));
            if message["id"] == id {
                return message;
            }
        }
    }

    /// Like `request`, also returning the notifications received before the reply.
    fn request_collecting(&mut self, method: &str, params: Value) -> (Vec<Value>, Value) {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        let mut notes = Vec::new();
        loop {
            let mut line = String::new();
            assert!(self.stdout.read_line(&mut line).unwrap() > 0, "glint-mcp closed stdout");
            let message: Value = serde_json::from_str(&line).unwrap();
            if message["id"] == id {
                return (notes, message);
            }
            notes.push(message);
        }
    }

    /// Call a tool; returns (is_error, first text content).
    fn call(&mut self, name: &str, arguments: Value) -> (bool, String) {
        let response = self.request("tools/call", json!({"name": name, "arguments": arguments}));
        let result = &response["result"];
        assert!(result.is_object(), "protocol error for {name}: {response}");
        let text = result["content"][0]["text"].as_str().unwrap_or_default().to_string();
        (result["isError"].as_bool().unwrap_or(false), text)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glint-mcp-e2e-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn lists_tools_with_safety_annotations() {
    let dir = workspace("list");
    let mut client = Client::start(&dir);
    let tools = client.request("tools/list", json!({}));
    let tools = tools["result"]["tools"].as_array().unwrap().clone();
    let by_name = |n: &str| tools.iter().find(|t| t["name"] == n).unwrap_or_else(|| panic!("missing tool {n}")).clone();
    assert_eq!(by_name("library_search")["annotations"]["readOnlyHint"], true);
    assert_eq!(by_name("image_info")["annotations"]["readOnlyHint"], true);
    let trim = by_name("image_trim");
    assert_eq!(trim["annotations"]["destructiveHint"], false);
    assert!(trim["inputSchema"]["properties"]["path"].is_object());
    assert_eq!(trim["inputSchema"]["required"], json!(["path"]));
}

#[test]
fn trims_a_rounded_square_to_its_edges_without_touching_the_original() {
    let dir = workspace("trim");
    let input = dir.join("logo.png");
    let mut image = image::RgbaImage::from_pixel(120, 80, image::Rgba([0, 0, 0, 0]));
    for y in 15..55 {
        for x in 30..90 {
            image.put_pixel(x, y, image::Rgba([40, 90, 220, 255]));
        }
    }
    image.save(&input).unwrap();
    let original = std::fs::read(&input).unwrap();

    let mut client = Client::start(&dir);
    let (is_error, info) = client.call("image_info", json!({"path": input}));
    assert!(!is_error, "{info}");
    let info: Value = serde_json::from_str(&info).unwrap();
    assert_eq!(info["content_bounds"], json!({"x": 30, "y": 15, "width": 60, "height": 40}));

    let (is_error, result) = client.call("image_trim", json!({"path": input}));
    assert!(!is_error, "{result}");
    let result: Value = serde_json::from_str(&result).unwrap();
    let output = PathBuf::from(result["output"].as_str().unwrap());
    assert_eq!(output.file_name().unwrap(), "logo (trimmed).png");
    let trimmed = image::open(&output).unwrap();
    assert_eq!((trimmed.width(), trimmed.height()), (60, 40));
    assert_eq!(std::fs::read(&input).unwrap(), original, "the original must never change");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn failures_come_back_as_readable_tool_errors() {
    let dir = workspace("errors");
    let mut client = Client::start(&dir);
    let (is_error, message) = client.call("image_trim", json!({"path": dir.join("missing.png")}));
    assert!(is_error);
    assert!(message.contains("No image file"), "{message}");
    let (is_error, message) = client.call("library_search", json!({}));
    assert!(is_error, "no glint.db in this data dir");
    assert!(message.contains("No Glint library"), "{message}");
}

#[test]
fn searches_the_library_read_only() {
    let dir = workspace("library");
    let db = dir.join("glint.db");
    {
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch(
            "CREATE TABLE captures (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, thumb_path TEXT,
               width INTEGER, height INTEGER, duration_ms INTEGER, bytes INTEGER, app_name TEXT, window_title TEXT,
               created_at INTEGER NOT NULL, deleted_at INTEGER, title TEXT);
             INSERT INTO captures (id, kind, path, created_at, title) VALUES
               (1, 'screenshot', 'C:\\cap\\receipt.png', 1793000000, NULL),
               (2, 'recording', 'C:\\cap\\demo.mp4', 1793100000, 'Launch demo');",
        )
        .unwrap();
    }
    let before = std::fs::read(&db).unwrap();
    let mut client = Client::start(&dir);
    let (is_error, text) = client.call("library_search", json!({"query": "launch"}));
    assert!(!is_error, "{text}");
    let hits: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["name"], "Launch demo");
    let (_, text) = client.call("library_search", json!({"kind": "screenshot"}));
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap()[0]["id"], 1);
    drop(client);
    assert_eq!(std::fs::read(&db).unwrap(), before, "the library file must not be written");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn edits_editor_documents_without_the_app() {
    let dir = workspace("editor");
    let image = dir.join("page.png");
    image::RgbaImage::from_pixel(300, 200, image::Rgba([250, 250, 250, 255])).save(&image).unwrap();
    let mut client = Client::start(&dir);

    let (is_error, created) = client.call("editor_create", json!({"image": image}));
    assert!(!is_error, "{created}");
    let created: Value = serde_json::from_str(&created).unwrap();
    let doc = created["path"].as_str().unwrap().to_string();
    assert!(doc.ends_with("page.glint"));

    let (is_error, edited) = client.call("editor_edit", json!({"path": doc, "edits": [
        {"op": "add", "annotation": {"type": "arrow", "x1": 10, "y1": 10, "x2": 120, "y2": 90}},
        {"op": "add", "annotation": {"type": "text", "x": 20, "y": 150, "text": "Hello", "style": {"textPreset": "heading"}}},
        {"op": "set_frame", "frame": {"enabled": true, "background": {"type": "solid", "color": "#101418"}}}
    ]}));
    assert!(!is_error, "{edited}");
    assert_eq!(serde_json::from_str::<Value>(&edited).unwrap()["added"].as_array().unwrap().len(), 2);

    let (_, read) = client.call("editor_read", json!({"path": doc}));
    let read: Value = serde_json::from_str(&read).unwrap();
    assert_eq!(read["annotations"][1]["text"], "Hello");
    assert_eq!(read["frame"]["background"]["color"], "#101418");

    // A bad batch is rejected whole and leaves the document unchanged.
    let before = std::fs::read(&doc).unwrap();
    let (is_error, message) = client.call("editor_edit", json!({"path": doc, "edits": [
        {"op": "remove", "id": "nope"}
    ]}));
    assert!(is_error && message.contains("no annotation"), "{message}");
    assert_eq!(std::fs::read(&doc).unwrap(), before);

    // Creating again never overwrites the first document.
    let (_, again) = client.call("editor_create", json!({"image": image}));
    assert!(serde_json::from_str::<Value>(&again).unwrap()["path"].as_str().unwrap().ends_with("page 2.glint"));
    let _ = std::fs::remove_dir_all(dir);
}

/// Live: renders through a running (or auto-started) Glint. Needs GLINT_APP_ID and
/// GLINT_EXE for a preview build, e.g. `cargo test --test mcp_stdio -- --ignored`.
#[test]
#[ignore]
fn renders_through_the_running_app() {
    let dir = workspace("render");
    let image = dir.join("shape.png");
    let mut source = image::RgbaImage::from_pixel(200, 120, image::Rgba([0, 0, 0, 0]));
    for y in 20..100 { for x in 40..160 { source.put_pixel(x, y, image::Rgba([124, 92, 246, 255])); } }
    source.save(&image).unwrap();
    let mut client = Client::start(&dir);
    let (is_error, trimmed) = client.call("image_trim", json!({"path": image}));
    assert!(!is_error, "{trimmed}");
    let trimmed = serde_json::from_str::<Value>(&trimmed).unwrap()["output"].as_str().unwrap().to_string();
    let (is_error, rounded) = client.call("image_round_corners", json!({"path": trimmed, "percent": 40}));
    assert!(!is_error, "{rounded}");
    let output = serde_json::from_str::<Value>(&rounded).unwrap()["output"].as_str().unwrap().to_string();
    let png = image::open(&output).unwrap().to_rgba8();
    assert_eq!(png.dimensions(), (120, 80));
    assert_eq!(png.get_pixel(0, 0)[3], 0, "corners are trimmed to transparent");
    assert_eq!(png.get_pixel(60, 40)[3], 255, "the middle is untouched");
    let _ = std::fs::remove_dir_all(dir);
}

/// A real MP4: a moving test pattern with a tone that goes silent from 3 s to 6 s.
fn sample_video(dir: &std::path::Path, name: &str, seconds: u32) -> PathBuf {
    let ffmpeg = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
    let out = dir.join(name);
    let status = Command::new(ffmpeg)
        .args(["-y", "-v", "error", "-f", "lavfi", "-i", &format!("testsrc2=size=1280x720:rate=30:duration={seconds}")])
        .args(["-f", "lavfi", "-i", &format!("sine=frequency=440:duration={seconds}")])
        .args(["-af", "volume='if(between(t,3,6),0,1)':eval=frame", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
        .arg(&out)
        .status()
        .expect("run ffmpeg");
    assert!(status.success(), "sample video");
    out
}

fn json_text(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"))
}

/// Live: the whole video flow through a running (or auto-started) Glint.
/// Needs GLINT_APP_ID and GLINT_EXE for a preview build (see renders_through_the_running_app).
#[test]
#[ignore]
fn edits_and_exports_video_through_the_running_app() {
    let dir = workspace("video");
    let video = sample_video(&dir, "demo.mp4", 10);
    let original = std::fs::read(&video).unwrap();
    let mut client = Client::start(&dir);

    let (is_error, opened) = client.call("video_open", json!({"path": video}));
    assert!(!is_error, "{opened}");
    let opened = json_text(&opened);
    assert!((opened["duration"].as_f64().unwrap() - 10.).abs() < 0.2, "{opened}");
    assert_eq!(opened["width"], 1280);

    // Silence 3–6 s is found by the app's own analysis.
    let (is_error, analysis) = client.call("video_analyze", json!({"path": video}));
    assert!(!is_error, "{analysis}");
    let silence = json_text(&analysis)["silence"].clone();
    let span = &silence.as_array().unwrap_or_else(|| panic!("{analysis}"))[0];
    assert!((span["start"].as_f64().unwrap() - 3.15).abs() < 0.2 && (span["end"].as_f64().unwrap() - 5.85).abs() < 0.2, "{analysis}");

    let (is_error, edited) = client.call("video_edit", json!({"path": video, "edits": [
        {"op": "cut", "start": span["start"], "end": span["end"]},
        {"op": "set_speed", "start": 7, "end": 9, "speed": 2},
        {"op": "add_zoom", "start": 1, "end": 2.5, "focus": {"x": 0.3, "y": 0.3}, "scale": 1.8},
        {"op": "add_mask", "start": 0, "end": 10, "type": "pixelate", "x": 40, "y": 40, "w": 300, "h": 80},
        {"op": "add_annotation", "kind": "arrow", "start": 0.5, "end": 2.5, "points": [{"x": 0.6, "y": 0.6}, {"x": 0.4, "y": 0.4}]},
        {"op": "add_caption", "start": 0.2, "end": 2.8, "text": "Hello from an agent"},
        {"op": "set_look", "look": {"enabled": true, "background": {"type": "gradient", "gradientId": "dusk"}, "padding": 48}},
        {"op": "set_fades", "fade_in": 0.3, "fade_out": 0.3}
    ]}));
    assert!(!is_error, "{edited}");
    let seconds = json_text(&edited)["output_seconds"].as_f64().unwrap();
    assert!((seconds - (10. - 2.7 - 1.)).abs() < 0.3, "{edited}");

    // Frames come back as images.
    let frames = client.request("tools/call", json!({"name": "video_frames", "arguments": {"path": video, "times": [1, 8], "width": 320}}));
    let content = frames["result"]["content"].as_array().unwrap();
    assert_eq!(content.iter().filter(|c| c["type"] == "image").count(), 2, "{frames}");

    // Export with progress notifications, waiting to completion.
    let (notes, reply) = client.request_collecting(
        "tools/call",
        json!({"name": "video_export", "arguments": {"path": video, "wait_seconds": 240}, "_meta": {"progressToken": "export-1"}}),
    );
    let status = json_text(reply["result"]["content"][0]["text"].as_str().unwrap());
    assert_eq!(status["state"], "done", "{status}");
    let output = PathBuf::from(status["result"]["output"].as_str().unwrap());
    assert!(output.is_file() && output != video, "{status}");
    assert!(notes.iter().any(|n| n["method"] == "notifications/progress" && n["params"]["progressToken"] == "export-1"), "progress was reported");
    assert_eq!(std::fs::read(&video).unwrap(), original, "the source video is never modified");

    // A long export can be started without waiting, refuses a second export, and cancels cleanly.
    let long = sample_video(&dir, "long.mp4", 60);
    assert!(!client.call("video_open", json!({"path": long})).0);
    // A Look makes every frame go through the compositor, so the export is still running when cancelled.
    let (is_error, styled) = client.call("video_edit", json!({"path": long, "edits": [
        {"op": "set_look", "look": {"enabled": true, "background": {"type": "gradient", "gradientId": "dusk"}, "padding": 48}}
    ]}));
    assert!(!is_error, "{styled}");
    let (_, started) = client.call("video_export", json!({"path": long, "wait_seconds": 0}));
    let started = json_text(&started);
    assert_eq!(started["state"], "running", "{started}");
    let task = started["task"].as_u64().unwrap();
    let (is_error, clash) = client.call("video_export", json!({"path": video, "wait_seconds": 0}));
    assert!(is_error && clash.contains("already running"), "{clash}");
    let (_, cancelled) = client.call("task_cancel", json!({"task": task}));
    assert_eq!(json_text(&cancelled)["cancelled"], true);
    let (_, finished) = client.call("task_status", json!({"task": task, "wait_seconds": 60}));
    assert_eq!(json_text(&finished)["state"], "cancelled", "{finished}");
    let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.starts_with("long (")).collect();
    assert!(leftovers.is_empty(), "a cancelled export leaves no file: {leftovers:?}");

    // The slot is free again afterwards.
    let (_, again) = client.call("video_export", json!({"path": long, "wait_seconds": 0}));
    let again = json_text(&again);
    assert_eq!(again["state"], "running", "{again}");
    client.call("task_cancel", json!({"task": again["task"]}));
    client.call("task_status", json!({"task": again["task"], "wait_seconds": 60}));
    let _ = std::fs::remove_dir_all(dir);
}

/// Live: settings, hotkeys, screenshot and recording through the running app.
/// Changes are restored afterwards. Needs GLINT_APP_ID and GLINT_EXE for a preview build.
#[test]
#[ignore]
fn controls_the_whole_app() {
    let dir = workspace("app");
    let mut client = Client::start(&dir);
    let (is_error, original) = client.call("settings_get", json!({}));
    assert!(!is_error, "{original}");
    let original = json_text(&original);

    let theme = if original["theme"] == "light" { "dark" } else { "light" };
    let (is_error, changed) = client.call("settings_set", json!({"changes": {"theme": theme, "accent": "#2BAAAD", "record_fps": 60}}));
    assert!(!is_error, "{changed}");
    let changed = json_text(&changed);
    assert_eq!((changed["theme"].as_str(), changed["accent"].as_str(), changed["record_fps"].as_u64()), (Some(theme), Some("#2BAAAD"), Some(60)));
    assert_eq!(json_text(&client.call("settings_get", json!({})).1)["theme"], theme, "the change is live");

    let (is_error, message) = client.call("settings_set", json!({"changes": {"record_fps": 45}}));
    assert!(is_error, "an invalid value is refused: {message}");
    let (is_error, message) = client.call("settings_set", json!({"changes": {"warp_drive": true}}));
    assert!(is_error && message.contains("Unknown setting"), "{message}");

    let old_hotkey = original["hotkeys"]["capture_area"].as_str().unwrap().to_string();
    let (is_error, hotkeys) = client.call("hotkey_set", json!({"action": "capture_area", "accelerator": "Ctrl+Alt+Shift+F9"}));
    assert!(!is_error, "{hotkeys}");
    assert_eq!(json_text(&hotkeys)["capture_area"], "Ctrl+Alt+Shift+F9");
    let (is_error, message) = client.call("hotkey_set", json!({"action": "capture_area", "accelerator": "F9"}));
    assert!(is_error && message.contains("Ctrl, Alt, or Win"), "{message}");

    // Restore everything we changed.
    let (is_error, restored) = client.call("settings_set", json!({"changes": {
        "theme": original["theme"], "accent": original["accent"], "record_fps": original["record_fps"]
    }}));
    assert!(!is_error, "{restored}");
    let (is_error, hotkeys) = client.call("hotkey_set", json!({"action": "capture_area", "accelerator": old_hotkey}));
    assert!(!is_error && json_text(&hotkeys)["capture_area"] == old_hotkey.as_str(), "{hotkeys}");

    // A fullscreen screenshot needs no input and returns its file.
    let (is_error, shot) = client.call("capture_screenshot", json!({"mode": "fullscreen"}));
    assert!(!is_error, "{shot}");
    let shot = json_text(&shot);
    let png = image::open(shot["path"].as_str().unwrap()).expect("the screenshot file");
    assert!(png.width() > 100 && png.height() > 100);

    // A short silent recording returns its saved video.
    let (is_error, started) = client.call("recording_start", json!({"system_audio": false, "microphone": false, "webcam": false}));
    assert!(!is_error, "{started}");
    std::thread::sleep(std::time::Duration::from_secs(6));
    let (_, status) = client.call("recording_control", json!({"action": "status"}));
    assert_eq!(json_text(&status)["recording"], true, "{status}");
    let (is_error, stopped) = client.call("recording_stop", json!({}));
    assert!(!is_error, "{stopped}");
    let video = PathBuf::from(json_text(&stopped)["path"].as_str().unwrap());
    assert!(video.is_file() && std::fs::metadata(&video).unwrap().len() > 1024, "{stopped}");
    let (is_error, opened) = client.call("video_open", json!({"path": video}));
    assert!(!is_error && json_text(&opened)["duration"].as_f64().unwrap() > 1., "{opened}");
    let _ = std::fs::remove_dir_all(dir);
}
