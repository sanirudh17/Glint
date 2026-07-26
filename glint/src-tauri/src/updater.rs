//! In-app updater. Two responsibilities, both driven from the frontend:
//!
//!   * `app_version` — the running build's version, so the UI can compare it
//!     against the latest GitHub release (the check itself is a plain `fetch`
//!     from the webview to the public GitHub API — no Rust involved).
//!   * `update_install` — download the release's NSIS installer and launch it.
//!
//! There is no signed Tauri auto-updater here (the installers are unsigned and no
//! update manifest is published). "Update" means: fetch the same `-setup.exe` a
//! user would download by hand, run it, and exit so it can replace the files in
//! place. The download streams on a spawned thread and reports progress via the
//! `update-progress` event; failures surface via `update-error`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Only ever download + launch an installer from Glint's own GitHub releases. The
/// URL comes from the GitHub API response, but the frontend hands it to us, so we
/// re-check it here: a strict prefix + `.exe` suffix means a tampered/injected URL
/// can never make us run an arbitrary executable. Keep in sync with the API repo.
const RELEASE_DOWNLOAD_PREFIX: &str = "https://github.com/sanirudh17/Glint/releases/download/";

/// The running build's version (e.g. "0.1.4"), for the UI's up-to-date comparison.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Reject anything that isn't one of our own release `.exe` assets. Returns the
/// bare filename to save as, or an error message safe to show the user.
fn validate_url(url: &str) -> Result<String, String> {
    if !url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
        return Err("Update URL is not a Glint release asset.".into());
    }
    if !url.to_ascii_lowercase().ends_with(".exe") {
        return Err("Update asset is not an installer.".into());
    }
    let name = url.rsplit('/').next().filter(|s| !s.is_empty()).ok_or("Malformed update URL.")?;
    Ok(name.to_string())
}

/// Start downloading the given release installer and launch it when done. Returns
/// as soon as the download thread is spawned; the UI follows `update-progress`
/// (and `update-error` on failure). On success we spawn the installer detached and
/// exit Glint shortly after so the running exe unlocks for in-place replacement.
#[tauri::command]
pub fn update_install(app: AppHandle, url: String, version: String) -> Result<(), String> {
    let filename = validate_url(&url)?;

    std::thread::spawn(move || {
        if let Err(e) = download_and_launch(&app, &url, &filename, &version) {
            log::warn!("update install failed: {e}");
            let _ = app.emit("update-error", e);
        }
    });
    Ok(())
}

fn download_and_launch(
    app: &AppHandle,
    url: &str,
    filename: &str,
    version: &str,
) -> Result<(), String> {
    use std::io::{Read, Write};

    let dir = std::env::temp_dir().join("glint-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("temp dir: {e}"))?;
    let dest = dir.join(filename);

    log::info!("update: downloading v{version} → {}", dest.display());
    let resp = ureq::get(url)
        .set("User-Agent", "Glint-Updater")
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let total: Option<u64> = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok());

    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&dest).map_err(|e| format!("write file: {e}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("write: {e}"))?;
        downloaded += n as u64;
        // Throttle progress events to ~every 1 MB so we don't flood the event loop.
        if downloaded - last_emit >= 1_000_000 {
            last_emit = downloaded;
            let _ = app.emit("update-progress", Progress { downloaded, total });
        }
    }
    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    // Final 100% tick (total may have been unknown mid-stream).
    let _ = app.emit(
        "update-progress",
        Progress { downloaded, total: Some(downloaded) },
    );
    log::info!("update: downloaded {downloaded} bytes; launching installer");

    // Launch the installer detached, then exit so it can overwrite the running exe.
    std::process::Command::new(&dest)
        .spawn()
        .map_err(|e| format!("couldn't launch installer: {e}"))?;
    let _ = app.emit("update-launching", version.to_string());

    // Give the installer a beat to come up, then quit Glint so the files unlock.
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        app2.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_url;

    #[test]
    fn accepts_our_release_exe() {
        let url = "https://github.com/sanirudh17/Glint/releases/download/v0.1.4/Glint_0.1.4_x64-setup.exe";
        assert_eq!(validate_url(url).unwrap(), "Glint_0.1.4_x64-setup.exe");
    }

    #[test]
    fn rejects_foreign_host() {
        // A tampered URL pointing elsewhere must never be run.
        assert!(validate_url("https://evil.example.com/Glint_x64-setup.exe").is_err());
        assert!(validate_url("https://github.com/someone/Else/releases/download/v1/setup.exe").is_err());
    }

    #[test]
    fn rejects_non_exe_asset() {
        let url = "https://github.com/sanirudh17/Glint/releases/download/v0.1.4/Glint_0.1.4_x64_en-US.msi";
        assert!(validate_url(url).is_err());
    }
}
