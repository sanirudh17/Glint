//! Settings → Agents: which coding agents are connected to Glint, and what they
//! did. Reads the activity log `glint-mcp` writes (see `mcp::activity`) and each
//! agent's own MCP config, read-only. Setup instructions live in the README.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const GUIDE_URL: &str = "https://github.com/sanirudh17/Glint#use-glint-with-coding-agents";

struct Agent {
    id: &'static str,
    name: &'static str,
}
const AGENTS: [Agent; 5] = [
    Agent { id: "claude-code", name: "Claude Code" },
    Agent { id: "codex", name: "Codex" },
    Agent { id: "opencode", name: "OpenCode" },
    Agent { id: "cursor", name: "Cursor" },
    Agent { id: "claude-desktop", name: "Claude Desktop" },
];

/// Which agent an MCP client name belongs to.
pub fn agent_of(client: &str) -> &'static str {
    let c = client.to_lowercase();
    if c.contains("claude-code") || c.contains("claude code") {
        "claude-code"
    } else if c.contains("codex") {
        "codex"
    } else if c.contains("opencode") {
        "opencode"
    } else if c.contains("cursor") {
        "cursor"
    } else if c == "claude-ai" || c.contains("claude desktop") || c.contains("claude-desktop") {
        "claude-desktop"
    } else {
        "other"
    }
}

/// Does an MCP server entry launch Glint's server?
fn launches_glint(command: &str, args: &[String]) -> bool {
    let stem = Path::new(command.trim_matches('"')).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    stem == "glint-mcp" || (stem.starts_with("glint") && args.iter().any(|a| a == "--mcp"))
}

