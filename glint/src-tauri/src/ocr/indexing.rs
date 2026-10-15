use std::sync::{Mutex,Arc,atomic::{AtomicBool,Ordering}};
use tauri::{Manager,Emitter};
#[derive(Default,Clone,serde::Serialize)]pub struct Progress{pub running:bool,pub done:usize,pub total:usize,pub errors:usize}
#[derive(Default)]pub struct IndexState{pub running:AtomicBool,pub cancel:Arc<AtomicBool>,pub progress:Mutex<Progress>}
#[tauri::command]pub fn library_index_status(app:tauri::AppHandle)->Progress{app.state::<IndexState>().progress.lock().unwrap().clone()}
#[tauri::command]pub fn library_index_cancel(app:tauri::AppHandle){app.state::<IndexState>().cancel.store(true,Ordering::Relaxed);}
#[tauri::command(async)]pub fn library_search_text(app:tauri::AppHandle,query:String)->Result<Vec<i64>,String>{
    if !app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().index_screenshot_text{return Ok(vec![]);}
    let db=app.state::<crate::Db>();let conn=db.0.lock().unwrap();crate::db::ensure_captures_table(&conn).map_err(|e|e.to_string())?;
    crate::db::text_index::search(&conn,&query).map_err(|_|"Couldn't search screenshot text".into())
}
#[tauri::command(async)]pub fn library_index_clear(app:tauri::AppHandle)->Result<(),String>{
    app.state::<IndexState>().cancel.store(true,Ordering::Relaxed);
    let db=app.state::<crate::Db>();let conn=db.0.lock().unwrap();crate::db::ensure_captures_table(&conn).map_err(|e|e.to_string())?;
    conn.execute("DELETE FROM capture_text",[]).map_err(|_|"Couldn't clear screenshot text")?;Ok(())
}
#[tauri::command]pub fn library_index_start(app:tauri::AppHandle){
    if !app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().index_screenshot_text{return;}
    let state=app.state::<IndexState>();if state.running.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err(){return;}
    state.cancel.store(false,Ordering::Relaxed);*state.progress.lock().unwrap()=Progress{running:true,..Progress::default()};
    std::thread::spawn(move||{
        let state=app.state::<IndexState>();
        let rows={let db=app.state::<crate::Db>();let conn=db.0.lock().unwrap();crate::db::list_captures(&conn).unwrap_or_default()};
        let rows:Vec<_>=rows.into_iter().filter(|r|r.kind=="screenshot").collect();state.progress.lock().unwrap().total=rows.len();
        for row in rows{
            if state.cancel.load(Ordering::Relaxed)||!app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().index_screenshot_text{break;}
            let fingerprint=crate::db::text_index::fingerprint(&row.path);
            if let Some(fingerprint)=fingerprint{
                let current={let db=app.state::<crate::Db>();let conn=db.0.lock().unwrap();crate::db::text_index::current(&conn,row.id,&fingerprint)};
                if !current{
                    let result=(||{
                        let mut reader=image::ImageReader::open(&row.path).map_err(|_|())?;let mut limits=image::Limits::default();limits.max_alloc=Some(128*1024*1024);reader.limits(limits);
                        let image=reader.decode().map_err(|_|())?.to_rgba8();let words=super::words::recognize(&image,image.width(),image.height(),&state.cancel).map_err(|_|())?;
                        Ok::<_,()>(super::words::text(&words))
                    })();
                    if state.cancel.load(Ordering::Relaxed){break;}
                    let auto_name=app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().auto_name_captures;
                    let failed=result.is_err();let text=result.unwrap_or_default();
                    {let db=app.state::<crate::Db>();let conn=db.0.lock().unwrap();if state.cancel.load(Ordering::Relaxed){break;}let _=crate::db::text_index::put(&conn,row.id,&text,&fingerprint,auto_name);}
                    if failed{state.progress.lock().unwrap().errors+=1;}
                }
            }
            state.progress.lock().unwrap().done+=1;
        }
        state.progress.lock().unwrap().running=false;state.running.store(false,Ordering::SeqCst);
        let _=app.emit("library-indexed",());
    });
}
