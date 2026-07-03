//! Launch-at-login via the HKCU Run key. The registry is the source of truth (not the
//! settings table): the toggle reads/writes the real value so it always reflects reality.

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Glint";

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// True when the Run value exists (Glint is set to start at login).
pub fn is_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey(RUN_PATH) {
        Ok(run) => run.get_value::<String, _>(VALUE_NAME).is_ok(),
        Err(_) => false,
    }
}

/// Add or remove the Run value (quoted exe path). Deleting a missing value is not an error.
pub fn set_enabled(on: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(RUN_PATH).map_err(|e| e.to_string())?;
    if on {
        let exe = exe_path()?;
        run.set_value(VALUE_NAME, &format!("\"{exe}\"")).map_err(|e| e.to_string())?;
    } else {
        let _ = run.delete_value(VALUE_NAME);
    }
    Ok(())
}
