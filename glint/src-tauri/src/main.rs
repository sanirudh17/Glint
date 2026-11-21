// Hide the Windows console for the GUI app — UNCONDITIONALLY (not just release), so that
// "Open in Glint" launches, including the short-lived single-instance forwarder process,
// never flash a console window in dev builds either. Logs go to a file (tauri-plugin-log),
// not stdout, and `tauri dev` still captures the app's piped stdout/stderr, so nothing is
// lost. DO NOT REMOVE.
#![windows_subsystem = "windows"]

fn main() {
    // `glint.exe --mcp`: serve the Glint MCP for a coding agent over stdio and exit.
    // Runs before anything app-related (no windows, no single-instance lock), so the
    // installed glint.exe doubles as the MCP server — nothing extra to install.
    if std::env::args().nth(1).as_deref() == Some("--mcp") {
        let code = match glint_lib::mcp::run_stdio() {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("glint --mcp: {error}");
                1
            }
        };
        std::process::exit(code);
    }
    // Configure WebView2 to initialize swapchains to 0x00000000 (transparent) instead of default #FFFFFFFF (opaque white).
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
    glint_lib::run()
}
