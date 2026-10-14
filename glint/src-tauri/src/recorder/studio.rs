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
struct Clock { base: f64, accepting: bool, anchor: Option<(Instant, f64)> }
/// Each FFmpeg span has its own PTS clock. Pause time is excluded, and the next
/// span is based on the probed duration of the actual finished MP4, not wall time.
#[derive(Clone, Default)]
pub struct EventClock(Arc<Mutex<Clock>>);
impl EventClock {
    pub fn arm(&self) {self.0.lock().unwrap().accepting=true;}
    pub fn sync(&self, pts: f64) { let mut c=self.0.lock().unwrap(); if !c.accepting {return;} c.anchor=Some((Instant::now(), pts.max(0.0))); }
    pub fn stamp(&self) -> Option<f64> { let c=self.0.lock().unwrap(); c.anchor.map(|(start, pts)| c.base+pts+start.elapsed().as_secs_f64()) }
    pub fn pause(&self) { let mut c=self.0.lock().unwrap();c.accepting=false;c.anchor=None; }
    pub fn finish_span(&self, duration: f64) { let mut c=self.0.lock().unwrap(); c.base+=duration.max(0.0); c.anchor=None; }
}
#[derive(Clone)]
pub struct EventSink { pub clock: EventClock, tx: mpsc::SyncSender<InputEvent> }
impl EventSink {
    pub fn push(&self, data: serde_json::Value) {
        if let Some(t)=self.clock.stamp() { let _=self.tx.try_send(InputEvent {t,data}); }
    }
}
pub struct StudioCapture {
    pub folder: PathBuf,
    pub sink: EventSink,
    pub hooks: Option<super::fx::hooks::HookHandle>,
    writer: Option<std::thread::JoinHandle<Result<(), String>>>,
}
impl StudioCapture {
    pub fn create(folder: PathBuf, geometry: Geometry) -> Result<Self,String> {
        std::fs::create_dir(&folder).map_err(|e|e.to_string())?;
        let file=File::create(folder.join("events.partial")).map_err(|e|e.to_string())?;
        let header=serde_json::to_string(&geometry).map_err(|e|e.to_string())?;
        let (tx,rx)=mpsc::sync_channel::<InputEvent>(2048);
        let writer=std::thread::spawn(move || {
            let mut file=BufWriter::new(file);
            write!(file,"{{\"version\":1,\"geometry\":{header},\"events\":[").map_err(|e|e.to_string())?;
            let mut first=true;
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
pub fn is_studio_video(path:&str)->bool {let p=Path::new(path);p.file_name().is_some_and(|n|n=="video.mp4")&&p.parent().is_some_and(|d|d.join("project.json").is_file())}
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
#[tauri::command(async)]
pub fn studio_load(path:String)->Result<Option<serde_json::Value>,String> {
    if !is_studio_video(&path) {return Ok(None);}
    let dir=Path::new(&path).parent().unwrap();
    let project:serde_json::Value=serde_json::from_slice(&std::fs::read(dir.join("project.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if project["version"]!=1 && project["version"]!=2 {return Err("Unsupported Studio project version".into());}
    let events:Events=serde_json::from_slice(&std::fs::read(dir.join("events.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    Ok(Some(serde_json::json!({"project":project,"events":events})))
}
#[tauri::command(async)]
pub fn studio_save(path:String,project:serde_json::Value)->Result<(),String> {
    if !is_studio_video(&path) {return Err("This video is not a Studio project".into());}
    write_project(Path::new(&path).parent().unwrap(),&project)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn pause_excludes_wall_time() {let c=EventClock::default();assert!(c.stamp().is_none());c.arm();c.sync(1.0);assert!(c.stamp().unwrap()>=1.0);c.pause();assert!(c.stamp().is_none());c.finish_span(2.25);c.arm();c.sync(0.5);assert!((c.stamp().unwrap()-2.75).abs()<0.01);}
    #[test] fn projects_start_versioned_and_styled() {let p=initial_project(60.0);assert_eq!(p["version"],1);assert_eq!(p["look"]["enabled"],true);assert_eq!(p["clips"][0]["end"],60.0);}
}
