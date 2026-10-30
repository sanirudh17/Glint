//! Optional PP-OCRv6 on CPU. No network during recognition, no Python runtime.
use super::words::Word;
use oar_ocr::{
    core::config::OrtSessionConfig, domain::tasks::TextDetectionConfig, prelude::*,
    processors::LimitType,
};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::Emitter;
type ModelFile = (&'static str, u64, &'static str);
struct Model {
    id: &'static str,
    folder: &'static str,
    files: [ModelFile; 3],
}
const DICTIONARY: ModelFile = (
    "ppocrv6_dict.txt",
    74_947,
    "b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d",
);
static SMALL: Model = Model {
    id: "ppocrv6-small",
    folder: "ocr-ppv6-small-1",
    files: [
        (
            "pp-ocrv6_small_det.onnx",
            9_880_512,
            "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
        ),
        (
            "pp-ocrv6_small_rec.onnx",
            21_159_378,
            "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
        ),
        DICTIONARY,
    ],
};
static MEDIUM: Model = Model {
    id: "ppocrv6-medium",
    folder: "ocr-ppv6-medium-1",
    files: [
        (
            "pp-ocrv6_medium_det.onnx",
            62_032_837,
            "eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1",
        ),
        (
            "pp-ocrv6_medium_rec.onnx",
            76_554_979,
            "9c09abf0957f7968c7586464b7397b84ad2387a0497a351af40e9acc71b673ba",
        ),
        DICTIONARY,
    ],
};
static ROOT: OnceLock<PathBuf> = OnceLock::new();
#[cfg(test)]
static TEST_MODEL_ROOT: OnceLock<PathBuf> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(false);
static MEDIUM_SELECTED: AtomicBool = AtomicBool::new(false);
static ENGINE: Mutex<Option<(&'static str, OAROCR)>> = Mutex::new(None);
static SEARCH_ENGINES: [Mutex<Option<(&'static str, OAROCR)>>; 2] = [Mutex::new(None), Mutex::new(None)];
static INSTALLING: AtomicBool = AtomicBool::new(false);
pub(super) static CANCEL: AtomicBool = AtomicBool::new(false);
static DOWNLOADED: AtomicU64 = AtomicU64::new(0);
static DOWNLOAD_BYTES: AtomicU64 = AtomicU64::new(114_002_186);
fn model_for(id: &str) -> Option<&'static Model> {
    match id {
        "ppocrv6-small" => Some(&SMALL),
        "ppocrv6-medium" => Some(&MEDIUM),
        _ => None,
    }
}
fn active_model() -> &'static Model {
    if MEDIUM_SELECTED.load(Ordering::Relaxed) {
        &MEDIUM
    } else {
        &SMALL
    }
}
pub fn initialize(root: PathBuf, engine: &str) {
    super::managed::initialize(root.clone());
    let _ = ROOT.set(root);
    set_engine(engine);
}
pub fn set_engine(engine: &str) {
    MEDIUM_SELECTED.store(engine == MEDIUM.id, Ordering::Relaxed);
    ENABLED.store(engine != "tesseract", Ordering::Relaxed);
    if engine == "tesseract" {
        for slot in &SEARCH_ENGINES { if let Ok(mut cache)=slot.try_lock() {*cache=None;} }
        if let Ok(mut cache) = ENGINE.try_lock() {
            *cache = None;
        }
    }
}
pub fn engine_id() -> &'static str {
    if ENABLED.load(Ordering::Relaxed) {
        active_model().folder
    } else {
        "tesseract"
    }
}
fn root(model: &Model) -> Result<PathBuf, String> {
    #[cfg(test)]
    if let Some(path) = TEST_MODEL_ROOT.get() {
        return Ok(path.clone());
    }
    ROOT.get()
        .map(|p| p.join(model.folder))
        .ok_or("OCR engine is not initialized".into())
}
fn model_installed(model: &Model) -> bool {
    root(model).is_ok_and(|p| {
        p.join("ready.json").is_file()
            && p.join("onnxruntime.dll").is_file()
            && model
                .files
                .iter()
                .all(|(n, size, _)| p.join(n).metadata().is_ok_and(|m| m.len() == *size))
    })
}
pub fn installed(engine: &str) -> bool {
    if engine == "tesseract" { super::managed::tesseract_installed() } else { model_for(engine).is_some_and(model_installed) }
}
#[tauri::command]
pub fn ocr_engine_status(engine: Option<String>) -> bool {
    installed(engine.as_deref().unwrap_or(SMALL.id))
}
#[tauri::command]
pub fn ocr_engine_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}
pub(super) fn notify(app: &tauri::AppHandle, stage: &str, percent: f64) {
    let _ = app.emit(
        "ocr-engine-progress",
        serde_json::json!({"stage":stage,"percent":percent}),
    );
}
pub(super) fn download(
    app: &tauri::AppHandle,
    url: &str,
    path: &Path,
    size: u64,
    hash: &str,
) -> Result<(), String> {
    let response = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(20))
        .build()
        .get(url)
        .call()
        .map_err(|e| e.to_string())?;
    let mut input = response.into_reader();
    let mut output = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut count = 0;
    let mut buffer = [0; 65536];
    loop {
        if CANCEL.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        count += n as u64;
        if count > size {
            return Err("Unexpected OCR download size".into());
        }
        output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        digest.update(&buffer[..n]);
        notify(
            app,
            "Downloading local OCR engine",
            (DOWNLOADED.fetch_add(n as u64, Ordering::Relaxed) + n as u64) as f64
                / DOWNLOAD_BYTES.load(Ordering::Relaxed) as f64
                * 98.,
        );
    }
    if count != size || format!("{:x}", digest.finalize()) != hash {
        return Err("OCR download integrity check failed. Retry the download.".into());
    }
    Ok(())
}
#[tauri::command(async)]
pub async fn ocr_engine_install(
    app: tauri::AppHandle,
    engine: Option<String>,
) -> Result<(), String> {
    let id=engine.as_deref().unwrap_or(SMALL.id);
    let model=if id=="tesseract" {None} else {Some(model_for(id).ok_or("Unknown OCR engine")?)};
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("An OCR installation is already running".into());
    }
    CANCEL.store(false, Ordering::Relaxed);
    DOWNLOADED.store(0, Ordering::Relaxed);
    DOWNLOAD_BYTES.store(
        model.map_or(super::managed::TESS_BYTES,|m|m.files.iter().map(|(_,size,_)|size).sum::<u64>()+82_887_349),
        Ordering::Relaxed,
    );
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            INSTALLING.store(false, Ordering::Release);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _reset = Reset;
        let result=match model {Some(model)=>install_files(&app,model),None=>super::managed::install_tesseract(&app)};
        if result.is_ok() {let _=app.emit("ocr-engine-changed",());}
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
pub async fn ocr_engine_remove(app:tauri::AppHandle,engine:String)->Result<super::managed::Removal,String> {
    super::managed::folder(&engine)?;
    if INSTALLING.swap(true,Ordering::AcqRel) {return Err("Finish or cancel the current OCR installation first".into());}
    struct Reset;
    impl Drop for Reset {fn drop(&mut self){INSTALLING.store(false,Ordering::Release);}}
    super::indexing::library_index_cancel(app.clone());
    tauri::async_runtime::spawn_blocking(move||{
        let _reset=Reset;
        let mut cache=ENGINE.lock().map_err(|_|"Restart Glint to reset the OCR engine")?;
        if cache.as_ref().is_some_and(|(id,_)|*id==engine) {*cache=None;}
        let mut search_caches=Vec::new();
        for slot in &SEARCH_ENGINES {
            let mut cache=slot.lock().map_err(|_|"Restart Glint to reset the OCR engine")?;
            if cache.as_ref().is_some_and(|(id,_)|*id==engine) {*cache=None;}
            search_caches.push(cache);
        }
        let _tess=super::managed::TESS_USE.write().map_err(|_|"Restart Glint to reset OCR")?;
        let result=super::managed::remove_owned(super::managed::root()?,&engine)?;
        let _=app.emit("ocr-engine-changed",());
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}

fn install_files(app: &tauri::AppHandle, model: &Model) -> Result<(), String> {
    if model_installed(model) {
        return Ok(());
    }
    let dest = root(model)?;
    let parent = dest.parent().ok_or("Invalid OCR folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let stage = parent.join(format!(".ocr-install-{}-{nonce}", std::process::id()));
    std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        for (name, size, hash) in model.files {
            download(
                app,
                &format!("https://www.modelscope.cn/models/greatv/oar-ocr/resolve/master/{name}"),
                &stage.join(name),
                size,
                hash,
            )?;
        }
        let archive = stage.join("runtime.zip");
        download(app, "https://github.com/microsoft/onnxruntime/releases/download/v1.31.0/onnxruntime-win-x64-1.31.0.zip", &archive, 82_887_349, "3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195")?;
        notify(app, "Installing local OCR engine", 99.);
        let mut cmd = std::process::Command::new("tar.exe");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let prefix = "onnxruntime-win-x64-1.31.0";
        let status = cmd
            .arg("-xf")
            .arg(&archive)
            .arg("-C")
            .arg(&stage)
            .args([
                format!("{prefix}/lib/onnxruntime.dll"),
                format!("{prefix}/LICENSE"),
                format!("{prefix}/ThirdPartyNotices.txt"),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Could not unpack the OCR runtime".into());
        }
        if CANCEL.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        for (source, target) in [
            ("lib/onnxruntime.dll", "onnxruntime.dll"),
            ("LICENSE", "ONNX-Runtime-LICENSE.txt"),
            (
                "ThirdPartyNotices.txt",
                "ONNX-Runtime-ThirdPartyNotices.txt",
            ),
        ] {
            std::fs::rename(stage.join(prefix).join(source), stage.join(target))
                .map_err(|e| e.to_string())?;
        }
        std::fs::write(
            stage.join("PP-OCR-LICENSE.txt"),
            include_str!("PP-OCR-LICENSE.txt"),
        )
        .map_err(|e| e.to_string())?;
        std::fs::remove_file(archive).map_err(|e| e.to_string())?;
        std::fs::remove_dir_all(stage.join(prefix)).map_err(|e| e.to_string())?;
        std::fs::write(
            stage.join("ready.json"),
            serde_json::to_vec(
                &serde_json::json!({"engine":model.id,"runtime":"ONNX Runtime 1.31.0"}),
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        // An interrupted earlier install can be repaired without manual file deletion.
        if dest.exists() {
            let old = parent.join(format!(".ocr-incomplete-{nonce}"));
            std::fs::rename(&dest, &old)
                .map_err(|_| "Restart Glint, then retry the OCR installation.")?;
            if let Err(error) = std::fs::rename(&stage, &dest) {
                let _ = std::fs::rename(&old, &dest);
                return Err(error.to_string());
            }
            let _ = std::fs::remove_dir_all(old);
        } else {
            std::fs::rename(&stage, &dest).map_err(|e| e.to_string())?;
        }
        notify(app, "OCR engine ready", 100.);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&stage);
    }
    result
}
/// Shared by capture-text, indexing and privacy geometry. The cache is serialized,
/// so idle memory is paid only after first use, and concurrent scans cannot flood CPU.
pub fn recognize_if_enabled(
    rgba: &[u8],
    w: u32,
    h: u32,
    cancel: &AtomicBool,
) -> Option<Result<Vec<Word>, String>> {
    if !ENABLED.load(Ordering::Relaxed) {
        return None;
    }
    Some(recognize(rgba, w, h, cancel))
}
fn lock_engine<'a>(cache: &'a Mutex<Option<(&'static str, OAROCR)>>, model: &'static Model, cancel: &AtomicBool, word_boxes: bool) -> Result<std::sync::MutexGuard<'a, Option<(&'static str, OAROCR)>>, String> {
    let start = std::time::Instant::now();
    let mut guard = loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        if start.elapsed() > Duration::from_secs(45) {
            return Err("OCR is busy. Try again after the current scan.".into());
        }
        match cache.try_lock() {
            Ok(g) => break g,
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(_) => return Err("Restart Glint to reset the OCR engine".into()),
        }
    };
    if guard.as_ref().is_none_or(|(id, _)| *id != model.id) {
        let root = root(model)?;
        ort::init_from(root.join("onnxruntime.dll"))
            .map_err(|e| e.to_string())?
            .commit();
        let config = TextDetectionConfig {
            limit_side_len: Some(if word_boxes {4096} else {1536}),
            limit_type: Some(LimitType::Max),
            max_side_len: Some(4096),
            box_threshold: 0.5,
            unclip_ratio: 1.6,
            ..Default::default()
        };
        *guard = Some((
            model.id,
            OAROCRBuilder::new(
                root.join(model.files[0].0),
                root.join(model.files[1].0),
                root.join(model.files[2].0),
            )
            .ort_session(
                OrtSessionConfig::new()
                    .with_intra_threads(4)
                    .with_inter_threads(1),
            )
            .text_detection_config(config)
            .return_word_box(word_boxes)
            .build()
            .map_err(|e| e.to_string())?,
        ));
    }
    Ok(guard)
}

fn recognize(rgba: &[u8], w: u32, h: u32, cancel: &AtomicBool) -> Result<Vec<Word>, String> {
    let model = active_model();
    if !model_installed(model) {
        return Err(
            "Install the selected OCR engine in Settings > Capture > Text recognition engine.".into(),
        );
    }
    if w == 0
        || h == 0
        || w as u64 * h as u64 > 40_000_000
        || rgba.len() != w as usize * h as usize * 4
    {
        return Err("Choose a smaller screenshot for OCR".into());
    }
    let mut guard = lock_engine(&ENGINE, model, cancel, true)?;
    let mut words = vec![];
    // Preserve small text on full-window and scrolling captures. Resizing a tall
    // screenshot to one detector input makes its glyphs too small to detect.
    // Overlapping strips keep text at native resolution and give cut lines room.
    for (tile, (top, bottom)) in strips(h).into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        let image = image::RgbImage::from_fn(w, bottom - top, |x, y| {
            let p = &rgba[(((y + top) * w + x) * 4) as usize..];
            image::Rgb(std::array::from_fn(|c| {
                ((p[c] as u32 * p[3] as u32 + 255 * (255 - p[3] as u32)) / 255) as u8
            }))
        });
        let results = guard
            .as_ref()
            .unwrap()
            .1
            .predict(vec![image])
            .map_err(|e| e.to_string())?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }

        for result in results {
            for (line, region) in result.text_regions.iter().enumerate() {
                let Some(text) = region.text.as_deref() else {
                    continue;
                };
                if region.confidence.unwrap_or(0.) < 0.5 {
                    continue;
                }
                let fallback = &region.bounding_box;
                let center = (fallback.y_min() + fallback.y_max()) / 2.;
                if top > 0 && center < 64. || bottom < h && center >= (bottom - top - 64) as f32 {
                    continue;
                }
                let chars = text.chars().collect::<Vec<_>>();
                let boxes = region
                    .word_boxes
                    .as_ref()
                    .filter(|boxes| boxes.len() == chars.len());
                let mut begin = 0;
                for end in 0..=chars.len() {
                    if end < chars.len() && !chars[end].is_whitespace() {
                        continue;
                    }
                    if begin < end {
                        let (x0, y0, x1, y1) = if let Some(boxes) = boxes {
                            let slice = &boxes[begin..end];
                            (
                                slice
                                    .iter()
                                    .map(|b| b.x_min())
                                    .fold(f32::INFINITY, f32::min),
                                slice
                                    .iter()
                                    .map(|b| b.y_min())
                                    .fold(f32::INFINITY, f32::min),
                                slice.iter().map(|b| b.x_max()).fold(0., f32::max),
                                slice.iter().map(|b| b.y_max()).fold(0., f32::max),
                            )
                        } else {
                            (
                                fallback.x_min(),
                                fallback.y_min(),
                                fallback.x_max(),
                                fallback.y_max(),
                            )
                        };
                        let x = (x0 as f64).clamp(0., w as f64);
                        let y = (y0 as f64 + top as f64).clamp(0., h as f64);
                        words.push(Word {
                            text: chars[begin..end].iter().collect(),
                            line: format!("neural-{tile}-{line}"),
                            x,
                            y,
                            w: (x1 as f64 - x).clamp(0., w as f64 - x),
                            h: (y1 as f64 + top as f64 - y).clamp(0., h as f64 - y),
                        });
                    }
                    begin = end + 1;
                }
            }
        }
    }
    if !ENABLED.load(Ordering::Relaxed) {
        *guard = None;
    }
    Ok(words)
}

