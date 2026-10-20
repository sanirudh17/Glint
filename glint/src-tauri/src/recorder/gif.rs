//! Palette-based GIF export, sharing Studio privacy/look rendering and Quick trims.
use super::{studio_export::ExportState, trim};
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
pub const MAX_BYTES: u64 = 25_000_000;
#[derive(Clone, serde::Deserialize)]
pub struct Options {
    pub fps: u32,
    pub width: u32,
    pub repeat: bool,
}
impl Options {
    pub fn validate(&self) -> Result<(), String> {
        if !(5..=30).contains(&self.fps) || !(320..=1920).contains(&self.width) {
            return Err("Choose 5–30 FPS and a width of 320–1,920 pixels".into());
        }
        Ok(())
    }
}
pub fn palette_filter(options: &Options) -> String {
    format!(
        "fps={},scale=w='min({},iw)':h=-1:flags=lanczos",
        options.fps, options.width
    )
}

fn run(
    binary: &Path,
    args: &[String],
    cancel: Arc<AtomicBool>,
    guard: Option<&Path>,
    duration: f64,
    progress: impl Fn(f64) + Send + 'static,
) -> Result<(), String> {
    let mut command = std::process::Command::new(binary);
    command
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(value) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<f64>().ok())
            {
                progress((value / 1_000_000. / duration.max(0.001) * 100.).clamp(0., 100.))
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut text = Vec::new();
        let _ = stderr.read_to_end(&mut text);
    });
    let outcome = loop {
        let too_large =
            guard.is_some_and(|p| std::fs::metadata(p).is_ok_and(|m| m.len() > MAX_BYTES));
        if cancel.load(Ordering::Relaxed) || too_large {
            let _ = child.kill();
            let _ = child.wait();
            break Err(if too_large {
                "GIF exceeds 25 MB. Reduce width, FPS or duration."
            } else {
                "Export cancelled"
            }
            .to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("GIF export failed. Try a shorter selection.".into())
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    let _ = reader.join();
    let _ = errors.join();
    outcome
}
#[tauri::command(async)]
pub async fn recorder_gif_export(
    app: tauri::AppHandle,
    path: String,
    project: Option<serde_json::Value>,
    segments: Vec<trim::KeepSegment>,
    fade_in: f64,
    fade_out: f64,
    cam_overlay: Option<trim::CamOverlay>,
    options: Options,
) -> Result<String, String> {
    options.validate()?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ExportState>();
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err("An export is already running".into());
        }
        *slot = Some(cancel.clone());
    }
    let result = perform(
        &app,
        &path,
        project,
        segments,
        fade_in,
        fade_out,
        cam_overlay,
        options,
        cancel,
    )
    .await;
    *app.state::<ExportState>().0.lock().unwrap() = None;
    result
}
async fn perform(
    app: &tauri::AppHandle,
    path: &str,
    project: Option<serde_json::Value>,
    segments: Vec<trim::KeepSegment>,
    fade_in: f64,
    fade_out: f64,
    cam_overlay: Option<trim::CamOverlay>,
    options: Options,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let probe = trim::recorder_trim_probe(app.clone(), path.into()).await?;
    let segments = if let Some(value) = project.as_ref() {
        let data: super::studio_render::Project =
            serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        data.segments(probe.duration_secs)?
    } else {
        trim::validate_segments(&segments, probe.duration_secs)?
    };
    let duration = trim::output_duration(&segments);
    if duration > 60. {
        return Err("GIFs are limited to 60 seconds. Trim the selection first.".into());
    }
    if !fade_in.is_finite() || !fade_out.is_finite() || fade_in < 0. || fade_out < 0. {
        return Err("Invalid fades".into());
    }
    let job = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!(
            "gif-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    std::fs::create_dir_all(&job).map_err(|e| e.to_string())?;
    let intermediate = job.join("render.mp4");
    let palette = job.join("palette.png");
    let alpha = job.join("alpha.png");
    let dir =
        crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Recording);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now(), "gif");
    let output = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    let partial = output.with_extension("partial.gif");
    let binary: std::process::Command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .into();
    let binary = PathBuf::from(binary.get_program());
    let result: Result<String, String> = async {
        if let Some(project) = project {
            super::studio_export::perform(
                app,
                path,
                project,
                cancel.clone(),
                Some((intermediate.clone(),options.fps as f64)),
            )
            .await?;
        } else {
            let cam_path = super::cam::cam_sidecar_path(path);
            let cam = if probe.has_cam { cam_overlay } else { None };
            let args = trim::build_trim_args(
                path,
                &intermediate.to_string_lossy(),
                &segments,
                probe.has_audio,
                fade_in,
                fade_out,
                cam.as_ref().map(|_| cam_path.to_string_lossy()).as_deref(),
                cam,
            );
            let b = binary.clone();
            let c = cancel.clone();
            let a = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                run(&b, &args, c, None, duration, move |pct| {
                    let _ = a.emit_to(super::windows::TRIM_LABEL, "rec-trim-progress", pct * 0.4);
                })
            })
            .await
            .map_err(|e| e.to_string())??;
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled".into());
        }
        let filter = palette_filter(&options);
        let mut args = vec![
            "-hide_banner".into(),
            "-v".into(),
            "error".into(),
            "-y".into(),
            "-i".into(),
            intermediate.to_string_lossy().into_owned(),
        ];
        if alpha.exists() {
            args.extend(["-i".into(), alpha.to_string_lossy().into_owned(),
                "-filter_complex".into(),format!("[0:v][1:v]alphamerge,{filter},palettegen=stats_mode=diff:reserve_transparent=1")]);
        } else {
            args.extend(["-vf".into(),format!("{filter},palettegen=stats_mode=diff")]);
        }
        args.extend([
            "-frames:v".into(),
            "1".into(),
            "-update".into(),
            "1".into(),
            "-progress".into(),
            "pipe:1".into(),
            palette.to_string_lossy().into_owned(),
        ]);
        let b = binary.clone();
        let c = cancel.clone();
        let a = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run(&b, &args, c, None, duration, move |pct| {
                let _ = a.emit_to(
                    super::windows::TRIM_LABEL,
                    "rec-trim-progress",
                    40. + pct * 0.2,
                );
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        let mut args = vec![
            "-hide_banner".into(),
            "-v".into(),
            "error".into(),
            "-y".into(),
            "-i".into(),
            intermediate.to_string_lossy().into_owned(),
            "-i".into(),
            palette.to_string_lossy().into_owned(),
        ];
        let base = if alpha.exists() {
            args.extend(["-i".into(),alpha.to_string_lossy().into_owned()]);
            "[0:v][2:v]alphamerge,"
        } else { "[0:v]" };
        args.extend([
            "-lavfi".into(),
            format!("{base}{filter}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle:alpha_threshold=128"),
            "-an".into(),
            "-loop".into(),
            if options.repeat { "0" } else { "-1" }.into(),
            "-progress".into(),
            "pipe:1".into(),
            partial.to_string_lossy().into_owned(),
        ]);
        let b = binary.clone();
        let c = cancel.clone();
        let guard = partial.clone();
        let a = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run(&b, &args, c, Some(&guard), duration, move |pct| {
                let _ = a.emit_to(
                    super::windows::TRIM_LABEL,
                    "rec-trim-progress",
                    60. + pct * 0.4,
                );
            })
        })
        .await
        .map_err(|e| e.to_string())??;
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled".into());
        }
        let bytes = std::fs::metadata(&partial)
            .map_err(|e| e.to_string())?
            .len();
        if bytes == 0 || bytes > MAX_BYTES {
            return Err("GIF exceeds 25 MB. Reduce width, FPS or duration.".into());
        }
        std::fs::rename(&partial, &output).map_err(|e| e.to_string())?;
        Ok(output.to_string_lossy().into_owned())
    }
    .await;
    for file in [
        &intermediate,
        &intermediate.with_extension("partial.mp4"),
        &palette,
        &alpha,
        &partial,
    ] {
        let _ = std::fs::remove_file(file);
    }
    let _ = std::fs::remove_dir(&job);
    let output: String = result?;
    let size = image::ImageReader::open(&output)
        .map_err(|e| e.to_string())?
        .into_dimensions()
        .map_err(|e| e.to_string())?;
    let thumb = super::thumb::extract_thumb(app, &output).await;
    let row = crate::db::NewCapture {
        kind: "gif".into(),
        path: output.clone(),
        thumb_path: thumb,
        width: Some(size.0 as i64),
        height: Some(size.1 as i64),
        bytes: std::fs::metadata(&output).ok().map(|m| m.len() as i64),
        created_at: chrono::Local::now().timestamp(),
    };
    crate::db::insert_capture(&app.state::<crate::Db>().0.lock().unwrap(), &row)
        .map_err(|e| e.to_string())?;
    let _ = app.emit("capture-saved", ());
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn options_are_bounded_and_palette_respects_aspect() {
        assert!(Options {
            fps: 0,
            width: 0,
            repeat: true,
        }
        .validate()
        .is_err());
        let o = Options {
            fps: 15,
            width: 960,
            repeat: false,
        };
        assert!(o.validate().is_ok());
        assert!(palette_filter(&o).contains("fps=15"));
        assert!(palette_filter(&o).contains("h=-1"));
    }
}
