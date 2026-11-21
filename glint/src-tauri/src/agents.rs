//! Settings → Agents: which coding agents are on this PC, whether they're
//! connected to Glint, and what they did. Reads the activity log `glint-mcp`
//! writes (see `mcp::activity`) and each agent's own MCP config, read-only.
//! Setup instructions live in the README.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const GUIDE_URL: &str = "https://github.com/sanirudh17/Glint#use-glint-with-coding-agents";

struct Agent {
    id: &'static str,
    name: &'static str,
    /// Command-line names on PATH that mean it's installed.
    commands: &'static [&'static str],
}
/// Agents Glint knows; any other MCP client that connects is listed by its own name.
const AGENTS: [Agent; 10] = [
    Agent { id: "claude-code", name: "Claude Code", commands: &["claude"] },
    Agent { id: "codex", name: "Codex", commands: &["codex"] },
    Agent { id: "opencode", name: "OpenCode", commands: &["opencode"] },
    Agent { id: "antigravity", name: "Antigravity", commands: &["agy"] },
    Agent { id: "copilot", name: "GitHub Copilot CLI", commands: &["copilot"] },
    Agent { id: "oh-my-pi", name: "Oh My Pi", commands: &["omp"] },
    Agent { id: "pi", name: "Pi", commands: &["pi"] },
    Agent { id: "grok", name: "Grok Build", commands: &["grok"] },
    Agent { id: "cursor", name: "Cursor", commands: &["cursor-agent"] },
    Agent { id: "claude-desktop", name: "Claude Desktop", commands: &[] },
];

/// Which agent an MCP client name belongs to ("other" when Glint doesn't know it).
pub fn agent_of(client: &str) -> &'static str {
    let c = client.to_lowercase();
    if c.contains("claude-code") || c.contains("claude code") {
        "claude-code"
    } else if c.contains("codex") {
        "codex"
    } else if c.contains("opencode") {
        "opencode"
    } else if c.contains("antigravity") || c == "agy" {
        "antigravity"
    } else if c.contains("copilot") {
        "copilot"
    } else if c.contains("oh-my-pi") || c.contains("oh my pi") || c == "omp" {
        "oh-my-pi"
    } else if c == "pi" || c.starts_with("pi-") || c.contains("pi coding") {
        "pi"
    } else if c.contains("grok") {
        "grok"
    } else if c.contains("cursor") {
        "cursor"
    } else if c == "claude-ai" || c.contains("claude desktop") || c.contains("claude-desktop") {
        "claude-desktop"
    } else {
        "other"
    }
}

