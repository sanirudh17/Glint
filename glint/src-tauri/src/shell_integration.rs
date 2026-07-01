//! Windows Explorer "Open in Glint" right-click verb (HKCU, no admin).
//!
//! Registers a shell verb under the `image` perceived type (png/jpg/jpeg/webp/bmp/gif
//! → open in the editor) AND the `video` perceived type (mp4/mov/mkv/webm/avi… → open
//! in the trim window) — one durable entry per type instead of a per-extension fan-out.
//! HKCU-only honours the no-admin / single-user constraint. Idempotent: `register()` is
//! safe to call on every launch and self-heals a stale exe path after the app is moved
//! or updated.

use winreg::enums::*;
use winreg::RegKey;

/// The image shell-verb key under HKEY_CURRENT_USER (real, production location). Images
/// use a classic handler (`pngfile`, etc.), so the `image` perceived type enumerates fine.
const IMAGE_SHELL_KEY: &str = r"Software\Classes\SystemFileAssociations\image\shell\Glint";

/// The OLD `video` PERCEIVED-TYPE verb (pre-fix). Windows does NOT reliably enumerate
/// `SystemFileAssociations\video\shell` verbs in the classic menu when the default video
/// handler is a packaged (UWP) app — which is the common case for `.mp4` (Media Player).
/// We migrated to per-extension keys and delete this stale one so nothing is orphaned and
/// no duplicate entry appears on systems where perceived-type *did* work.
const OLD_VIDEO_PERCEIVED_KEY: &str = r"Software\Classes\SystemFileAssociations\video\shell\Glint";

/// Per-extension video verb key: `SystemFileAssociations\.<ext>\shell\Glint`. Unlike the
/// perceived type, this location always shows in the classic menu regardless of which app
/// owns the extension. Registered for every entry in `recorder::trim::VIDEO_EXTS`.
fn video_ext_key(ext: &str) -> String {
    format!(r"Software\Classes\SystemFileAssociations\.{ext}\shell\Glint")
}

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

/// Tell the shell that file associations changed, so a newly (un)registered verb shows
/// up in Explorer's menu immediately instead of only after the association cache expires
/// or explorer.exe restarts. Without this a first-ever registration (e.g. the new video
/// verb) can stay invisible until the next reboot.
fn notify_assoc_changed() {
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    // SHCNF_IDLIST (0x0000) + SHCNF_FLUSH (0x1000): flush synchronously so the shell has
    // processed the association change before we return — improves first-time visibility
    // of a brand-new verb without waiting for an explorer restart / reboot.
    const SHCNF_IDLIST_FLUSH: u32 = 0x0000 | 0x1000;
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(
            event_id: i32,
            flags: u32,
            item1: *const std::ffi::c_void,
            item2: *const std::ffi::c_void,
        );
    }
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST_FLUSH, std::ptr::null(), std::ptr::null()) };
}

/// Register the verb for images (perceived type) and for each video extension (per-ext),
/// then delete the stale perceived-type video verb from earlier builds.
pub fn register() -> Result<(), String> {
    let exe = current_exe_string()?;
    register_at(IMAGE_SHELL_KEY, &exe)?;
    for ext in crate::recorder::trim::VIDEO_EXTS {
        register_at(&video_ext_key(ext), &exe)?;
    }
    let _ = unregister_at(OLD_VIDEO_PERCEIVED_KEY); // migrate off the perceived-type verb
    notify_assoc_changed();
    Ok(())
}

/// Remove the image verb + every per-extension video verb (and the stale perceived-type one).
pub fn unregister() -> Result<(), String> {
    unregister_at(IMAGE_SHELL_KEY)?;
    for ext in crate::recorder::trim::VIDEO_EXTS {
        unregister_at(&video_ext_key(ext))?;
    }
    let _ = unregister_at(OLD_VIDEO_PERCEIVED_KEY);
    notify_assoc_changed();
    Ok(())
}

/// Image verb AND every per-extension video verb present and pointing at THIS exe? A
/// partial/stale registration (e.g. only the image verb, or the old perceived-type build)
/// reads false and triggers a re-register on next launch.
pub fn is_registered() -> bool {
    match current_exe_string() {
        Ok(exe) => {
            is_registered_at(IMAGE_SHELL_KEY, &exe)
                && crate::recorder::trim::VIDEO_EXTS
                    .iter()
                    .all(|ext| is_registered_at(&video_ext_key(ext), &exe))
        }
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
