use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};
#[derive(Default, Clone, serde::Serialize)]
pub struct Progress {
    pub running: bool,
    pub done: usize,
    pub total: usize,
    pub errors: usize,
}
#[derive(Default)]
pub struct IndexState {
    pub running: AtomicBool,
    pub rescan: AtomicBool,
    pub cancel: Arc<AtomicBool>,
    pub progress: Mutex<Progress>,
}
#[tauri::command]
pub fn library_index_status(app: tauri::AppHandle) -> Progress {
    app.state::<IndexState>().progress.lock().unwrap().clone()
}
#[tauri::command]
pub fn library_index_cancel(app: tauri::AppHandle) {
    app.state::<IndexState>()
        .cancel
        .store(true, Ordering::Relaxed);
}
#[tauri::command(async)]
pub fn library_search_text(app: tauri::AppHandle, query: String) -> Result<Vec<i64>, String> {
    if !app
        .state::<crate::settings::commands::SettingsState>()
        .0
        .lock()
        .unwrap()
        .index_screenshot_text
    {
        return Ok(vec![]);
    }
    let db = app.state::<crate::Db>();
    let conn = db.0.lock().unwrap();
    crate::db::ensure_captures_table(&conn).map_err(|e| e.to_string())?;
    crate::db::text_index::search(&conn, &query)
        .map_err(|_| "Couldn't search screenshot text".into())
}
#[tauri::command(async)]
pub fn library_index_clear(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<IndexState>()
        .cancel
        .store(true, Ordering::Relaxed);
    let db = app.state::<crate::Db>();
    let conn = db.0.lock().unwrap();
    crate::db::ensure_captures_table(&conn).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM capture_text", [])
        .map_err(|_| "Couldn't clear screenshot text")?;
    Ok(())
}
#[tauri::command]
pub fn library_index_start(app: tauri::AppHandle) {
    if !app
        .state::<crate::settings::commands::SettingsState>()
        .0
        .lock()
        .unwrap()
        .index_screenshot_text
    {
        return;
    }
    let engine=app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().ocr_engine.clone();
    if !super::neural::installed(&engine) { return; }
    let state = app.state::<IndexState>();
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        state.rescan.store(true, Ordering::SeqCst);
        return;
    }
    state.cancel.store(false, Ordering::Relaxed);
    *state.progress.lock().unwrap() = Progress {
        running: true,
        ..Progress::default()
    };
    std::thread::spawn(move || {
        let state = app.state::<IndexState>();
        let rows = {
            let db = app.state::<crate::Db>();
            let conn = db.0.lock().unwrap();
            crate::db::list_captures(&conn).unwrap_or_default()
        };
        let rows: Vec<_> = rows
            .into_iter()
            .filter(|r| r.kind == "screenshot")
            .collect();
        state.progress.lock().unwrap().total = rows.len();
        // Two bounded sessions on CPUs with enough cores; never a thread per image.
        let next=std::sync::atomic::AtomicUsize::new(0);
        let workers=std::thread::available_parallelism().map(|n|if n.get()>=8 {2}else{1}).unwrap_or(1);
        std::thread::scope(|scope| { for slot in 0..workers {
            let app=&app; let rows=&rows;let next=&next;let state=&*state;
            scope.spawn(move||loop {
                let index=next.fetch_add(1,Ordering::Relaxed);
                let Some(row)=rows.get(index) else {break;};
                if state.cancel.load(Ordering::Relaxed)
                    || !app
                        .state::<crate::settings::commands::SettingsState>()
                        .0
                        .lock()
                        .unwrap()
                        .index_screenshot_text
                {
                    break;
                }
                let fingerprint = crate::db::text_index::fingerprint(&row.path).map(|f|format!("{}:{f}",super::neural::engine_id()));
                if let Some(fingerprint) = fingerprint {
                    let current = {
                        let db = app.state::<crate::Db>();
                        let conn = db.0.lock().unwrap();
                        crate::db::text_index::current(&conn, row.id, &fingerprint)
                    };
                    if !current {
                        let result = (|| {
                            let mut reader = image::ImageReader::open(&row.path).map_err(|_| ())?;
                            let mut limits = image::Limits::default();
                            limits.max_alloc = Some(128 * 1024 * 1024);
                            reader.limits(limits);
                            let image = reader.decode().map_err(|_| ())?.to_rgba8();
                            super::neural::recognize_search_text_slot(&image,image.width(),image.height(),&state.cancel,slot).map_err(|_| ())
                        })();
                        if state.cancel.load(Ordering::Relaxed) {
                            break;
                        }
                        let failed = result.is_err();
                        let text = result.unwrap_or_default();
                        let stored_fingerprint = if failed {
                            format!("failed:{fingerprint}")
                        } else {
                            fingerprint
                        };
                        let saved = {
                            let db = app.state::<crate::Db>();
                            let conn = db.0.lock().unwrap();
                            if state.cancel.load(Ordering::Relaxed) {
                                break;
                            }
                            crate::db::text_index::put(
                                &conn,
                                row.id,
                                &text,
                                &stored_fingerprint,
                                false,
                            )
                            .is_ok()
                        };
                        if failed || !saved {
                            state.progress.lock().unwrap().errors += 1;
                        }
                    }
                }
                state.progress.lock().unwrap().done += 1;
            });
        }});

        state.progress.lock().unwrap().running = false;
        state.running.store(false, Ordering::SeqCst);
        if state.rescan.swap(false, Ordering::SeqCst) && !state.cancel.load(Ordering::Relaxed) {
            library_index_start(app.clone());
        }
        let _ = app.emit("library-indexed", ());
    });
}
