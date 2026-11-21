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
