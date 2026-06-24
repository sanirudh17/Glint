//! Windows Explorer "Open in Glint" right-click verb (HKCU, no admin).
//!
//! Registers a single shell verb under the `image` perceived type, which Windows
//! assigns to common raster formats (png/jpg/jpeg/webp/bmp/gif) — one durable
//! entry instead of a per-extension fan-out. HKCU-only honours the no-admin /
//! single-user constraint. Idempotent: `register()` is safe to call on every
//! launch and self-heals a stale exe path after the app is moved or updated.

use winreg::enums::*;
use winreg::RegKey;

/// The shell-verb key under HKEY_CURRENT_USER (real, production location).
const SHELL_KEY: &str = r"Software\Classes\SystemFileAssociations\image\shell\Glint";

/// The launch command we store under `…\Glint\command` (default value).
pub fn expected_command(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

/// Absolute path to the running executable, as a String.
fn current_exe_string() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())
        .map(|p| p.to_string_lossy().to_string())
}

/// Write the verb (caption + icon + command) at `base`. Idempotent.
fn register_at(base: &str, exe: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(base).map_err(|e| e.to_string())?;
    key.set_value("", &"Open in Glint").map_err(|e| e.to_string())?;
    key.set_value("Icon", &format!("{exe},0")).map_err(|e| e.to_string())?;
    let (cmd, _) = hkcu
        .create_subkey(format!(r"{base}\command"))
        .map_err(|e| e.to_string())?;
    cmd.set_value("", &expected_command(exe)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete the verb (and its `command` subkey) at `base`. Missing key = ok.
fn unregister_at(base: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.delete_subkey_all(base) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// True only when the stored command equals `expected_command(exe)` — so a stale
/// exe path (app moved) reads as NOT registered and triggers a re-register.
fn is_registered_at(base: &str, exe: &str) -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(cmd) = hkcu.open_subkey(format!(r"{base}\command")) else {
        return false;
    };
    let stored: Result<String, _> = cmd.get_value("");
    matches!(stored, Ok(s) if s == expected_command(exe))
}

/// Register the verb at the production location for the current exe.
pub fn register() -> Result<(), String> {
    let exe = current_exe_string()?;
    register_at(SHELL_KEY, &exe)
}

/// Remove the production verb.
pub fn unregister() -> Result<(), String> {
    unregister_at(SHELL_KEY)
}

/// Is the production verb present AND pointing at the current exe?
pub fn is_registered() -> bool {
    match current_exe_string() {
        Ok(exe) => is_registered_at(SHELL_KEY, &exe),
        Err(_) => false,
    }
}

/// Settings-toggle command: add the right-click menu entry.
#[tauri::command]
pub fn shell_register_explorer_menu() -> Result<(), String> {
    register()
}

/// Settings-toggle command: remove the right-click menu entry.
#[tauri::command]
pub fn shell_unregister_explorer_menu() -> Result<(), String> {
    unregister()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_command_quotes_exe_and_percent_one() {
        assert_eq!(
            expected_command(r"C:\Program Files\Glint\glint.exe"),
            r#""C:\Program Files\Glint\glint.exe" "%1""#
        );
    }

    #[test]
    fn register_then_is_registered_then_unregister_roundtrips() {
        // Use a throwaway base so the real shell verb is never touched.
        let base = r"Software\Classes\__glint_test__\image\shell\Glint";
        let exe = r"C:\tmp\glint.exe";
        // Clean slate.
        let _ = unregister_at(base);
        assert!(!is_registered_at(base, exe));

        register_at(base, exe).expect("register");
        assert!(is_registered_at(base, exe));
        // A different exe path must read as NOT registered (stale detection).
        assert!(!is_registered_at(base, r"C:\other\glint.exe"));

        unregister_at(base).expect("unregister");
        assert!(!is_registered_at(base, exe));
    }
}
