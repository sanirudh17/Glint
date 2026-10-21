//! Multi-scene file IO and bounded export. Source media is never rewritten.
use super::{
    scene_project::{self, Media, SceneProject},
    studio_export::ExportState,
    studio_render, trim,
};
use base64::Engine;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[tauri::command(async)]
pub async fn scene_media_probe(app: tauri::AppHandle, path: String) -> Result<Media, String> {
    let source = PathBuf::from(&path)
        .canonicalize()
        .map_err(|_| format!("Media is missing: {path}"))?;
    if !source.is_file() {
        return Err("Choose an image or video file.".into());
    }
    let canonical = source.to_string_lossy().to_string();
    let media = if trim::is_video_path(&canonical) {
        let probe = trim::recorder_trim_probe(app.clone(), canonical.clone()).await?;
        Media {
            path: canonical,
            kind: "video".into(),
            width: probe.width,
            height: probe.height,
            duration: probe.duration_secs,
            has_audio: probe.has_audio,
        }
    } else {
        let p = source.clone();
        let (width, height) = tauri::async_runtime::spawn_blocking(move || {
            image::ImageReader::open(p)
                .map_err(|e| e.to_string())?
                .with_guessed_format()
                .map_err(|e| e.to_string())?
                .into_dimensions()
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        Media {
            path: canonical,
            kind: "image".into(),
            width,
            height,
            duration: 0.,
            has_audio: false,
        }
    };
    if media.width < 2 || media.height < 2 || media.width as u64 * media.height as u64 > 24_000_000
    {
        return Err("Media must be between 2 pixels and 24 megapixels.".into());
    }
    app.asset_protocol_scope()
        .allow_file(&source)
        .map_err(|e| e.to_string())?;
    Ok(media)
}
#[tauri::command(async)]
pub async fn scene_project_load(
    app: tauri::AppHandle,
    path: String,
) -> Result<SceneProject, String> {
    let path = scene_project::document_path(&path)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32_000_000 {
        return Err("This project file is too large.".into());
    }
    let project: SceneProject = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    project.validate()?;
    for s in &project.scenes {
        if let Some(m) = &s.media {
            app.asset_protocol_scope()
                .allow_file(&m.path)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(project)
}
#[tauri::command(async)]
pub async fn scene_project_save(path: String, project: SceneProject) -> Result<(), String> {
    project.validate()?;
    let path = scene_project::document_path(&path)?;
    let bytes = serde_json::to_vec_pretty(&project).map_err(|e| e.to_string())?;
    if bytes.len() > 32_000_000 {
        return Err("This project file is too large.".into());
    }
    let temp = path.with_extension(format!("{}.partial", nonce()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let result = (|| {
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn nonce() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
struct Workspace(PathBuf);
impl Workspace {
    fn create(parent: &Path) -> Result<Self, String> {
        let p = parent.join(format!(".glint-scenes-{}-{}", std::process::id(), nonce()));
        fs::create_dir(&p).map_err(|e| e.to_string())?;
        Ok(Self(p))
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn notify(app: &tauri::AppHandle, value: f64) {
    let _ = app.emit("video-project-progress", value.clamp(0., 100.));
}

fn run(
    binary: &Path,
    args: Vec<String>,
    cancel: &Arc<AtomicBool>,
    duration: f64,
    progress: Arc<dyn Fn(f64) + Send + Sync>,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled".into());
    }
    let mut command = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .args(["-y", "-v", "error", "-nostats", "-progress", "pipe:1"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(v) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<f64>().ok())
            {
                progress((v / 1_000_000. / duration).clamp(0., 0.999));
            }
        }
    });
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(512_000).read_to_string(&mut text);
        text
    });
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            break child.wait().map_err(|e| e.to_string())?;
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    let _ = reader.join();
    let error = errors.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        Err("Export cancelled".into())
    } else if !status.success() {
        Err(format!("Video processing failed: {error}"))
    } else {
        Ok(())
    }
}
fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

#[tauri::command(async)]
pub async fn scene_project_export(
    app: tauri::AppHandle,
    mut project: SceneProject,
    output: String,
) -> Result<String, String> {
    project.validate()?;
    let output = PathBuf::from(output);
    if !output.is_absolute()
        || output
            .extension()
            .is_none_or(|s| !s.eq_ignore_ascii_case("mp4"))
    {
        return Err("Choose an MP4 export file.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<ExportState>();
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err("An export is already running.".into());
        }
        *slot = Some(cancel.clone());
    }
    let result = async {
        // Probe originals again: stale document metadata cannot bypass trim validation.
        for scene in &mut project.scenes {
            if let Some(media) = &mut scene.media {
                let actual = scene_media_probe(app.clone(), media.path.clone()).await?;
                if actual.kind != scene.kind {
                    return Err("A source media type changed.".into());
                }
                if output.canonicalize().ok().as_ref() == Some(&PathBuf::from(&actual.path)) {
                    return Err("Export to a new file; source media is kept unchanged.".into());
                }
                *media = actual;
            }
        }
        project.validate()?;
        let command: Command = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| e.to_string())?
            .into();
        let binary = PathBuf::from(command.get_program());
        let h = app.clone();
        let path = output.clone();
        let width = project.width;
        let height = project.height;
        let duration = project.validate()?;
        let exported = tauri::async_runtime::spawn_blocking(move || {
            perform(&h, &binary, &project, &path, cancel)
        })
        .await
        .map_err(|e| e.to_string())??;
        let thumb = super::thumb::extract_thumb(&app, &exported).await;
        let row = crate::db::NewCapture {
            kind: "recording".into(),
            path: exported.clone(),
            thumb_path: thumb,
            width: Some(width as i64),
            height: Some(height as i64),
            bytes: fs::metadata(&exported).ok().map(|m| m.len() as i64),
            created_at: chrono::Local::now().timestamp(),
        };
        {
            let db = app.state::<crate::Db>();
            let conn = db.0.lock().unwrap();
            let _ = crate::db::insert_capture(&conn, &row);
            let _ = conn.execute(
                "UPDATE captures SET duration_ms=?1 WHERE path=?2",
                rusqlite::params![(duration * 1000.).round() as i64, exported],
            );
        }
        let _ = app.emit("capture-saved", ());
        notify(&app, 100.);
        Ok(exported)
    }
    .await;
    *app.state::<ExportState>().0.lock().unwrap() = None;
    result
}
fn perform(
    app: &tauri::AppHandle,
    binary: &Path,
    project: &SceneProject,
    output: &Path,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let total = project.validate()?;
    let parent = output.parent().ok_or("Missing output folder")?;
    let workspace = Workspace::create(parent)?;
    let n = project.scenes.len();
    let mut inputs = Vec::new();
    notify(app, 0.);
    for (i, scene) in project.scenes.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled".into());
        }
        let duration = scene.seconds();
        let normalized = workspace.0.join(format!("scene-{i}.mp4"));
        let begin = i as f64 / n as f64 * 80.;
        let span = 80. / n as f64;
        let h = app.clone();
        let progress: Arc<dyn Fn(f64) + Send + Sync> =
            Arc::new(move |p| notify(&h, begin + span * p));
        if scene.kind == "video" {
            let media = scene.media.as_ref().unwrap();
            let rendered = workspace.0.join(format!("rendered-{i}.mp4"));
            let data = project.render_project(scene.start, scene.end)?;
            let events = SceneProject::events(media.width, media.height);
            studio_render::export(
                &studio_render::ExportSpec {
                    binary,
                    source: &media.path,
                    output: &rendered,
                    project: &data,
                    events: &events,
                    width: media.width,
                    height: media.height,
                    fps: 30.,
                    duration: media.duration,
                    audio: media.has_audio,
                    cam: None,
                    cam_overlay: None,
                },
                cancel.clone(),
                |pct| progress(pct / 100. * 0.9),
            )?;
            let mut args = strings(&["-i", &rendered.to_string_lossy()]);
            if !media.has_audio {
                args.extend(strings(&[
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=48000:cl=stereo",
                ]));
            }
            args.extend(strings(&[
                "-map",
                "0:v:0",
                "-map",
                if media.has_audio { "0:a:0" } else { "1:a:0" },
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                &duration.to_string(),
                &normalized.to_string_lossy(),
            ]));
            let p = progress.clone();
            run(
                binary,
                args,
                &cancel,
                duration,
                Arc::new(move |v| p(0.9 + v * 0.1)),
            )?;
        } else {
            let source = if scene.kind == "title" {
                let url = scene
                    .raster
                    .as_deref()
                    .ok_or("Title card needs to be rendered before export.")?;
                let raw = base64::engine::general_purpose::STANDARD
                    .decode(
                        url.strip_prefix("data:image/png;base64,")
                            .ok_or("Invalid title image")?,
                    )
                    .map_err(|e| e.to_string())?;
                let dimensions = image::ImageReader::new(std::io::Cursor::new(&raw))
                    .with_guessed_format()
                    .map_err(|e| e.to_string())?
                    .into_dimensions()
                    .map_err(|e| e.to_string())?;
                if dimensions != (project.width, project.height) {
                    return Err("Title card size does not match the project.".into());
                }
                image::load_from_memory(&raw)
                    .map_err(|e| e.to_string())?
                    .to_rgba8()
            } else {
                let m = scene.media.as_ref().unwrap();
                image::open(&m.path).map_err(|e| e.to_string())?.to_rgba8()
            };
            let data = project.render_project(0., duration)?;
            let events = SceneProject::events(source.width(), source.height());
            let frame =
                studio_render::Renderer::new(&data, &events, source.width(), source.height())?
                    .still_frame(&source);
            let plate = workspace.0.join(format!("plate-{i}.png"));
            frame.save(&plate).map_err(|e| e.to_string())?;
            run(
                binary,
                strings(&[
                    "-loop",
                    "1",
                    "-framerate",
                    "30",
                    "-i",
                    &plate.to_string_lossy(),
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=48000:cl=stereo",
                    "-t",
                    &duration.to_string(),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-shortest",
                    &normalized.to_string_lossy(),
                ]),
                &cancel,
                duration,
                progress.clone(),
            )?;
        }
        inputs.push(normalized);
        notify(app, begin + span);
    }
    let finished = workspace.0.join("finished.mp4");
    let mut args = Vec::new();
    for input in &inputs {
        args.extend(strings(&["-threads", "2", "-i", &input.to_string_lossy()]));
    }
    args.extend(strings(&[
        "-filter_complex_threads",
        "2",
        "-filter_complex",
        &project.join_graph(),
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-t",
        &total.to_string(),
        "-movflags",
        "+faststart",
        &finished.to_string_lossy(),
    ]));
    let h = app.clone();
    run(
        binary,
        args,
        &cancel,
        total,
        Arc::new(move |v| notify(&h, 80. + v * 19.9)),
    )?;
    if fs::metadata(&finished).map_err(|e| e.to_string())?.len() < 1024 {
        return Err("Export produced no video.".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled".into());
    }
    fs::rename(&finished, output).map_err(|e| e.to_string())?;
    notify(app, 99.9);
    Ok(output.to_string_lossy().to_string())
}
