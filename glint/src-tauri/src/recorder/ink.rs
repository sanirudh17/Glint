//! Capture-excluded live ink. The clean recording and editable vectors stay separate.
use tauri::{AppHandle,Manager,Emitter,WebviewUrl,WebviewWindowBuilder};
use serde::{Serialize,Deserialize};
use super::{RecorderState,RecordTarget,video_annotations::Annotation};
pub const LABEL:&str="rec-ink";
#[derive(Clone,Serialize,Deserialize)]
pub struct Config {pub tool:Option<String>,pub color:String,pub width:f64,pub text:String}
impl Default for Config {fn default()->Self {Self{tool:None,color:"#ef5555".into(),width:0.006,text:"Text".into()}}}
fn raise_controls(app:&AppHandle){
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos,HWND_TOPMOST,SWP_NOMOVE,SWP_NOSIZE,SWP_NOACTIVATE};
    if let Some(bar)=app.get_webview_window(super::windows::BAR_LABEL){if let Ok(hwnd)=bar.hwnd(){unsafe{let _=SetWindowPos(windows::Win32::Foundation::HWND(hwnd.0),Some(HWND_TOPMOST),0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);}}}
}
pub fn open(app:&AppHandle,target:RecordTarget)->Result<(),String> {
    if app.get_webview_window(LABEL).is_some(){return Ok(());}
    let g=super::studio::geometry(app,target)?;
    let window=WebviewWindowBuilder::new(app,LABEL,WebviewUrl::App("index.html#/rec-ink".into()))
        .title("Glint live annotations").decorations(false).transparent(true).content_protected(true)
        .always_on_top(true).skip_taskbar(true).resizable(false).shadow(false).focused(false).visible(false)
        .build().map_err(|e|e.to_string())?;
    window.set_position(tauri::PhysicalPosition{x:g.x,y:g.y}).map_err(|e|e.to_string())?;
    window.set_size(tauri::PhysicalSize{width:g.width,height:g.height}).map_err(|e|e.to_string())?;
    let h=app.clone();window.on_window_event(move|event|{if matches!(event,tauri::WindowEvent::Focused(true)){raise_controls(&h);}});
    window.set_ignore_cursor_events(true).map_err(|e|e.to_string())?;
    super::windows::exclude_from_capture(&window);
    window.show().map_err(|e|e.to_string())?;raise_controls(app);Ok(())
}
pub fn close(app:&AppHandle){if let Some(w)=app.get_webview_window(LABEL){let _=w.destroy();}}
#[tauri::command]
pub fn recorder_ink_state(app:AppHandle)->Result<serde_json::Value,String>{
    let state=app.state::<RecorderState>();let guard=state.0.lock().unwrap();let rec=guard.as_ref().ok_or("Not recording")?;
    let studio=rec.studio.as_ref().ok_or("No editable recording metadata")?;
    Ok(serde_json::json!({"config":studio.ink,"items":studio.annotations,"time":studio.sink.clock.current(),"paused":studio.sink.clock.stamp().is_none()}))
}
#[tauri::command]
pub fn recorder_ink_clock(app:AppHandle)->Result<serde_json::Value,String>{
    let state=app.state::<RecorderState>();let guard=state.0.lock().unwrap();let studio=guard.as_ref().and_then(|r|r.studio.as_ref()).ok_or("Not recording")?;
    Ok(serde_json::json!({"time":studio.sink.clock.current(),"paused":studio.sink.clock.stamp().is_none()}))
}
#[tauri::command(async)]
pub async fn recorder_ink_mode(app:AppHandle,config:Config)->Result<(),String>{
    if config.tool.as_deref().is_some_and(|t|!matches!(t,"pen"|"highlight"|"arrow"|"rectangle"|"ellipse"|"text"))||!config.width.is_finite()||!(0.001..=0.04).contains(&config.width)||config.text.chars().count()>500||config.color.len()!=7||!config.color.starts_with('#')||!config.color[1..].bytes().all(|c|c.is_ascii_hexdigit()){return Err("Invalid drawing settings".into());}
    let target={let state=app.state::<RecorderState>();let mut guard=state.0.lock().unwrap();let rec=guard.as_mut().ok_or("Not recording")?;rec.studio.as_mut().ok_or("No Studio metadata")?.ink=config.clone();rec.target};
    open(&app,target)?;
    if let Some(w)=app.get_webview_window(LABEL){w.set_ignore_cursor_events(config.tool.is_none()).map_err(|e|e.to_string())?;}
    raise_controls(&app);
    let _=app.emit_to(LABEL,"recorder-ink-mode",&config);let _=app.emit_to(super::windows::BAR_LABEL,"recorder-ink-mode",config);Ok(())
}
#[tauri::command]
pub fn recorder_ink_begin(app:AppHandle)->Result<f64,String>{
    let state=app.state::<RecorderState>();let guard=state.0.lock().unwrap();guard.as_ref().and_then(|r|r.studio.as_ref()).and_then(|s|s.sink.clock.stamp()).ok_or("Resume recording before drawing".into())
}
#[tauri::command]
pub fn recorder_ink_commit(app:AppHandle,mut annotation:Annotation)->Result<(),String>{
    let state=app.state::<RecorderState>();let mut guard=state.0.lock().unwrap();let studio=guard.as_mut().and_then(|r|r.studio.as_mut()).ok_or("Not recording")?;
    let now=studio.sink.clock.stamp().ok_or("Resume recording before drawing")?;
    annotation.end=now+3.;annotation.raster=None;
    if annotation.start>now+0.05{return Err("Invalid annotation time".into());}
    let mut items=studio.annotations.clone();items.push(annotation);super::video_annotations::validate(&items,now+3.)?;studio.annotations=items;
    let _=app.emit_to(LABEL,"recorder-ink-items",&studio.annotations);Ok(())
}
#[tauri::command]
pub fn recorder_ink_undo(app:AppHandle)->Result<(),String>{let state=app.state::<RecorderState>();let mut guard=state.0.lock().unwrap();let studio=guard.as_mut().and_then(|r|r.studio.as_mut()).ok_or("Not recording")?;studio.annotations.pop();let _=app.emit_to(LABEL,"recorder-ink-items",&studio.annotations);Ok(())}
/// Map source-relative live vectors onto the initial Studio composition once.
pub fn finalize(items:&[Annotation],duration:f64,w:u32,h:u32,project:&serde_json::Value)->Result<Vec<Annotation>,String>{
    let look=serde_json::from_value(project["look"].clone()).map_err(|e|e.to_string())?;
    let l=super::studio_render::layout(w,h,None,&look)?;
    let factor=l.content_w.min(l.content_h) as f64/l.width.min(l.height) as f64;
    let result:Vec<_>=items.iter().filter_map(|a|{let mut a=a.clone();a.end=a.end.min(duration);if a.start>=a.end{return None;}for p in &mut a.points {p.x=(l.x as f64+p.x*l.content_w as f64)/l.width as f64;p.y=(l.y as f64+p.y*l.content_h as f64)/l.height as f64;}a.width=(a.width*factor).clamp(0.001,0.04);a.size=(a.size*factor).clamp(0.01,0.2);Some(a)}).collect();
    super::video_annotations::validate(&result,duration)?;Ok(result)
}