fn json_servers_use_glint(servers: Option<&Value>) -> bool {
    servers.and_then(Value::as_object).is_some_and(|servers| {
        servers.values().any(|s| {
            let args: Vec<String> = s["args"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
            if let Some(command) = s["command"].as_str() {
                return launches_glint(command, &args);
            }
            // OpenCode: "command": ["glint.exe", "--mcp"]
            s["command"].as_array().is_some_and(|parts| {
                let parts: Vec<String> = parts.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
                parts.first().is_some_and(|c| launches_glint(c, &parts[1..]))
            })
        })
    })
}

/// Strip `//` and `/* */` comments (JSONC) outside strings.
fn strip_jsonc(text: &str) -> String {
    let (mut out, mut chars, mut in_str) = (String::new(), text.chars().peekable(), false);
    while let Some(c) = chars.next() {
        if in_str {
            out.push(c);
            if c == '\\' {
                if let Some(n) = chars.next() {
                    out.push(n);
                }
            } else if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            out.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            for n in chars.by_ref() {
                if n == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            let mut last = ' ';
            for n in chars.by_ref() {
                if last == '*' && n == '/' {
                    break;
                }
                last = n;
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&strip_jsonc(&text)).ok()
}

/// Codex's config.toml: any `[mcp_servers.*]` table whose command launches Glint.
fn codex_uses_glint(text: &str) -> bool {
    let mut in_server = false;
    let (mut command, mut args) = (String::new(), Vec::new());
    let mut found = false;
    let mut flush = |command: &mut String, args: &mut Vec<String>| {
        found |= !command.is_empty() && launches_glint(command, args);
        command.clear();
        args.clear();
    };
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            flush(&mut command, &mut args);
            in_server = line.starts_with("[mcp_servers.") && !line.contains(".env");
            continue;
        }
        if !in_server {
            continue;
        }
        let quoted = |s: &str| -> Vec<String> {
            s.split(['"', '\'']).enumerate().filter(|(i, _)| i % 2 == 1).map(|(_, v)| v.replace("\\\\", "\\")).collect()
        };
        if let Some(value) = line.strip_prefix("command").map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            *(&mut command) = quoted(value).into_iter().next().unwrap_or_default();
        } else if let Some(value) = line.strip_prefix("args").map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            args = quoted(value);
        }
    }
    flush(&mut command, &mut args);
    found
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// (installed, configured) for each agent, from its own files.
fn detect(id: &str) -> (bool, bool) {
    let Some(home) = home() else { return (false, false) };
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    match id {
        "claude-code" => {
            let config = read_json(&home.join(".claude.json"));
            let configured = config.as_ref().is_some_and(|c| {
                json_servers_use_glint(c.get("mcpServers"))
                    || c["projects"].as_object().is_some_and(|p| p.values().any(|p| json_servers_use_glint(p.get("mcpServers"))))
            }) || read_json(&home.join(".claude").join("settings.json")).is_some_and(|c| json_servers_use_glint(c.get("mcpServers")));
            (home.join(".claude").is_dir() || config.is_some(), configured)
        }
        "codex" => {
            let dir = home.join(".codex");
            (dir.is_dir(), std::fs::read_to_string(dir.join("config.toml")).is_ok_and(|t| codex_uses_glint(&t)))
        }
        "opencode" => {
            let dir = home.join(".config").join("opencode");
            let configured = ["opencode.json", "opencode.jsonc"].iter().filter_map(|f| read_json(&dir.join(f))).any(|c| {
                json_servers_use_glint(c["mcp"].get("servers")) || json_servers_use_glint(c.get("mcp"))
            });
            (dir.is_dir(), configured)
        }
        "cursor" => {
            let dir = home.join(".cursor");
            (dir.is_dir(), read_json(&dir.join("mcp.json")).is_some_and(|c| json_servers_use_glint(c.get("mcpServers"))))
        }
        "claude-desktop" => {
            let dir = appdata.join("Claude");
            (
                dir.join("claude_desktop_config.json").is_file(),
                read_json(&dir.join("claude_desktop_config.json")).is_some_and(|c| json_servers_use_glint(c.get("mcpServers"))),
            )
        }
        _ => (false, false),
    }
}

/// Is `pid` still running the same program (so a reused pid isn't mistaken)?
#[cfg(windows)]
fn alive(pid: u32, exe: &str) -> bool {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: plain Win32 calls on a handle we close before returning.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len).is_ok();
        let mut code = 0u32;
        let running = windows::Win32::System::Threading::GetExitCodeProcess(handle, &mut code).is_ok() && code == 259; // STILL_ACTIVE
        let _ = CloseHandle(handle);
        let image = String::from_utf16_lossy(&buffer[..len as usize]).to_lowercase();
        named && running && image.ends_with(&exe.to_lowercase())
    }
}
#[cfg(not(windows))]
fn alive(_: u32, _: &str) -> bool {
    false
}

fn read_log(path: &Path) -> Vec<Value> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect()
}

pub fn overview_from(entries: &[Value], detected: impl Fn(&str) -> (bool, bool), live: impl Fn(u32, &str) -> bool) -> Value {
    let mut last_used: HashMap<&str, u64> = HashMap::new();
    let mut active: HashMap<&str, bool> = HashMap::new();
    let mut seen_sessions = std::collections::HashSet::new();
    for e in entries.iter().rev() {
        let agent = agent_of(e["client"].as_str().unwrap_or_default());
        let t = e["t"].as_u64().unwrap_or(0);
        let entry = last_used.entry(agent).or_insert(0);
        *entry = (*entry).max(t);
        if e["kind"] == "session" && seen_sessions.insert(e["s"].as_str().unwrap_or_default().to_string()) {
            let running = e["pid"].as_u64().is_some_and(|pid| live(pid as u32, e["exe"].as_str().unwrap_or("glint")));
            if running {
                active.insert(agent, true);
            }
        }
    }
    let agents: Vec<Value> = AGENTS
        .iter()
        .map(|a| {
            let (installed, configured) = detected(a.id);
            json!({
                "id": a.id, "name": a.name, "installed": installed,
                "configured": configured || last_used.contains_key(a.id),
                "active": active.get(a.id).copied().unwrap_or(false),
                "last_used": last_used.get(a.id).copied(),
            })
        })
        .collect();
    let activity: Vec<Value> = entries
        .iter()
        .rev()
        .filter(|e| e["kind"] == "tool" && e["read"] != true)
        .take(12)
        .map(|e| {
            let mut e = e.clone();
            e["agent"] = json!(agent_of(e["client"].as_str().unwrap_or_default()));
            e
        })
        .collect();
    json!({"agents": agents, "activity": activity})
}

