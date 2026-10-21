//! Explicit opt-in whisper.cpp CPU runtime. Pinned artifacts are SHA-256 verified;
//! media/audio never leaves the device. Downloads are separate from transcription.
use super::polish::{self,Caption,Job};
use std::{path::{Path,PathBuf},io::{Read,Write},sync::atomic::{AtomicBool,Ordering},time::Duration};
use sha2::{Digest,Sha256};
use tauri::Manager;
const MODEL_SIZE:u64=77_704_715;
const MODEL_SHA:&str="921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f";
const RUNTIME_SHA:&str="b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732";
fn folder(app:&tauri::AppHandle)->Result<PathBuf,String>{Ok(app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("captions-whisper-1.8.2"))}
fn find_cli(root:&Path)->Option<PathBuf>{for entry in std::fs::read_dir(root).ok()?.flatten(){let p=entry.path();if p.file_name().is_some_and(|n|n.eq_ignore_ascii_case("whisper-cli.exe")){return Some(p);}if p.is_dir(){if let Some(p)=find_cli(&p){return Some(p);}}}None}
fn ready(root:&Path)->bool{root.join("ready.json").is_file()&&root.join("ggml-tiny.en.bin").metadata().is_ok_and(|m|m.len()==MODEL_SIZE)&&find_cli(root).is_some()}
#[tauri::command]
pub fn studio_captions_status(app:tauri::AppHandle)->Result<bool,String>{Ok(ready(&folder(&app)?))}
fn download(app:&tauri::AppHandle,url:&str,dest:&Path,expected:u64,sha:&str,cancel:&AtomicBool,stage:&str)->Result<(),String>{
 let response=ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(20)).build().get(url).call().map_err(|e|e.to_string())?;
 let mut reader=response.into_reader();let mut file=std::fs::File::create(dest).map_err(|e|e.to_string())?;let mut digest=Sha256::new();let mut total=0;let mut chunk=[0u8;65536];
 loop{if cancel.load(Ordering::Relaxed){return Err("Download cancelled".into());}let n=reader.read(&mut chunk).map_err(|e|e.to_string())?;if n==0{break;}total+=n as u64;if total>expected{return Err("Download exceeded the expected size.".into());}file.write_all(&chunk[..n]).map_err(|e|e.to_string())?;digest.update(&chunk[..n]);polish::notify(app,stage,total as f64/expected as f64*100.);}
 if total!=expected||format!("{:x}",digest.finalize())!=sha{return Err("Download integrity check failed. Retry the download.".into());}file.sync_all().map_err(|e|e.to_string())
}
#[tauri::command(async)]
pub async fn studio_captions_install(app:tauri::AppHandle)->Result<(),String>{let job=Job::begin()?;
 tauri::async_runtime::spawn_blocking(move||{let _job=&job;let root=folder(&app)?;if ready(&root){return Ok(());}let parent=root.parent().unwrap();std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;
 let workspace=super::scene_commands::Workspace::temporary()?;let archive=workspace.0.join("whisper.zip");
 download(&app,"https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip",&archive,3_832_432,RUNTIME_SHA,&job.0,"Downloading caption runtime (3.7 MiB)")?;
 let stage=parent.join(format!(".captions-install-{}",std::process::id()));if stage.exists(){return Err("A caption installation is already staged. Restart Glint and retry.".into());}std::fs::create_dir(&stage).map_err(|e|e.to_string())?;
 let result=(||{polish::run({let mut c=polish::command(Path::new("tar.exe"));c.arg("-xf").arg(&archive).arg("-C").arg(&stage);c},&job.0,Duration::from_secs(30))?;
 if find_cli(&stage).is_none(){return Err("The caption runtime archive is missing whisper-cli.exe.".into());}
 download(&app,"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",&stage.join("ggml-tiny.en.bin"),MODEL_SIZE,MODEL_SHA,&job.0,"Downloading English speech model (74.1 MiB)")?;
 std::fs::write(stage.join("ready.json"),b"{\"runtime\":\"whisper.cpp v1.8.2\",\"model\":\"tiny.en\"}").map_err(|e|e.to_string())?;
 if root.exists(){return Err("An incomplete caption installation already exists.".into());}std::fs::rename(&stage,&root).map_err(|e|e.to_string())?;polish::notify(&app,"Captions ready",100.);Ok(())})();
 if result.is_err(){let _=std::fs::remove_dir_all(&stage);}result
 }).await.map_err(|e|e.to_string())?
}
pub fn parse(value:serde_json::Value,duration:f64)->Result<Vec<Caption>,String>{
 let lines=value["transcription"].as_array().ok_or("The caption engine returned invalid output.")?;let mut out=Vec::new();
 for (i,line) in lines.iter().enumerate(){let text=line["text"].as_str().unwrap_or("").trim();if text.is_empty(){continue;}let start=line["offsets"]["from"].as_f64().ok_or("Missing caption start")?/1000.;let end=(line["offsets"]["to"].as_f64().ok_or("Missing caption end")?/1000.).min(duration);if start>=duration||end<=start{continue;}out.push(Caption{id:format!("caption-{i}"),start,end,text:text.chars().take(300).collect(),raster:None});}
 polish::validate_captions(&out,duration)?;Ok(out)
}
#[tauri::command(async)]
pub async fn studio_captions_generate(app:tauri::AppHandle,path:String,duration:f64)->Result<Vec<Caption>,String>{
 if !duration.is_finite()||duration<=0.||duration>1800.{return Err("Captions support recordings up to 30 minutes.".into());}
 let root=folder(&app)?;if !ready(&root){return Err("Download the optional caption engine first.".into());}let job=Job::begin()?;let binary=polish::ffmpeg(&app)?;
 tauri::async_runtime::spawn_blocking(move||{let _job=&job;let workspace=super::scene_commands::Workspace::temporary()?;let audio=workspace.0.join("audio.wav");let output=workspace.0.join("transcript");
 polish::notify(&app,"Preparing local audio",0.);polish::run({let mut c=polish::command(&binary);c.args(["-y","-v","error","-i",&path,"-vn","-ac","1","-ar","16000","-t",&duration.to_string(),"-c:a","pcm_s16le"]).arg(&audio);c},&job.0,Duration::from_secs(180))?;
 polish::notify(&app,"Transcribing on this device",10.);polish::run({let mut c=polish::command(&find_cli(&root).unwrap());c.arg("-m").arg(root.join("ggml-tiny.en.bin")).arg("-f").arg(&audio).args(["-l","en","-t","4","-oj","-ml","70","-of"]).arg(&output);c},&job.0,Duration::from_secs(1800))?;
 let bytes=std::fs::read(output.with_extension("json")).map_err(|e|e.to_string())?;if bytes.len()>8_000_000{return Err("Caption output is too large.".into());}let out=parse(serde_json::from_slice(&bytes).map_err(|e|e.to_string())?,duration)?;polish::notify(&app,"Captions ready to review",100.);Ok(out)
 }).await.map_err(|e|e.to_string())?
}
#[cfg(test)]mod tests{use super::*;#[test]fn whisper_offsets_stay_in_source_time(){let c=parse(serde_json::json!({"transcription":[{"offsets":{"from":1250,"to":2750},"text":" Hello world. "}]}),3.).unwrap();assert_eq!(c[0].start,1.25);assert_eq!(c[0].end,2.75);assert_eq!(c[0].text,"Hello world.");}#[test]fn malformed_or_reversed_output_is_rejected(){assert!(parse(serde_json::json!({}),3.).is_err());assert!(parse(serde_json::json!({"transcription":[{"offsets":{"from":-100,"to":200},"text":"bad"}]}),3.).is_err());}}