pub fn flash(app:&AppHandle,x:f64,y:f64) {
    let target={let state=app.state::<RecorderState>();let guard=state.0.lock().unwrap();guard.as_ref().map(|r|r.target)};
    if let Some(target)=target {if let Ok(g)=super::studio::geometry(app,target){let _=app.emit_to(LABEL,"recorder-ink-mark",serde_json::json!({"x":x,"y":y,"left":g.x,"top":g.y,"width":g.width,"height":g.height}));}}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn live_marks_keep_timing_and_align_with_the_source_in_studio(){
        let project=super::super::studio::initial_project(10.);
        let item:Annotation=serde_json::from_value(serde_json::json!({"id":"live","kind":"arrow","start":8.,"end":12.,"points":[{"x":0.,"y":0.},{"x":1.,"y":1.}],"color":"#ef5555","width":0.006,"size":0.05,"text":""})).unwrap();
        let marks=finalize(&[item],10.,800,600,&project).unwrap();
        assert_eq!(marks[0].start,8.);assert_eq!(marks[0].end,10.);
        let look=serde_json::from_value(project["look"].clone()).unwrap();let l=super::super::studio_render::layout(800,600,None,&look).unwrap();
        assert!((marks[0].points[0].x*l.width as f64-l.x as f64).abs()<0.001);
        assert!((marks[0].points[1].y*l.height as f64-(l.y+l.content_h) as f64).abs()<0.001);
    }
}