#[tauri::command(async)]
pub fn agents_overview(app: AppHandle) -> Result<Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let entries = read_log(&dir.join(crate::mcp::activity::LOG_FILE));
    Ok(overview_from(&entries, detect, alive))
}

/// Open the setup guide (a fixed URL) in the default browser.
#[tauri::command]
pub fn agents_open_guide() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("explorer.exe").arg(GUIDE_URL).creation_flags(0x08000000).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_glint_in_every_agents_config_format() {
        assert!(launches_glint(r"C:\Users\a\AppData\Local\Glint\glint.exe", &["--mcp".into()]));
        assert!(launches_glint(r"C:\x\glint-mcp.exe", &[]));
        assert!(!launches_glint(r"C:\x\glint.exe", &[]), "plain glint.exe is the app, not the server");
        assert!(!launches_glint("npx", &["--mcp".into()]));
        let toml = "[model]\nname = \"x\"\n[mcp_servers.glint]\ncommand = 'C:\\Users\\a\\AppData\\Local\\Glint\\glint.exe'\nargs = [\"--mcp\"]\n[mcp_servers.other]\ncommand = \"npx\"\n";
        assert!(codex_uses_glint(toml));
        assert!(!codex_uses_glint("[mcp_servers.other]\ncommand = \"npx\"\nargs = [\"--mcp\"]\n"));
        let jsonc = "{ // comment\n \"mcp\": { \"servers\": { \"glint\": { \"type\": \"local\", \"command\": [\"C:\\\\G\\\\glint.exe\", \"--mcp\"] /* x */ } } } }";
        let parsed: Value = serde_json::from_str(&strip_jsonc(jsonc)).unwrap();
        assert!(json_servers_use_glint(parsed["mcp"].get("servers")));
        assert_eq!(agent_of("claude-code"), "claude-code");
        assert_eq!(agent_of("codex-mcp-client"), "codex");
        assert_eq!(agent_of("claude-ai"), "claude-desktop");
        assert_eq!(agent_of("claude"), "other", "an unknown client is never guessed into a product");
    }

    #[test]
    fn live_sessions_and_last_use_drive_each_agents_status() {
        let entries = vec![
            json!({"t": 1000, "kind": "session", "s": "1-1", "pid": 11, "exe": "glint.exe", "client": "claude-code"}),
            json!({"t": 2000, "kind": "tool", "s": "1-1", "client": "claude-code", "tool": "settings_set", "read": false, "ok": true}),
            json!({"t": 3000, "kind": "session", "s": "2-1", "pid": 22, "exe": "glint.exe", "client": "codex-mcp-client"}),
            json!({"t": 3500, "kind": "tool", "s": "2-1", "client": "codex-mcp-client", "tool": "settings_get", "read": true, "ok": true}),
        ];
        let view = overview_from(&entries, |id| (id != "cursor", false), |pid, _| pid == 22);
        let agent = |id: &str| view["agents"].as_array().unwrap().iter().find(|a| a["id"] == id).unwrap().clone();
        assert_eq!(agent("claude-code")["active"], false);
        assert_eq!(agent("claude-code")["last_used"], 2000);
        assert_eq!(agent("claude-code")["configured"], true, "having been used means it is set up");
        assert_eq!(agent("codex")["active"], true);
        assert_eq!(agent("cursor")["installed"], false);
        assert_eq!(view["activity"].as_array().unwrap().len(), 1, "reads are not listed as actions");
    }
}
