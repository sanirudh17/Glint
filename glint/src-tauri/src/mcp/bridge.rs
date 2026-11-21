//! Client for the running app's control channel (see `crate::control`).
//! If Glint isn't running, it is started quietly (`--background`, tray only)
//! and the call waits for its pipe to appear.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const STARTUP_WAIT: Duration = Duration::from_secs(30);

/// Which app to talk to: `GLINT_APP_ID` (preview builds, tests) or the installed app.
pub fn app_identifier() -> String {
    std::env::var("GLINT_APP_ID").unwrap_or_else(|_| "com.glint.app".into())
}

/// glint.exe: `GLINT_EXE`, beside this program (installed layout), or the default install folder.
fn glint_exe() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GLINT_EXE").map(PathBuf::from) {
        return path.is_file().then_some(path);
    }
    let me = std::env::current_exe().ok()?;
    // Served as `glint.exe --mcp`: the app is this very executable.
    if me.file_stem().is_some_and(|stem| stem != "glint-mcp") {
        return Some(me);
    }
    let sibling = me.parent()?.join("glint.exe");
    if sibling.is_file() {
        return Some(sibling);
    }
    let installed = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Glint").join("glint.exe");
    installed.is_file().then_some(installed)
}

/// Start Glint in the tray, inheriting NO handles from this process.
///
/// Glint outlives this process. If it inherited any handle, it would keep the
/// agent's pipes open (or a parent's — e.g. a terminal's output pipe that was
/// passed down to us without our knowledge), and whoever reads them would never
/// see end-of-file. `std::process::Command` always inherits every inheritable
/// handle, so the process is created directly with `bInheritHandles = FALSE`.
#[cfg(windows)]
fn launch_detached(exe: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        CreateProcessW, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS, PROCESS_INFORMATION, STARTUPINFOW,
    };
    let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let application = wide(exe.as_os_str());
    let mut command_line = wide(std::ffi::OsStr::new(&format!("\"{}\" --background", exe.display())));
    let startup = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: valid NUL-terminated buffers that outlive the call; handles closed below.
    unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()),
            Some(PWSTR(command_line.as_mut_ptr())),
            None,
            None,
            false,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            None,
            PCWSTR::null(),
            &startup,
            &mut info,
        )
        .map_err(|e| format!("Couldn't start Glint ({}): {e}", exe.display()))?;
        let _ = CloseHandle(info.hThread);
        let _ = CloseHandle(info.hProcess);
    }
    Ok(())
}

#[cfg(windows)]
async fn connect(pipe: &str) -> Result<tokio::net::windows::named_pipe::NamedPipeClient, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let deadline = Instant::now() + STARTUP_WAIT;
    let mut launched = false;
    loop {
        match ClientOptions::new().open(pipe) {
            Ok(client) => return Ok(client),
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if !launched {
                    launched = true;
                    let exe = glint_exe().ok_or("Glint isn't running and glint.exe wasn't found. Start Glint, or set GLINT_EXE.")?;
                    launch_detached(&exe)?;
                }
            }
            Err(e) => return Err(format!("Couldn't reach Glint: {e}")),
        }
        if Instant::now() > deadline {
            return Err("Glint didn't become ready in time. Is it starting up?".into());
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

/// One request/response on a fresh connection, bounded by `timeout`.
#[cfg(windows)]
pub async fn call(method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let pipe = crate::control::pipe_name(&app_identifier());
    let client = connect(&pipe).await?;
    let exchange = async move {
        let (reader, mut writer) = tokio::io::split(client);
        let request = json!({"id": 1, "method": method, "params": params});
        writer.write_all(format!("{request}\n").as_bytes()).await.map_err(|e| e.to_string())?;
        writer.flush().await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(reader).read_line(&mut line).await.map_err(|e| e.to_string())?;
        let reply: Value = serde_json::from_str(&line).map_err(|_| "Glint sent an unreadable reply".to_string())?;
        match (reply.get("result"), reply.get("error")) {
            (Some(result), _) => Ok(result.clone()),
            (_, Some(error)) => Err(error.as_str().unwrap_or("Glint reported an error").to_string()),
            _ => Err("Glint sent an empty reply".into()),
        }
    };
    tokio::time::timeout(timeout, exchange).await.map_err(|_| format!("Glint didn't answer \"{method}\" in time."))?
}
#[cfg(not(windows))]
pub async fn call(_: &str, _: Value, _: Duration) -> Result<Value, String> {
    Err("Glint runs on Windows only".into())
}
