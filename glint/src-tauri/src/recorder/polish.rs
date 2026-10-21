//! Local, source-anchored polish operations. No source files are rewritten.
use serde::{Deserialize,Serialize};
use std::{path::{Path,PathBuf},sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}},process::{Command,Stdio},io::Read};
use tauri::Emitter;

#[derive(Clone,Debug,Default,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct AudioCleanup {#[serde(default)]pub denoise:bool,#[serde(default)]pub level:bool,#[serde(default)]pub click_sounds:bool}
pub fn camera_graph(index:usize,width:u32,height:u32,segments:&[super::trim::KeepSegment],layout:&str)->String{
 let mut g=String::new();for(i,s) in segments.iter().enumerate(){g.push_str(&format!("[{index}:v]trim={}:{},setpts=(PTS-STARTPTS)/{}[pc{i}];",s.start,s.end,s.speed));}for i in 0..segments.len(){g.push_str(&format!("[pc{i}]"));}g.push_str(&format!("concat=n={}:v=1:a=0[pcam];",segments.len()));
 if layout=="camera-only"{g.push_str(&format!("[0:v]nullsink;[pcam]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1[outvideo]"));}
 else{let half=(width/4)*2;let right=width-half;g.push_str(&format!("[0:v]scale={half}:{height}:force_original_aspect_ratio=decrease,pad={half}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1[pscreen];[pcam]scale={right}:{height}:force_original_aspect_ratio=increase,crop={right}:{height},setsar=1[pcamera];[pscreen][pcamera]hstack=inputs=2[outvideo]"));}g
}
#[derive(Clone,Debug,Deserialize,Serialize)]
pub struct Caption {pub id:String,pub start:f64,pub end:f64,pub text:String,#[serde(default)]pub raster:Option<String>}
pub fn entrance(style:Option<&str>,time:f64)->(f64,f64,f64,f64){let x=(time/0.6).clamp(0.,1.);let p=x*x*(3.-2.*x);let r=1.-p;match style.unwrap_or("none"){"none"=>(1.,0.,0.,1.),"left"=>(p,-r,0.,1.),"right"=>(p,r,0.,1.),"up"=>(p,0.,r,1.),"down"=>(p,0.,-r,1.),"zoom-in"=>(p,0.,0.,0.8+0.2*p),"zoom-out"=>(p,0.,0.,1.2-0.2*p),_=>(p,0.,0.,1.)}}
pub fn validate_captions(captions:&[Caption],duration:f64)->Result<(),String>{
 let mut ids=std::collections::HashSet::new();
 if captions.len()>1000{return Err("Use at most 1,000 caption lines.".into());}
 for c in captions {if !ids.insert(&c.id)||c.id.is_empty()||!c.start.is_finite()||!c.end.is_finite()||c.start<0.||c.end<=c.start||c.end>duration+0.05||c.text.trim().is_empty()||c.text.chars().count()>300||c.raster.as_ref().is_some_and(|r|r.len()>1_000_000){return Err("Invalid caption timing or text.".into());}}
 Ok(())
}
static JOB:OnceLock<Mutex<Option<Arc<AtomicBool>>>>=OnceLock::new();
pub struct Job(pub Arc<AtomicBool>);
impl Job {pub fn begin()->Result<Self,String>{let mut job=JOB.get_or_init(||Mutex::new(None)).lock().unwrap();if job.is_some(){return Err("Finish or cancel the current analysis/download first.".into());}let flag=Arc::new(AtomicBool::new(false));*job=Some(flag.clone());Ok(Self(flag))}}
impl Drop for Job {fn drop(&mut self){*JOB.get().unwrap().lock().unwrap()=None;}}
#[tauri::command]
pub fn studio_polish_cancel(){if let Some(flag)=JOB.get_or_init(||Mutex::new(None)).lock().unwrap().as_ref(){flag.store(true,Ordering::Relaxed);}}
pub fn command(binary:&Path)->Command{let mut cmd=Command::new(binary);#[cfg(windows)]{use std::os::windows::process::CommandExt;cmd.creation_flags(0x08000000);}cmd}
pub fn run(mut cmd:Command,cancel:&AtomicBool,limit:std::time::Duration)->Result<(),String>{
 let mut child=cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;let start=std::time::Instant::now();
 loop {if cancel.load(Ordering::Relaxed)||start.elapsed()>limit{let _=child.kill();let _=child.wait();return Err(if cancel.load(Ordering::Relaxed){"Cancelled"}else{"The operation exceeded its time limit"}.into());}
 if let Some(status)=child.try_wait().map_err(|e|e.to_string())? {return if status.success(){Ok(())}else{Err(format!("Local media operation failed ({status})."))};}std::thread::sleep(std::time::Duration::from_millis(40));}
}
pub fn ffmpeg(app:&tauri::AppHandle)->Result<PathBuf,String>{let exe=std::env::current_exe().map_err(|e|e.to_string())?;let local=exe.parent().unwrap().join("ffmpeg.exe");if local.exists(){return Ok(local);}let dev=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/ffmpeg-x86_64-pc-windows-msvc.exe");if dev.exists(){return Ok(dev);}let _=app;Err("FFmpeg was not found.".into())}
pub fn notify(app:&tauri::AppHandle,stage:&str,percent:f64){let _=app.emit("studio-polish-progress",serde_json::json!({"stage":stage,"percent":percent}));}
#[derive(Serialize,Debug)]pub struct Span {pub start:f64,pub end:f64}
pub fn silence_spans(samples:&[i16],rate:usize,threshold:f64,min_seconds:f64)->Vec<Span>{
 let chunk=(rate/20).max(1);let mut out=Vec::new();let mut began=None;
 for (i,frame) in samples.chunks(chunk).enumerate(){let rms=(frame.iter().map(|s|(*s as f64/32768.).powi(2)).sum::<f64>()/frame.len() as f64).sqrt();let quiet=rms<threshold;
 if quiet&&began.is_none(){began=Some(i as f64/20.);}
 if !quiet {if let Some(start)=began.take(){let end=i as f64/20.;if end-start>=min_seconds{out.push(Span{start:start+0.15,end:end-0.15});}}}}
 if let Some(start)=began{let end=samples.len() as f64/rate as f64;if end-start>=min_seconds{out.push(Span{start:start+0.15,end:(end-0.15).max(start+0.15)});}}
 out
}
#[tauri::command(async)]
pub async fn studio_analyze_silence(app:tauri::AppHandle,path:String)->Result<Vec<Span>,String>{
 let probe=super::trim::recorder_trim_probe(app.clone(),path.clone()).await?;
 if probe.duration_secs>1800.{return Err("Audio analysis supports recordings up to 30 minutes.".into());}
 let job=Job::begin()?;let binary=ffmpeg(&app)?;
 tauri::async_runtime::spawn_blocking(move||{let _job=&job;let workspace=crate::recorder::scene_commands::Workspace::temporary()?;let pcm=workspace.0.join("audio.pcm");notify(&app,"Reading audio",0.);
 run({let mut c=command(&binary);c.args(["-y","-v","error","-i",&path,"-vn","-ac","1","-ar","8000","-t","1800","-f","s16le"]).arg(&pcm);c},&job.0,std::time::Duration::from_secs(180))?;
 let mut bytes=Vec::new();std::fs::File::open(pcm).map_err(|e|e.to_string())?.take(28_800_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;if bytes.len()>28_800_000{return Err("Audio analysis supports recordings up to 30 minutes.".into());}
 let samples:Vec<_>=bytes.chunks_exact(2).map(|v|i16::from_le_bytes([v[0],v[1]])).collect();let out=silence_spans(&samples,8000,0.01,1.0);notify(&app,"Audio analyzed",100.);Ok(out)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn studio_copy_video(path:String)->Result<(),String>{let path=Path::new(&path);if !path.is_file()||!path.extension().is_some_and(|e|e.eq_ignore_ascii_case("mp4")||e.eq_ignore_ascii_case("gif")){return Err("Choose an existing MP4 or GIF.".into());}crate::clipboard::copy_file(path)}
#[cfg(test)]mod tests{use super::*;#[test]fn silence_keeps_breathing_room_and_short_pauses(){let mut audio=vec![8000;8000];audio.extend(vec![0;16000]);audio.extend(vec![8000;8000]);let spans=silence_spans(&audio,8000,0.01,1.);assert_eq!(spans.len(),1);assert!((spans[0].start-1.15).abs()<0.001);assert!((spans[0].end-2.85).abs()<0.001);}#[test]fn invalid_caption_never_reaches_export(){let c=Caption{id:"1".into(),start:1.,end:0.5,text:"Hello".into(),raster:None};assert!(validate_captions(&[c],5.).is_err());}}