/// "acme-agent-cli" → "Acme Agent CLI": a readable name for a client Glint doesn't know.
pub fn display_name(client: &str) -> String {
    client
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| match w.to_lowercase().as_str() {
            "cli" | "mcp" | "ai" | "ide" | "vs" | "sdk" | "api" => w.to_uppercase(),
            _ => w[..1].to_uppercase() + &w[1..],
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Is a command on PATH (as .exe, .cmd, .ps1 or .bat)?
fn on_path(command: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&path).any(|dir| ["exe", "cmd", "ps1", "bat"].iter().any(|ext| dir.join(format!("{command}.{ext}")).is_file()))
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

fn mcp_servers_file(path: &Path) -> bool {
    read_json(path).is_some_and(|c| json_servers_use_glint(c.get("mcpServers")))
}

/// Codex's config.toml: any `[mcp_servers.*]` table whose command launches Glint.
fn codex_uses_glint(text: &str) -> bool {
    let quoted = |s: &str| -> Vec<String> {
        s.split(['"', '\'']).enumerate().filter(|(i, _)| i % 2 == 1).map(|(_, v)| v.replace("\\\\", "\\")).collect()
    };
    let (mut in_server, mut found) = (false, false);
    let (mut command, mut args) = (String::new(), Vec::new());
    for line in text.lines().map(str::trim).chain(std::iter::once("[end]")) {
        if line.starts_with('[') {
            found |= !command.is_empty() && launches_glint(&command, &args);
            command.clear();
            args.clear();
            in_server = line.starts_with("[mcp_servers.") && !line.contains(".env");
            continue;
        }
        if !in_server {
            continue;
        }
        if let Some(value) = line.strip_prefix("command").map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            command = quoted(value).into_iter().next().unwrap_or_default();
        } else if let Some(value) = line.strip_prefix("args").map(str::trim_start).and_then(|r| r.strip_prefix('=')) {
            args = quoted(value);
        }
    }
    found
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// (installed, configured) for each agent: its command or home folder, and its own MCP config.
fn detect(id: &str) -> (bool, bool) {
    let Some(home) = home() else { return (false, false) };
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
    let command = AGENTS.iter().find(|a| a.id == id).is_some_and(|a| a.commands.iter().any(|c| on_path(c)));
    match id {
        "claude-code" => {
            let config = read_json(&home.join(".claude.json"));
            let configured = config.as_ref().is_some_and(|c| {
                json_servers_use_glint(c.get("mcpServers"))
                    || c["projects"].as_object().is_some_and(|p| p.values().any(|p| json_servers_use_glint(p.get("mcpServers"))))
            });
            (command || home.join(".claude").is_dir(), configured)
        }
        "codex" => {
            let dir = home.join(".codex");
            (command || dir.is_dir(), std::fs::read_to_string(dir.join("config.toml")).is_ok_and(|t| codex_uses_glint(&t)))
        }
        "opencode" => {
            let dir = home.join(".config").join("opencode");
            let configured = ["opencode.json", "opencode.jsonc"].iter().filter_map(|f| read_json(&dir.join(f))).any(|c| {
                json_servers_use_glint(c["mcp"].get("servers")) || json_servers_use_glint(c.get("mcp"))
            });
            (command || dir.is_dir(), configured)
        }
        "antigravity" => {
            let gemini = home.join(".gemini");
            let configured = mcp_servers_file(&gemini.join("config").join("mcp_config.json"))
                || mcp_servers_file(&gemini.join("antigravity").join("mcp_config.json"));
            (command || gemini.join("antigravity").is_dir() || local.join("Programs").join("Antigravity").is_dir(), configured)
        }
        "copilot" => {
            let dir = home.join(".copilot");
            (command || dir.is_dir(), mcp_servers_file(&dir.join("mcp-config.json")))
        }
        "oh-my-pi" => {
            let dir = home.join(".omp");
            (command || dir.is_dir(), mcp_servers_file(&dir.join("agent").join("mcp.json")) || mcp_servers_file(&dir.join("mcp.json")))
        }
        "pi" => {
            let dir = home.join(".pi");
            (command || dir.is_dir(), mcp_servers_file(&dir.join("agent").join("mcp.json")))
        }
        "grok" => (command || home.join(".grok").is_dir(), mcp_servers_file(&home.join(".grok").join("mcp.json"))),
        "cursor" => {
            let dir = home.join(".cursor");
            (command || dir.is_dir() || local.join("Programs").join("cursor").is_dir(), mcp_servers_file(&dir.join("mcp.json")))
        }
        "claude-desktop" => {
            let config = appdata.join("Claude").join("claude_desktop_config.json");
            (config.is_file() || local.join("AnthropicClaude").is_dir(), mcp_servers_file(&config))
        }
        _ => (false, false),
    }
}

/// Is `pid` still running the same program (so a reused pid isn't mistaken)?
#[cfg(windows)]
fn alive(pid: u32, exe: &str) -> bool {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    // SAFETY: plain Win32 calls on a handle we close before returning.
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len).is_ok();
        let mut code = 0u32;
        let running = GetExitCodeProcess(handle, &mut code).is_ok() && code == 259; // STILL_ACTIVE
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

/// The row id an activity entry belongs to: a known agent, or `client:<name>`.
fn row_of(client: &str) -> String {
    match agent_of(client) {
        "other" => format!("client:{client}"),
        known => known.to_string(),
    }
}

pub fn overview_from(entries: &[Value], detected: impl Fn(&str) -> (bool, bool), live: impl Fn(u32, &str) -> bool) -> Value {
    let mut last_used: HashMap<String, u64> = HashMap::new();
    let mut active: HashMap<String, bool> = HashMap::new();
    let mut seen_sessions = std::collections::HashSet::new();
    let mut other_names: Vec<String> = Vec::new();
    for e in entries.iter().rev() {
        let client = e["client"].as_str().unwrap_or_default();
        if client.is_empty() || client == "unknown" {
            continue;
        }
        let row = row_of(client);
        if row.starts_with("client:") && !other_names.contains(&client.to_string()) {
            other_names.push(client.to_string());
        }
        let t = e["t"].as_u64().unwrap_or(0);
        let used = last_used.entry(row.clone()).or_insert(0);
        *used = (*used).max(t);
        if e["kind"] == "session" && seen_sessions.insert(e["s"].as_str().unwrap_or_default().to_string()) {
            if e["pid"].as_u64().is_some_and(|pid| live(pid as u32, e["exe"].as_str().unwrap_or("glint"))) {
                active.insert(row, true);
            }
        }
    }
    let status = |row: &str| (active.get(row).copied().unwrap_or(false), last_used.get(row).copied());
    let mut agents: Vec<Value> = AGENTS
        .iter()
        .map(|a| {
            let (installed, configured) = detected(a.id);
            let (is_active, used) = status(a.id);
            json!({"id": a.id, "name": a.name, "installed": installed || used.is_some(), "configured": configured || used.is_some(), "active": is_active, "last_used": used})
        })
        .collect();
    // Any other MCP client that has used Glint gets its own row, under its own name.
    agents.extend(other_names.iter().map(|client| {
        let row = format!("client:{client}");
        let (is_active, used) = status(&row);
        json!({"id": row, "name": display_name(client), "installed": true, "configured": true, "active": is_active, "last_used": used})
    }));
    let activity: Vec<Value> = entries
        .iter()
        .rev()
        .filter(|e| e["kind"] == "tool" && e["read"] != true)
        .take(12)
        .map(|e| {
            let mut e = e.clone();
            e["agent"] = json!(row_of(e["client"].as_str().unwrap_or_default()));
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

/// Open the setup guide in the default browser, at one agent's section when given.
/// Only Glint's own README is ever opened; the anchor comes from the fixed list.
#[tauri::command]
pub fn agents_open_guide(agent: Option<String>) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let url = match agent.as_deref().and_then(|id| AGENTS.iter().find(|a| a.id == id)) {
        Some(a) => format!("https://github.com/sanirudh17/Glint#setup-{}", a.id),
        None => GUIDE_URL.to_string(),
    };
    std::process::Command::new("explorer.exe").arg(url).creation_flags(0x08000000).spawn().map(|_| ()).map_err(|e| e.to_string())
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
    }

    #[test]
    fn client_names_map_to_agents_and_unknown_ones_keep_their_own_name() {
        assert_eq!(agent_of("claude-code"), "claude-code");
        assert_eq!(agent_of("codex-mcp-client"), "codex");
        assert_eq!(agent_of("claude-ai"), "claude-desktop");
        assert_eq!(agent_of("claude"), "other", "an unknown client is never guessed into a product");
        assert_eq!(agent_of("antigravity-cli"), "antigravity");
        assert_eq!(agent_of("oh-my-pi"), "oh-my-pi");
        assert_eq!(agent_of("pi"), "pi");
        assert_eq!(agent_of("pilot"), "other");
        assert_eq!(display_name("acme-agent-cli"), "Acme Agent CLI");
    }

    #[test]
    fn live_sessions_and_last_use_drive_each_agents_status() {
        let entries = vec![
            json!({"t": 1000, "kind": "session", "s": "1-1", "pid": 11, "exe": "glint.exe", "client": "claude-code"}),
            json!({"t": 2000, "kind": "tool", "s": "1-1", "client": "claude-code", "tool": "settings_set", "read": false, "ok": true}),
            json!({"t": 3000, "kind": "session", "s": "2-1", "pid": 22, "exe": "glint.exe", "client": "codex-mcp-client"}),
            json!({"t": 3500, "kind": "tool", "s": "2-1", "client": "codex-mcp-client", "tool": "settings_get", "read": true, "ok": true}),
            json!({"t": 4000, "kind": "session", "s": "3-1", "pid": 33, "exe": "glint.exe", "client": "acme-agent"}),
            json!({"t": 4100, "kind": "tool", "s": "3-1", "client": "acme-agent", "tool": "image_trim", "read": false, "ok": true}),
        ];
        let view = overview_from(&entries, |id| (id != "cursor", false), |pid, _| pid == 22 || pid == 33);
        let agent = |id: &str| view["agents"].as_array().unwrap().iter().find(|a| a["id"] == id).cloned().unwrap();
        assert_eq!(agent("claude-code")["active"], false);
        assert_eq!(agent("claude-code")["last_used"], 2000);
        assert_eq!(agent("claude-code")["configured"], true, "having been used means it is set up");
        assert_eq!(agent("codex")["active"], true);
        assert_eq!(agent("cursor")["installed"], false);
        let other = agent("client:acme-agent");
        assert_eq!((other["name"].as_str(), other["active"].as_bool()), (Some("Acme Agent"), Some(true)));
        let activity = view["activity"].as_array().unwrap();
        assert_eq!(activity.len(), 2, "reads are not listed as actions");
        assert_eq!(activity[0]["agent"], "client:acme-agent");
    }
}
