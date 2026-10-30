use super::{
    studio,
    studio_render::{self, ExportSpec, Project},
    trim,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct ExportState(pub Mutex<Option<Arc<AtomicBool>>>);

#[tauri::command(async)]
pub fn studio_discard_source(
    app: tauri::AppHandle,
    path: String,
    export_path: String,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    if app.state::<ExportState>().0.lock().unwrap().is_some() {
        return Err("Wait for export to finish".into());
    }
    if !studio::is_studio_video(&path) {
        return Err("Not a Studio source".into());
    }
    if studio::is_imported_video(&path) {
        return Err("Imported original videos are kept unchanged".into());
    }
    let source = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let folder = source.parent().ok_or("Missing project folder")?;
    let parent = folder.parent().ok_or("Missing project parent")?;
    let exported = PathBuf::from(&export_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let prefix = format!("{} (Studio)", folder.file_stem().unwrap().to_string_lossy());
    if exported.parent() != Some(parent)
        || !exported
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(&prefix)
        || exported.extension().is_none_or(|e| e != "mp4")
        || std::fs::metadata(&exported)
            .map_err(|e| e.to_string())?
            .len()
            < 1024
    {
        return Err("Keep a finished Studio export before deleting the source".into());
    }
    let thumb: Option<String> = {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT thumb_path FROM captures WHERE path=?1",
            [&path],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten()
    };
    let mut files = vec![
        source.clone(),
        folder.join("events.json"),
        super::cam::cam_sidecar_path(&path),
    ];
    if let Some(thumb) = thumb {
        let thumb = PathBuf::from(thumb);
        if thumb.exists() {
            let resolved = thumb.canonicalize().map_err(|e| e.to_string())?;
            let allowed = crate::paths::thumbs_dir(
                &app.path().app_local_data_dir().map_err(|e| e.to_string())?,
            )
            .canonicalize()
            .map_err(|e| e.to_string())?;
            if !resolved.starts_with(allowed) {
                return Err("Source thumbnail is outside the cache".into());
            }
            files.push(resolved);
        }
    }
    for file in files {
        if file.exists() {
            std::fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
    }
    {
        let db = app.state::<crate::Db>();
        db.0.lock()
            .unwrap()
            .execute("DELETE FROM captures WHERE path=?1", [&path])
            .map_err(|e| e.to_string())?;
    }
    let _ = app.emit("capture-saved", ());
    Ok(())
}
#[tauri::command]
pub fn studio_export_cancel(app: tauri::AppHandle) {
    if let Some(cancel) = app.state::<ExportState>().0.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
}

#[tauri::command(async)]
pub async fn studio_export(
    app: tauri::AppHandle,
    path: String,
    project: serde_json::Value,
) -> Result<String, String> {
    if !studio::is_studio_video(&path) {
        return Err("This file is not a Studio project".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ExportState>();
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err("An export is already running".into());
        }
        *slot = Some(cancel.clone());
    }
    let result = perform(&app, &path, project, cancel, None).await;
    *app.state::<ExportState>().0.lock().unwrap() = None;
    result
}
pub(super) async fn perform(
    app: &tauri::AppHandle,
    path: &str,
    project: serde_json::Value,
    cancel: Arc<AtomicBool>,
    intermediate: Option<(PathBuf,f64)>,
) -> Result<String, String> {
    let (intermediate,output_fps) = match intermediate {
        Some((path,fps)) => (Some(path),Some(fps)),
        None => (None,None),
    };
    let data: Project = serde_json::from_value(project.clone()).map_err(|e| e.to_string())?;
    let probe = trim::recorder_trim_probe(app.clone(), path.to_string()).await?;
    data.segments(probe.duration_secs)?;
    let folder = studio::project_folder(path).ok_or("Missing Studio project")?;
    // The GIF caller already flushed edits. Export must not rewrite project state.
    if intermediate.is_none() { studio::write_project(&folder, &project)?; }
    let events: studio::Events = serde_json::from_slice(
        &std::fs::read(folder.join("events.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let command: std::process::Command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .into();
    let binary = PathBuf::from(command.get_program());
    let name = if studio::is_imported_video(path) {
        std::path::Path::new(path).file_stem().unwrap().to_string_lossy()
    } else {folder.file_stem().unwrap().to_string_lossy()};
    let parent = folder.parent().unwrap();
    let output = intermediate.clone().unwrap_or_else(||crate::paths::dedupe(parent, &format!("{name} (Studio).mp4"), |p| p.exists()));
    let tmp = if intermediate.is_some(){output.with_extension("partial.mp4")}else{folder.join("export.partial.mp4")};
    let cam_path = super::cam::cam_sidecar_path(path);
    let cam = if probe.has_cam {
        data.cam.as_ref().filter(|c| c["visible"] == true).map(|c| {
            let nx = c["x"].as_f64().unwrap_or(0.7).clamp(0., 1.);
            let ny = c["y"].as_f64().unwrap_or(0.7).clamp(0., 1.);
            let d = c["diameter"].as_f64().unwrap_or(0.18).clamp(0.06, 0.6);
            let shape = c["shape"].as_str().unwrap_or("circle").to_string();
            let w = (d * probe.width as f64 / 2.).round() * 2.;
            let h = if matches!(shape.as_str(), "circle" | "square") {
                w
            } else {
                (w / (probe.width as f64 / probe.height as f64) / 2.).round() * 2.
            };
            trim::CamOverlay {
                x: (nx * probe.width as f64 / 2.).round() * 2.,
                y: (ny * probe.height as f64 / 2.).round() * 2.,
                w,
                h,
                shape,
            }
        })
    } else {
        None
    };
    let worker_cancel = cancel.clone();
    let path = path.to_string();
    let app_progress = app.clone();
    let progress_scale=if intermediate.is_some(){0.4}else{1.0};
    let tmp_render = tmp.clone();
    let render = tauri::async_runtime::spawn_blocking(move || {
        if progress_scale < 1. && data.look.enabled && data.look.background["type"] == "transparent"
        {
            studio_render::Renderer::new(&data, &events, probe.width, probe.height)?
                .gif_alpha_mask()
                .save(tmp_render.with_file_name("alpha.png"))
                .map_err(|e| e.to_string())?;
        }
        let cam_string = cam_path.to_string_lossy();
        let spec = ExportSpec {
            binary: &binary,
            source: &path,
            output: &tmp_render,
            project: &data,
            events: &events,
            width: probe.width,
            height: probe.height,
            // Compose only the frames GIF needs instead of rendering e.g. 60 FPS
            // then discarding three quarters of them in palette conversion.
            fps: output_fps.unwrap_or(probe.fps).min(probe.fps),
            duration: probe.duration_secs,
            audio: probe.has_audio,
            cam: cam.as_ref().map(|_| cam_string.as_ref()),
            cam_overlay: cam,
        };
        studio_render::export(&spec, worker_cancel, |pct| {
            let _ = app_progress.emit_to(super::windows::TRIM_LABEL, "rec-trim-progress", pct*progress_scale);
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    if let Err(e) = render {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if std::fs::metadata(&tmp)
        .map(|m| m.len() < 1024)
        .unwrap_or(true)
    {
        let _ = std::fs::remove_file(&tmp);
        return Err("Export produced no video".into());
    }
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&tmp);
        return Err("Export cancelled".into());
    }
    // A fresh path and a same-volume rename publish the finished file atomically.
    std::fs::rename(&tmp, &output).map_err(|e| e.to_string())?;
    let output = output.to_string_lossy().to_string();
    if intermediate.is_some(){return Ok(output)}
    let thumb = super::thumb::extract_thumb(app, &output).await;
    let exported = trim::recorder_trim_probe(app.clone(), output.clone()).await?;
    let row = crate::db::NewCapture {
        kind: "recording".into(),
        path: output.clone(),
        thumb_path: thumb,
        width: Some(exported.width as i64),
        height: Some(exported.height as i64),
        bytes: std::fs::metadata(&output).ok().map(|m| m.len() as i64),
        created_at: chrono::Local::now().timestamp(),
    };
    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        let _ = crate::db::insert_capture(&conn, &row);
    }
    let _ = app.emit("capture-saved", ());
    Ok(output)
}
