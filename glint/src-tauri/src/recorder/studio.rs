//! Studio capture metadata. Recorder-owned; Quick recordings never enter this path.
use serde::{Deserialize, Serialize};
use std::{fs::File, io::{BufWriter, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex, mpsc}, time::Instant};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub x: i32, pub y: i32, pub width: u32, pub height: u32,
    pub monitor_x: i32, pub monitor_y: i32, pub monitor_width: u32, pub monitor_height: u32,
    pub dpi_scale: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InputEvent {
    pub t: f64,
    #[serde(flatten)]
    pub data: serde_json::Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Events { pub version: u32, pub geometry: Geometry, pub events: Vec<InputEvent> }

#[derive(Default)]
struct Clock { base: f64, paused_at:f64, accepting: bool, anchor: Option<(Instant, f64)> }
/// Each FFmpeg span has its own PTS clock. Pause time is excluded, and the next
/// span is based on the probed duration of the actual finished MP4, not wall time.
#[derive(Clone, Default)]
pub struct EventClock(Arc<Mutex<Clock>>);
impl EventClock {
    pub fn arm(&self) {self.0.lock().unwrap().accepting=true;}
    pub fn sync(&self, pts: f64) { let mut c=self.0.lock().unwrap(); if !c.accepting {return;} c.anchor=Some((Instant::now(), pts.max(0.0))); }
    pub fn stamp(&self) -> Option<f64> { let c=self.0.lock().unwrap(); c.anchor.map(|(start, pts)| c.base+pts+start.elapsed().as_secs_f64()) }
    pub fn pause(&self) { let mut c=self.0.lock().unwrap();if let Some((start,pts))=c.anchor {c.paused_at=c.base+pts+start.elapsed().as_secs_f64();}c.accepting=false;c.anchor=None; }
    pub fn finish_span(&self, duration: f64) { let mut c=self.0.lock().unwrap(); c.base+=duration.max(0.0); c.paused_at=c.base; c.anchor=None; }
}
#[derive(Clone)]
pub struct EventSink { pub clock: EventClock, tx: mpsc::SyncSender<InputEvent> }
impl EventSink {
    pub fn push_effects(&self,cfg:super::fx::FxConfig) {
        let t=self.clock.stamp().unwrap_or_else(||{let c=self.clock.0.lock().unwrap();c.base.max(c.paused_at)});
        let _=self.tx.try_send(InputEvent{t,data:serde_json::json!({"kind":"effects","clicks":cfg.click_viz,"keystrokes":cfg.keystrokes,"spotlight":cfg.spotlight})});
    }
    pub fn push(&self, data: serde_json::Value) -> Option<f64> {
        let t=self.clock.stamp()?;self.tx.try_send(InputEvent {t,data}).ok()?;Some(t)
    }
}
pub struct StudioCapture {
    pub folder: PathBuf,
    pub sink: EventSink,
    pub hooks: Option<super::fx::hooks::HookHandle>,
    writer: Option<std::thread::JoinHandle<Result<(), String>>>,
}
impl StudioCapture {
    pub fn create(folder: PathBuf, geometry: Geometry, fx:super::fx::FxConfig) -> Result<Self,String> {
        std::fs::create_dir(&folder).map_err(|e|e.to_string())?;
        let file=File::create(folder.join("events.partial")).map_err(|e|e.to_string())?;
        let header=serde_json::to_string(&geometry).map_err(|e|e.to_string())?;
        let (tx,rx)=mpsc::sync_channel::<InputEvent>(2048);
        let writer=std::thread::spawn(move || {
            let mut file=BufWriter::new(file);
            write!(file,"{{\"version\":1,\"geometry\":{header},\"events\":[").map_err(|e|e.to_string())?;
            serde_json::to_writer(&mut file,&serde_json::json!({"t":0.0,"kind":"effects","clicks":fx.click_viz,"keystrokes":fx.keystrokes,"spotlight":fx.spotlight})).map_err(|e|e.to_string())?;
            let mut first=false;
            for event in rx { if !first {file.write_all(b",").map_err(|e|e.to_string())?;} first=false; serde_json::to_writer(&mut file,&event).map_err(|e|e.to_string())?; }
            file.write_all(b"]}").map_err(|e|e.to_string())?;
            file.flush().map_err(|e|e.to_string())?;
            file.get_ref().sync_all().map_err(|e|e.to_string())
        });
        Ok(Self { folder, sink:EventSink { clock:EventClock::default(),tx },hooks:None,writer:Some(writer) })
    }
    pub fn finish(mut self) -> Result<PathBuf,String> {
        self.sink.clock.pause();
        if let Some(h)=self.hooks.take() {h.stop();}
        drop(self.sink);
        if let Some(writer)=self.writer.take() {writer.join().map_err(|_|"event writer failed")??;}
        std::fs::rename(self.folder.join("events.partial"),self.folder.join("events.json")).map_err(|e|e.to_string())?;
        Ok(self.folder)
    }
}
pub fn geometry(app:&tauri::AppHandle,target:super::RecordTarget) -> Result<Geometry,String> {
    let monitor=app.primary_monitor().map_err(|e|e.to_string())?.ok_or("No monitor available")?;
    let pos=monitor.position(); let size=monitor.size();
    let (x,y,width,height)=match target {super::RecordTarget::Region{x,y,w,h}=>(x,y,w,h),super::RecordTarget::Fullscreen=>(pos.x,pos.y,size.width,size.height)};
    Ok(Geometry {x,y,width,height,monitor_x:pos.x,monitor_y:pos.y,monitor_width:size.width,monitor_height:size.height,dpi_scale:monitor.scale_factor()})
}
pub fn folder_for(dir:&Path,name:&str)->PathBuf {
    let stem=Path::new(name).file_stem().unwrap().to_string_lossy();
    let mut folder=dir.join(format!("{stem}.glint-studio")); let mut i=2;
    while folder.exists() {folder=dir.join(format!("{stem} {i}.glint-studio"));i+=1;}
    folder
}
pub fn import_folder(path:&Path)->PathBuf {
    path.with_file_name(format!("{}.glint-studio",path.file_name().unwrap_or_default().to_string_lossy()))
}
fn import_matches(folder:&Path,source:&Path)->bool {
    let Ok(bytes)=std::fs::read(folder.join("origin.json")) else {return false;};
    let Ok(origin)=serde_json::from_slice::<PathBuf>(&bytes) else {return false;};
    source.canonicalize().is_ok_and(|p|p==origin)
}
pub fn project_folder(path:&str)->Option<PathBuf> {
    let source=Path::new(path);
    if source.file_name().is_some_and(|n|n=="video.mp4") {
        if let Some(folder)=source.parent().filter(|d|d.join("project.json").is_file()) {return Some(folder.to_owned());}
    }
    let folder=import_folder(source);
    (folder.join("project.json").is_file()&&import_matches(&folder,source)).then_some(folder)
}
pub fn is_studio_video(path:&str)->bool {project_folder(path).is_some()}
pub fn is_imported_video(path:&str)->bool {
    project_folder(path).is_some_and(|folder|import_matches(&folder,Path::new(path)))
}
pub fn initial_project(duration:f64)->serde_json::Value {
    serde_json::json!({"version":1,"look":{"enabled":true,"background":{"type":"gradient","gradientId":"dusk"},"padding":40,"radius":12,"shadow":35,"aspect":"auto","chrome":{"style":"none","theme":"light","buttons":"mac","title":"","url":""}},
        "cursor":{"visible":true,"smoothing":0.5,"size":32,"style":"arrow","hideIdle":true,"idleSeconds":2.0,"clicks":true,"clickSize":36,"keystrokes":false},
        "crop":null,"clips":[{"id":1,"start":0.0,"end":duration,"kept":true,"speed":1.0,"order":0}],"fadeIn":0.0,"fadeOut":0.0,"cam":null,"zoomSegments":[],"masks":[]})
}
pub fn write_project(folder:&Path,project:&serde_json::Value)->Result<(),String> {
    if !matches!(project.get("version").and_then(|v|v.as_u64()),Some(1|2)) {return Err("Unsupported Studio project version".into());}
    let tmp=folder.join("project.pending");let dest=folder.join("project.json");
    let bytes=serde_json::to_vec_pretty(project).map_err(|e|e.to_string())?;
    let mut file=File::create(&tmp).map_err(|e|e.to_string())?;file.write_all(&bytes).map_err(|e|e.to_string())?;file.sync_all().map_err(|e|e.to_string())?;drop(file);
    // MoveFileEx provides atomic replacement on Windows, including an existing destination.
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{MoveFileExW,MOVEFILE_REPLACE_EXISTING,MOVEFILE_WRITE_THROUGH};
        let from:Vec<u16>=tmp.as_os_str().encode_wide().chain(Some(0)).collect();let to:Vec<u16>=dest.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {MoveFileExW(PCWSTR(from.as_ptr()),PCWSTR(to.as_ptr()),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)}.map_err(|e|e.to_string())?;
    }
    #[cfg(not(windows))] std::fs::rename(&tmp,&dest).map_err(|e|e.to_string())?;
    Ok(())
}
/// Standalone videos share the Studio editor. Only edit metadata is written;
/// input events cannot be recovered from a baked recording, and the source is read-only.
fn prepare_import(path:&Path,duration:f64,width:u32,height:u32)->Result<(),String> {
    static IMPORT_LOCK:Mutex<()>=Mutex::new(());
    let _guard=IMPORT_LOCK.lock().map_err(|_|"Studio import lock failed")?;
    if !duration.is_finite()||duration<=0.||width<2||height<2 {return Err("This video has no editable frames".into());}
    let source=path.canonicalize().map_err(|e|e.to_string())?;
    if project_folder(&path.to_string_lossy()).is_some() {return Ok(());}
    let folder=import_folder(path);
    if folder.exists()&&!import_matches(&folder,path) {return Err("An unrelated Studio folder already exists beside this video".into());}
    std::fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
    std::fs::write(folder.join("origin.json"),serde_json::to_vec(&source).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let geometry=Geometry{x:0,y:0,width,height,monitor_x:0,monitor_y:0,monitor_width:width,monitor_height:height,dpi_scale:1.};
    let events=Events{version:1,geometry,events:vec![]};
    std::fs::write(folder.join("events.json"),serde_json::to_vec(&events).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let mut project=initial_project(duration);
    project["version"]=2.into();project["importedVideo"]=true.into();
    project["look"]["padding"]=0.into();project["look"]["radius"]=0.into();project["look"]["shadow"]=0.into();
    project["look"]["background"]=serde_json::json!({"type":"solid","color":"#101319"});
    project["cursor"]["visible"]=false.into();project["cursor"]["clicks"]=false.into();project["cursor"]["hideIdle"]=false.into();
    write_project(&folder,&project)
}
#[tauri::command(async)]
pub async fn studio_import(app:tauri::AppHandle,path:String)->Result<serde_json::Value,String> {
    if !is_studio_video(&path) {
        let probe=super::trim::recorder_trim_probe(app,path.clone()).await?;
        prepare_import(Path::new(&path),probe.duration_secs,probe.width,probe.height)?;
    }
    studio_load(path)?.ok_or_else(||"Studio project could not be prepared".into())
}
#[tauri::command(async)]
pub fn studio_load(path:String)->Result<Option<serde_json::Value>,String> {
    let Some(dir)=project_folder(&path) else {return Ok(None);};
    let project:serde_json::Value=serde_json::from_slice(&std::fs::read(dir.join("project.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if project["version"]!=1 && project["version"]!=2 {return Err("Unsupported Studio project version".into());}
    let events:Events=serde_json::from_slice(&std::fs::read(dir.join("events.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    Ok(Some(serde_json::json!({"project":project,"events":events})))
}
#[tauri::command(async)]
pub fn studio_save(path:String,project:serde_json::Value)->Result<(),String> {
    let dir=project_folder(&path).ok_or("This video is not a Studio project")?;
    write_project(&dir,&project)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn pause_excludes_wall_time() {let c=EventClock::default();assert!(c.stamp().is_none());c.arm();c.sync(1.0);assert!(c.stamp().unwrap()>=1.0);c.pause();assert!(c.stamp().is_none());c.finish_span(2.25);c.arm();c.sync(0.5);assert!((c.stamp().unwrap()-2.75).abs()<0.01);}
    #[test] fn projects_start_versioned_and_styled() {let p=initial_project(60.0);assert_eq!(p["version"],1);assert_eq!(p["look"]["enabled"],true);assert_eq!(p["clips"][0]["end"],60.0);}
    #[test] fn importing_a_video_preserves_source_and_reopens_edits() {
        let root=std::env::temp_dir().join(format!("glint-import-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        let source=root.join("Older recording.mp4");std::fs::write(&source,b"original video bytes").unwrap();
        prepare_import(&source,12.,640,360).unwrap();
        let path=source.to_string_lossy().to_string();
        let data=studio_load(path.clone()).unwrap().unwrap();
        assert!(is_imported_video(&path));assert_eq!(data["project"]["importedVideo"],true);
        assert_eq!(data["events"]["events"],serde_json::json!([]));
        assert_eq!(data["events"]["geometry"]["width"],640);
        assert_eq!(data["project"]["cursor"]["visible"],false);
        assert_eq!(data["project"]["look"]["padding"],0);
        let mut project=data["project"].clone();project["crop"]=serde_json::json!({"x":20,"y":10,"w":400,"h":300});
        studio_save(path.clone(),project.clone()).unwrap();
        prepare_import(&source,12.,640,360).unwrap();
        assert_eq!(studio_load(path).unwrap().unwrap()["project"],project);
        assert_eq!(std::fs::read(&source).unwrap(),b"original video bytes");
        let folder=import_folder(&source);
        for name in ["project.json","origin.json","events.json"] {std::fs::remove_file(folder.join(name)).unwrap();}
        std::fs::remove_dir(folder).unwrap();std::fs::remove_file(source).unwrap();std::fs::remove_dir(root).unwrap();
    }
    #[test] fn import_refuses_to_replace_an_unrelated_project_folder() {
        let root=std::env::temp_dir().join(format!("glint-import-conflict-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();let source=root.join("clip.mp4");std::fs::write(&source,b"source").unwrap();
        let folder=import_folder(&source);std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("project.json"),b"keep these edits").unwrap();
        assert!(prepare_import(&source,12.,640,360).unwrap_err().contains("unrelated"));
        assert_eq!(std::fs::read(folder.join("project.json")).unwrap(),b"keep these edits");
        std::fs::remove_file(folder.join("project.json")).unwrap();std::fs::remove_dir(folder).unwrap();std::fs::remove_file(source).unwrap();std::fs::remove_dir(root).unwrap();
    }
}

/// All new recordings keep editable Studio metadata; old Quick files still open.
pub fn recording_mode(_requested:Option<bool>)->bool {true}

#[cfg(test)] mod mode_tests {
    #[test] fn every_new_capture_uses_studio_metadata(){for requested in [None,Some(false),Some(true)]{assert!(super::recording_mode(requested));}}
}