/// Search needs text, not per-character alignment. Keep native-resolution crops
/// for recognition and bound the detector input; privacy retains its detailed path.
/// A separate session avoids rebuilding the interactive privacy OCR session.
pub fn recognize_search_text(rgba: &[u8], w: u32, h: u32, cancel: &AtomicBool) -> Result<String, String> {
    recognize_search_text_slot(rgba,w,h,cancel,0)
}
pub fn recognize_search_text_slot(rgba: &[u8], w: u32, h: u32, cancel: &AtomicBool, slot: usize) -> Result<String, String> {
    if !ENABLED.load(Ordering::Relaxed) {
        return super::words::recognize_tesseract(rgba, w, h, cancel).map(|words|super::words::text(&words));
    }
    let model=active_model();
    if !model_installed(model) { return Err("Install the selected OCR engine in Settings > Capture.".into()); }
    if w==0 || h==0 || w as u64*h as u64>40_000_000 || rgba.len()!=w as usize*h as usize*4 {return Err("Choose a smaller screenshot for OCR".into());}
    let Some((left,origin_y,width,height))=search_bounds(rgba,w,h) else {return Ok(String::new());};
    let guard=lock_engine(&SEARCH_ENGINES[slot.min(1)],model,cancel,false)?;
    let mut lines=Vec::new();
    for (top,bottom) in strips(height) {
        if cancel.load(Ordering::Relaxed) {return Err("Cancelled".into());}
        let image=image::RgbImage::from_fn(width,bottom-top,|x,y|{
            let p=&rgba[(((y+top+origin_y)*w+x+left)*4) as usize..];
            image::Rgb(std::array::from_fn(|c|((p[c] as u32*p[3] as u32+255*(255-p[3] as u32))/255) as u8))
        });
        let results=guard.as_ref().unwrap().1.predict(vec![image]).map_err(|e|e.to_string())?;
        for result in results { for region in result.text_regions {
            let center=(region.bounding_box.y_min()+region.bounding_box.y_max())/2.;
            if (top>0&&center<64.) || (bottom<height&&center>=(bottom-top-64) as f32) || region.confidence.unwrap_or(0.)<0.5 {continue;}
            if let Some(text)=region.text {if !text.trim().is_empty(){lines.push(text);}}
        }}
    }
    if cancel.load(Ordering::Relaxed) || !ENABLED.load(Ordering::Relaxed) || active_model().id!=model.id {return Err("Cancelled".into());}
    Ok(lines.join("\n"))
}

