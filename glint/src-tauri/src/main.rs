// Hide the Windows console for the GUI app — UNCONDITIONALLY (not just release), so that
// "Open in Glint" launches, including the short-lived single-instance forwarder process,
// never flash a console window in dev builds either. Logs go to a file (tauri-plugin-log),
// not stdout, and `tauri dev` still captures the app's piped stdout/stderr, so nothing is
// lost. DO NOT REMOVE.
#![windows_subsystem = "windows"]

fn main() {
    glint_lib::run()
}
