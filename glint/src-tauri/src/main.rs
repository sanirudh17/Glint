// Hide the Windows console for the GUI app — UNCONDITIONALLY (not just release), so that
// "Open in Glint" launches, including the short-lived single-instance forwarder process,
// never flash a console window in dev builds either. Logs go to a file (tauri-plugin-log),
// not stdout, and `tauri dev` still captures the app's piped stdout/stderr, so nothing is
// lost. DO NOT REMOVE.
#![windows_subsystem = "windows"]

fn main() {
    // Configure WebView2 to initialize swapchains to 0x00000000 (transparent) instead of default #FFFFFFFF (opaque white).
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");
    glint_lib::run()
}