/// Remove only exactly uniform background margins, retaining 32px of context.
/// Detection never needs to process a full desktop of blank pixels. Compare the
/// composited colors, so fully transparent pixels cannot invent visible content.
fn search_bounds(rgba:&[u8],w:u32,h:u32)->Option<(u32,u32,u32,u32)> {
    fn rgb(p:&[u8])->[u8;3] {std::array::from_fn(|c|((p[c] as u32*p[3] as u32+255*(255-p[3] as u32))/255) as u8)}
    let background=rgb(rgba); let (mut left,mut top,mut right,mut bottom)=(w,h,0,0);
    for y in 0..h {for x in 0..w {
        if rgb(&rgba[((y*w+x)*4) as usize..])!=background {left=left.min(x);top=top.min(y);right=right.max(x+1);bottom=bottom.max(y+1);}
    }}
    if right==0 {return None;}
    left=left.saturating_sub(32);top=top.saturating_sub(32);right=right.saturating_add(32).min(w);bottom=bottom.saturating_add(32).min(h);
    Some((left,top,right-left,bottom-top))
}

fn strips(height: u32) -> Vec<(u32, u32)> {
    let mut out = vec![];
    let mut top = 0;
    loop {
        let bottom = (top + 1024).min(height);
        out.push((top, bottom));
        if bottom == height {
            break;
        }
        top = bottom - 128;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_bounds_preserve_context_and_visible_alpha() {
        let mut image=image::RgbaImage::from_pixel(200,160,image::Rgba([255,255,255,255]));
        assert_eq!(search_bounds(&image,200,160),None);
        image.put_pixel(80,70,image::Rgba([0,0,0,255]));
        assert_eq!(search_bounds(&image,200,160),Some((48,38,65,65)));
        image.put_pixel(0,159,image::Rgba([254,255,255,255]));
        assert_eq!(search_bounds(&image,200,160),Some((0,38,113,122)));
        let clear=vec![0;200*160*4];assert_eq!(search_bounds(&clear,200,160),None);
    }
    #[test]
    fn strips_cover_tall_captures_with_context() {
        for height in [1, 1024, 1025, 2000, 12000] {
            let parts = strips(height);
            assert_eq!(parts[0].0, 0);
            assert_eq!(parts.last().unwrap().1, height);
            assert!(parts.iter().all(|(a, b)| a < b && b - a <= 1024));
            assert!(parts.windows(2).all(|p| p[0].1 - p[1].0 == 128));
        }
    }
    /// Explicit integration check: never downloads models in cargo test.
    #[test]
    #[ignore = "requires GLINT_OCR_FIXTURES and GLINT_OCR_MODELS"]
    fn native_screenshot_fixtures() {
        let fixtures = PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        TEST_MODEL_ROOT.get_or_init(|| PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap()));
        MEDIUM_SELECTED.store(
            std::env::var("GLINT_OCR_TIER").as_deref() == Ok("medium"),
            Ordering::Relaxed,
        );
        ENABLED.store(true, Ordering::Relaxed);
        let cancel = AtomicBool::new(false);
        let mut reports = vec![];
        for size in [11, 14, 18] {
            for theme in ["light", "dark"] {
                let name = format!("fixture-{size}-{theme}.png");
                let image = image::open(fixtures.join(&name)).unwrap().to_rgba8();
                let start = std::time::Instant::now();
                let words =
                    recognize(image.as_raw(), image.width(), image.height(), &cancel).unwrap();
                assert!(!words.is_empty());
                assert!(words.iter().all(|w| w.w > 0.
                    && w.h > 0.
                    && w.x >= 0.
                    && w.y >= 0.
                    && w.x + w.w <= image.width() as f64
                    && w.y + w.h <= image.height() as f64));
                let suggestions =
                    super::super::privacy::detect(&words, image.width(), image.height());
                reports.push(serde_json::json!({"fixture":name,"ms":start.elapsed().as_millis(),"text":super::super::words::text(&words),"suggestions":suggestions,"words":words.iter().map(|w|serde_json::json!({"text":w.text,"x":w.x,"y":w.y,"w":w.w,"h":w.h})).collect::<Vec<_>>()}));
            }
        }
        let cases: serde_json::Value =
            serde_json::from_slice(&std::fs::read(fixtures.join("privacy-fixtures.json")).unwrap())
                .unwrap();
        for case in cases.as_array().unwrap() {
            let name = case["file"].as_str().unwrap();
            let image = image::open(fixtures.join(name)).unwrap().to_rgba8();
            let start = std::time::Instant::now();
            let words = recognize(image.as_raw(), image.width(), image.height(), &cancel).unwrap();
            let found = super::super::privacy::detect_with_fallback(
                &words,
                &image,
                image.width(),
                image.height(),
                &cancel,
            )
            .unwrap();
            for bound in case["bounds"].as_array().unwrap() {
                let kind = bound["kind"].as_str().unwrap();
                let b = bound["box"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect::<Vec<_>>();
                assert!(
                    found.iter().any(|s| s.kind == kind
                        && s.x <= b[0]
                        && s.y <= b[1]
                        && s.x + s.w >= b[2]
                        && s.y + s.h >= b[3]),
                    "{name} did not cover the complete {kind}: {found:?}"
                );
            }
            // Render the suggested opaque masks and verify the complete value box.
            let mut redacted = image.clone();
            for suggestion in &found {
                for y in (suggestion.y.floor() as u32)
                    ..((suggestion.y + suggestion.h).ceil() as u32).min(image.height())
                {
                    for x in (suggestion.x.floor() as u32)
                        ..((suggestion.x + suggestion.w).ceil() as u32).min(image.width())
                    {
                        redacted.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
                    }
                }
            }
            redacted
                .save(fixtures.join(format!("redacted-{name}")))
                .unwrap();
            for bound in case["bounds"].as_array().unwrap() {
                let b = bound["box"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect::<Vec<_>>();
                for y in b[1].ceil() as u32..b[3].floor() as u32 {
                    for x in b[0].ceil() as u32..b[2].floor() as u32 {
                        assert_eq!(
                            redacted.get_pixel(x, y).0,
                            [0, 0, 0, 255],
                            "{name} exposed pixels"
                        );
                    }
                }
            }
            reports.push(serde_json::json!({"fixture":name,"ms":start.elapsed().as_millis(),"text":super::super::words::text(&words),"suggestions":found}));
        }
        std::fs::write(
            fixtures.join(std::env::var("GLINT_OCR_REPORT").unwrap_or("native-result.json".into())),
            serde_json::to_vec_pretty(&reports).unwrap(),
        )
        .unwrap();
    }
    #[test]
    #[ignore = "requires the owned exact-text corpus and local OCR models"]
    fn native_exact_text_corpus() {
        let fixtures = PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        TEST_MODEL_ROOT.get_or_init(|| PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap()));
        let medium = std::env::var("GLINT_OCR_TIER").as_deref() == Ok("medium");
        MEDIUM_SELECTED.store(medium, Ordering::Relaxed);
        ENABLED.store(true, Ordering::Relaxed);
        let cases: serde_json::Value = serde_json::from_slice(
            &std::fs::read(fixtures.join("accuracy-fixtures.json")).unwrap(),
        )
        .unwrap();
        let mut reports = vec![];
        let cancel = AtomicBool::new(false);
        for case in cases.as_array().unwrap() {
            let file = case["file"].as_str().unwrap();
            let image = image::open(fixtures.join(file)).unwrap().to_rgba8();
            let words = recognize(&image, image.width(), image.height(), &cancel).unwrap();
            assert!(!words.is_empty());
            let text = super::super::words::text(&words)
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let expected = case["expected"].as_str().unwrap();
            let actual: Vec<char> = text.chars().collect();
            let mut row: Vec<usize> = (0..=actual.len()).collect();
            for (i, a) in expected.chars().enumerate() {
                let mut next = vec![i + 1];
                for (j, b) in actual.iter().enumerate() {
                    next.push(
                        (next[j] + 1)
                            .min(row[j + 1] + 1)
                            .min(row[j] + usize::from(a != *b)),
                    );
                }
                row = next;
            }
            reports.push(serde_json::json!({"file":file,"text":text,"cer":row[actual.len()] as f64/expected.chars().count() as f64,"key_exact":text.contains(case["key"].as_str().unwrap()),"token_exact":text.contains(case["token"].as_str().unwrap())}));
        }
        std::fs::write(
            fixtures.join(format!(
                "native-accuracy-{}-result.json",
                if medium { "medium" } else { "small" }
            )),
            serde_json::to_vec_pretty(&reports).unwrap(),
        )
        .unwrap();
    }

    #[test]
    #[ignore = "requires local models and owned screenshot fixtures; real seventy-image throughput"]
    fn native_seventy_image_index_throughput() {
        let fixtures=PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        TEST_MODEL_ROOT.get_or_init(||PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap()));
        MEDIUM_SELECTED.store(false,Ordering::Relaxed);ENABLED.store(true,Ordering::Relaxed);
        let cases:serde_json::Value=serde_json::from_slice(&std::fs::read(fixtures.join("search-fixtures.json")).unwrap()).unwrap();
        let cases=cases.as_array().unwrap(); let cancel=AtomicBool::new(false);
        let start=std::time::Instant::now();
        for index in 0..70 {
            let image=image::open(fixtures.join(cases[index%cases.len()]["file"].as_str().unwrap())).unwrap().to_rgba8();
            recognize(&image,image.width(),image.height(),&cancel).unwrap();
        }
        let before_ms=start.elapsed().as_millis();
        let next=std::sync::atomic::AtomicUsize::new(0);let completed=std::sync::atomic::AtomicUsize::new(0);
        let start=std::time::Instant::now();
        std::thread::scope(|scope| {for slot in 0..2 {
            let next=&next;let completed=&completed;let cancel=&cancel;let fixtures=&fixtures;
            scope.spawn(move||loop {
                let index=next.fetch_add(1,Ordering::Relaxed); if index>=70 {break;}
                let image=image::open(fixtures.join(cases[index%cases.len()]["file"].as_str().unwrap())).unwrap().to_rgba8();
                recognize_search_text_slot(&image,image.width(),image.height(),cancel,slot).unwrap();
                completed.fetch_add(1,Ordering::Relaxed);
            });
        }});
        let after_ms=start.elapsed().as_millis();assert_eq!(completed.load(Ordering::Relaxed),70);
        let report=serde_json::json!({"images":70,"before_ms":before_ms,"after_ms":after_ms,"workers":2});
        println!("{report}");
        std::fs::write(std::env::var("GLINT_INDEX_THROUGHPUT_REPORT").unwrap(),serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }

    #[test]
    #[ignore = "requires owned LibrarySearch fixtures and local models; compare real index paths"]
    fn native_text_only_search_benchmark() {
        let fixtures=PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        TEST_MODEL_ROOT.get_or_init(||PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap()));
        MEDIUM_SELECTED.store(false,Ordering::Relaxed);ENABLED.store(true,Ordering::Relaxed);
        let cases:serde_json::Value=serde_json::from_slice(&std::fs::read(fixtures.join("search-fixtures.json")).unwrap()).unwrap();
        let cancel=AtomicBool::new(false); let mut reports=vec![];
        let conn=rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE captures(id INTEGER PRIMARY KEY,created_at INTEGER,deleted_at INTEGER,title TEXT,title_origin TEXT);").unwrap();
        crate::db::text_index::ensure(&conn).unwrap();
        for (index,case) in cases.as_array().unwrap().iter().enumerate() {
            let id=index as i64+1;let file=case["file"].as_str().unwrap();
            conn.execute("INSERT INTO captures(id,created_at) VALUES(?1,?1)",[id]).unwrap();
            let image=image::open(fixtures.join(file)).unwrap().to_rgba8();
            let start=std::time::Instant::now();
            let original=super::super::words::text(&recognize(&image,image.width(),image.height(),&cancel).unwrap());
            let original_ms=start.elapsed().as_millis();
            let start=std::time::Instant::now();
            let text=recognize_search_text(&image,image.width(),image.height(),&cancel).unwrap();
            let search_ms=start.elapsed().as_millis();
            crate::db::text_index::put(&conn,id,&original,"old",false).unwrap();
            let old_hits:Vec<_>=case["queries"].as_array().unwrap().iter().map(|q|crate::db::text_index::search(&conn,q.as_str().unwrap()).unwrap().contains(&id)).collect();
            crate::db::text_index::put(&conn,id,&text,"new",false).unwrap();
            let queries:Vec<_>=case["queries"].as_array().unwrap().iter().zip(old_hits).map(|(q,old)|{
                let found=crate::db::text_index::search(&conn,q.as_str().unwrap()).unwrap().contains(&id);
                assert!(!old||found,"lost search phrase in {file}: {q}");
                serde_json::json!({"query":q,"old_found":old,"found":found})
            }).collect();
            println!("index {file}: {original_ms}ms -> {search_ms}ms");
            reports.push(serde_json::json!({"file":file,"original_ms":original_ms,"search_ms":search_ms,"queries":queries}));
        }
        let dest=PathBuf::from(std::env::var("GLINT_INDEX_BENCH_REPORT").unwrap());
        std::fs::write(dest,serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    }

    #[test]
    #[ignore = "requires owned LibrarySearch fixtures and local PP-OCRv6 Small models"]
    fn native_library_search_retrieval() {
        let fixtures=PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        TEST_MODEL_ROOT.get_or_init(||PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap()));
        MEDIUM_SELECTED.store(false,Ordering::Relaxed);ENABLED.store(true,Ordering::Relaxed);
        let cases:serde_json::Value=serde_json::from_slice(&std::fs::read(fixtures.join("search-fixtures.json")).unwrap()).unwrap();
        let conn=rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE captures(id INTEGER PRIMARY KEY,created_at INTEGER,deleted_at INTEGER,title TEXT,title_origin TEXT);").unwrap();
        crate::db::text_index::ensure(&conn).unwrap();
        let cancel=AtomicBool::new(false);let mut reports=vec![];
        for (index,case) in cases.as_array().unwrap().iter().enumerate() {
            let id=index as i64+1;let file=case["file"].as_str().unwrap();
            conn.execute("INSERT INTO captures(id,created_at) VALUES(?1,?1)",[id]).unwrap();
            let image=image::open(fixtures.join(file)).unwrap().to_rgba8();let start=std::time::Instant::now();
            let result=recognize(&image,image.width(),image.height(),&cancel);
            let error=result.as_ref().err().cloned();let text=result.map(|words|super::super::words::text(&words)).unwrap_or_default();
            crate::db::text_index::put(&conn,id,&text,"owned",false).unwrap();
            let queries:Vec<_>=case["queries"].as_array().unwrap().iter().map(|q|{let query=q.as_str().unwrap();serde_json::json!({"query":query,"found":crate::db::text_index::search(&conn,query).unwrap().contains(&id)})}).collect();
            assert!(!crate::db::text_index::search(&conn,"unfindablezebrafortyseven").unwrap().contains(&id));
            reports.push(serde_json::json!({"file":file,"error":error,"ms":start.elapsed().as_millis(),"text":text,"queries":queries}));
        }
        std::fs::write(fixtures.join("native-search-result.json"),serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    }
    #[test]
    #[ignore="requires local PP-OCRv6 models; checks loaded-model removal and reinstall"]
    fn native_model_removal_roundtrip() {
        let source=PathBuf::from(std::env::var("GLINT_OCR_MODELS").unwrap());
        let parent=PathBuf::from(std::env::var("GLINT_MODEL_LIFECYCLE").unwrap());
        let root=parent.join(format!("owned-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let dest=root.join(SMALL.folder);std::fs::create_dir_all(&dest).unwrap();
        let copy=||{std::fs::create_dir_all(&dest).unwrap();for entry in std::fs::read_dir(&source).unwrap().flatten(){if entry.file_type().unwrap().is_file(){std::fs::copy(entry.path(),dest.join(entry.file_name())).unwrap();}}};
        copy();initialize(root.clone(),SMALL.id);
        let fixture=PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap()).join("document-light.png");
        let image=image::open(fixture).unwrap().to_rgba8();
        assert!(!recognize(&image,image.width(),image.height(),&AtomicBool::new(false)).unwrap().is_empty());
        *ENGINE.lock().unwrap()=None;
        let removed=super::super::managed::remove_owned(&root,SMALL.id).unwrap();assert!(!installed(SMALL.id));
        assert!(recognize(&image,image.width(),image.height(),&AtomicBool::new(false)).unwrap_err().contains("Install"));
        // A loaded process-wide ONNX DLL may require a restart to reclaim its file,
        // but the model itself is removed and can be installed and used again now.
        copy();assert!(installed(SMALL.id));
        assert!(!recognize(&image,image.width(),image.height(),&AtomicBool::new(false)).unwrap().is_empty());
        *ENGINE.lock().unwrap()=None;
        super::super::managed::remove_owned(&root,SMALL.id).unwrap();
        std::fs::write(parent.join("result.json"),serde_json::to_vec_pretty(&serde_json::json!({"passed":true,"pendingRuntimeRestart":removed.pending_restart,"root":root})).unwrap()).unwrap();
        let _=std::fs::remove_dir_all(root);
    }

}
