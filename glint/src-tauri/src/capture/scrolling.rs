//! Settled-frame collector with manual scrolling and explicit, optional auto-scroll.
use super::{
    commands::{finish_commit, RectArg},
    geometry::{self, LogicalRect},
    scroll_stitch::{settled_frame, Step, Stitcher},
    CaptureIntent, CaptureMode, CaptureSession, CaptureState,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
const LABEL: &str = "rec-scroll";

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub active: bool,
    pub ready: bool,
    pub width: u32,
    pub height: u32,
    pub strips: u32,
    pub message: String,
    pub at_limit: bool,
    pub auto_scrolling: bool,
}
struct Job {
    command: Arc<AtomicU8>,
    status: Arc<Mutex<Status>>,
    automatic: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct ScrollState(Mutex<Option<Job>>);
pub fn is_running(app: &AppHandle) -> bool {
    app.state::<ScrollState>().0.lock().unwrap().is_some()
}

#[tauri::command]
pub fn capture_scroll_status(app: AppHandle) -> Status {
    app.state::<ScrollState>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|j| {
            let mut s = j.status.lock().unwrap().clone();
            s.auto_scrolling = j.automatic.load(Ordering::Acquire);
            s
        })
        .unwrap_or_default()
}
#[tauri::command]
pub fn capture_scroll_control(app: AppHandle, action: String) -> Result<(), String> {
    if let Some(job) = app.state::<ScrollState>().0.lock().unwrap().as_ref() {
        match action.as_str() {
            "finish" => job.command.store(1, Ordering::Release),
            "cancel" => job.command.store(2, Ordering::Release),
            "start" => {
                if !job.status.lock().unwrap().ready {
                    return Err("Scrolling capture is still preparing".into());
                }
                job.automatic.store(true, Ordering::Release)
            }
            "pause" => job.automatic.store(false, Ordering::Release),
            _ => return Err("Unknown scrolling action".into()),
        }
    }
    Ok(())
}
#[tauri::command]
pub fn capture_scroll_begin(app: AppHandle) -> Result<(), String> {
    if is_running(&app) {
        return Err("A scrolling capture is already running".into());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        super::begin_on(&app, CaptureMode::Area, true, CaptureIntent::Scroll, 0);
    });
    Ok(())
}

#[derive(serde::Serialize)]
pub struct Display {
    pub id: u32,
    pub name: String,
}
#[tauri::command(async)]
pub fn capture_displays() -> Result<Vec<Display>, String> {
    Ok(super::frozen::monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
        .map(|(i, m)| Display {
            id: i as u32,
            name: format!(
                "{} · {} × {}",
                m.name().unwrap_or_else(|_| "Display".into()),
                m.width().unwrap_or(0),
                m.height().unwrap_or(0)
            ),
        })
        .collect())
}
#[tauri::command]
pub fn capture_choose_monitor(app: AppHandle, id: u32) -> Result<(), String> {
    let (mode, restore, intent) = {
        let state = app.state::<CaptureState>();
        let lock = state.0.lock().unwrap();
        let s = lock.as_ref().ok_or("No active selection")?;
        (s.mode, s.restore_main, s.intent)
    };
    std::thread::spawn(move || super::begin_on(&app, mode, restore, intent, id));
    Ok(())
}

fn show_controller(
    app: &AppHandle,
    session: &CaptureSession,
    command: Arc<AtomicU8>,
) -> Result<(), String> {
    let scale = session.scale;
    let boot = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let settings = state.0.lock().unwrap();
        serde_json::json!({"theme":settings.theme,"accent":settings.accent})
    };
    let win =
        WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/rec-scroll".into()))
            .title("Glint scrolling capture")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .background_color(tauri::window::Color(0, 0, 0, 0))
            .initialization_script(format!("window.__GLINT_BOOT__={boot};"))
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .inner_size(420., 184.)
            .visible(false)
            .focused(false)
            .build()
            .map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(
        session.origin_x + (session.image.width as i32 - (440. * scale) as i32).max(0),
        session.origin_y + (20. * scale) as i32,
    ))
    .map_err(|e| e.to_string())?;
    crate::window::exclude_from_capture(&win);
    crate::window::disable_transitions(&win);
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            command.store(2, Ordering::Release);
        }
    });
    // React reveals this hidden window only after status and two painted frames.
    // Never show WebView2's unpainted native surface on a cold build.
    Ok(())
}

#[tauri::command]
pub fn capture_scroll_ready(app: AppHandle) -> Result<(), String> {
    if !is_running(&app) {
        return Ok(());
    }
    if let Some(win) = app.get_webview_window(LABEL) {
        win.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn wait_for_selection_hidden(app: &AppHandle) -> Result<(), String> {
    let started = std::time::Instant::now();
    while app.webview_windows().iter().any(|(label, w)| {
        label.starts_with(crate::overlay::OVERLAY_PREFIX) && w.is_visible().unwrap_or(false)
    }) {
        if started.elapsed().as_millis() > 1500 {
            return Err("The selection overlay did not close. Try the capture again.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
    Ok(())
}

/// Called off-thread by capture_commit, after selection overlay teardown.
pub fn start(app: &AppHandle, mut session: CaptureSession, rect: RectArg) -> Result<(), String> {
    let physical = geometry::logical_to_physical(
        LogicalRect {
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
        },
        session.scale,
    );
    let area = geometry::clamp_rect(physical, session.image.width, session.image.height)
        .ok_or("Empty selection")?;
    let first = geometry::crop_rgba(
        &session.image.rgba,
        session.image.width,
        session.image.height,
        area,
    );
    let mut stitch = match Stitcher::new(
        image::RgbaImage::from_raw(area.w, area.h, first).ok_or("Invalid pixels")?,
    ) {
        Ok(s) => s,
        Err(e) => {
            super::toast(app, &e);
            if session.restore_main {
                super::restore_main_window(app);
            }
            return Ok(());
        }
    };
    session.image.rgba = Vec::new();
    *session.backdrop_url.lock().unwrap() = None;
    let command = Arc::new(AtomicU8::new(0));
    let automatic = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(Status {
        active: true,
        ready: false,
        width: area.w,
        height: area.h,
        strips: 1,
        message: "Preparing scrolling capture…".into(),
        at_limit: false,
        auto_scrolling: false,
    }));
    {
        let state = app.state::<ScrollState>();
        let mut slot = state.0.lock().unwrap();
        if slot.is_some() {
            return Err("A scrolling capture is already running".into());
        }
        *slot = Some(Job {
            command: command.clone(),
            status: status.clone(),
            automatic: automatic.clone(),
        });
    }
    let result = (|| -> Result<bool, String> {
        let hide_icons = app
            .state::<crate::settings::commands::SettingsState>()
            .0
            .lock()
            .unwrap()
            .hide_desktop_icons;
        let _icons = super::desktop_icons::guard(hide_icons);
        // Teardown waits for a painted clear, asynchronously. A fixed 120ms delay
        // could hit-test the still-visible Glint overlay and cache that failure
        // for the entire first attempt. Wait for actual visibility instead.
        wait_for_selection_hidden(app)?;
        show_controller(app, &session, command.clone())?;
        let reveal_started = std::time::Instant::now();
        while !app
            .get_webview_window(LABEL)
            .is_some_and(|w| w.is_visible().unwrap_or(false))
        {
            if command.load(Ordering::Acquire) == 2 {
                return Ok(false);
            }
            if reveal_started.elapsed().as_secs() > 4 {
                return Err("Could not prepare the capture controls. Please try again.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
        // Visibility changes precede DWM composition. Establish the reference
        // after both windows have reached their final painted state, so the first
        // strip cannot contain a disappearing selection or popup transition.
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        let clean =
            super::frozen::capture_monitor(session.monitor_id).map_err(|e| e.to_string())?;
        if clean.width != session.image.width || clean.height != session.image.height {
            return Err("Display geometry changed. Start the scrolling capture again.".into());
        }
        stitch = Stitcher::new(
            image::RgbaImage::from_raw(
                area.w,
                area.h,
                geometry::crop_rgba(&clean.rgba, clean.width, clean.height, area),
            )
            .ok_or("Invalid screen frame")?,
        )?;
        let point = (
            session.origin_x + (area.x + area.w / 2) as i32,
            session.origin_y + (area.y + area.h / 2) as i32,
        );
        let mut target = super::scroll_input::Target::at(point.0, point.1);
        {
            let mut s = status.lock().unwrap();
            s.ready = true;
            s.message = "Ready. Start auto-scroll, or scroll the page manually.".into();
        }
        let mut sample: Option<image::RgbaImage> = None;
        let started = std::time::Instant::now();
        let mut last_progress = std::time::Instant::now();
        let mut last_wheel = std::time::Instant::now();
        let (mut waiting, mut no_movement, mut was_auto) = (false, 0, false);
        let mut notice: Option<String> = None;
        let mut uncertain_since: Option<std::time::Instant> = None;
        while command.load(Ordering::Acquire) == 0 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if started.elapsed().as_secs() > 300 {
                let mut s = status.lock().unwrap();
                s.at_limit = true;
                automatic.store(false, Ordering::Release);
                s.message =
                    "Five-minute capture limit reached. Finish to keep the captured portion."
                        .into();
            }
            if status.lock().unwrap().at_limit {
                continue;
            }
            let frame =
                super::frozen::capture_monitor(session.monitor_id).map_err(|e| e.to_string())?;
            if frame.width != session.image.width || frame.height != session.image.height {
                return Err("Display geometry changed. Start the scrolling capture again.".into());
            }
            let pixels = geometry::crop_rgba(&frame.rgba, frame.width, frame.height, area);
            let next =
                image::RgbaImage::from_raw(area.w, area.h, pixels).ok_or("Invalid screen frame")?;
            let auto = automatic.load(Ordering::Acquire);
            if auto && !was_auto {
                // Reacquire on Resume as well, allowing a covered page/controller
                // to be moved away without permanently poisoning the first target.
                target = super::scroll_input::Target::at(point.0, point.1);
                notice = None;
                no_movement = 0;
                waiting = false;
                last_progress = std::time::Instant::now();
            }
            was_auto = auto;
            if !sample.as_ref().is_some_and(|p| settled_frame(p, &next)) {
                sample = Some(next);
                let mut s = status.lock().unwrap();
                s.message=if last_progress.elapsed().as_secs()<3{"Capturing a stable strip…"}else{"The page is still moving. Pause animations or select a smaller region; captured strips are kept."}.into();
                if auto && last_progress.elapsed().as_secs() > 8 {
                    automatic.store(false, Ordering::Release);
                    notice=Some("Auto-scroll paused because the page keeps changing. Pause animations, then resume or scroll manually.".into());
                }
                if let Some(reason) = &notice {
                    s.message = reason.clone();
                }
                continue;
            }
            let step = stitch.push_settled(next.clone(), sample.as_ref().unwrap());
            sample = Some(next);
            let mut s = status.lock().unwrap();
            let mut aligned = true;
            s.height = stitch.image.height();
            s.strips = stitch.strips;
            match step {
                Step::Appended(_) => {
                    uncertain_since = None;
                    notice = None;
                    waiting = false;
                    no_movement = 0;
                    last_progress = std::time::Instant::now();
                    s.message =
                        "Captured. Auto-scroll can continue, or finish your capture.".into();
                }
                Step::Unchanged => {
                    uncertain_since = None;
                    if waiting && last_wheel.elapsed().as_millis() > 900 {
                        no_movement += 1;
                        waiting = false;
                    }
                    s.message = notice.clone().unwrap_or_else(|| {
                        if auto {
                            "Auto-scrolling in small steps…"
                        } else {
                            "Ready. Start auto-scroll, or scroll the page manually."
                        }
                        .into()
                    });
                }
                Step::Uncertain => {
                    aligned = false;
                    let since = uncertain_since.get_or_insert_with(std::time::Instant::now);
                    if since.elapsed().as_secs() < 3 {
                        s.message =
                            "Waiting for this scroll step to settle… Captured strips are kept."
                                .into();
                    } else {
                        automatic.store(false, Ordering::Release);
                        s.message="Could not align this step. Scroll back, then try a smaller step. Animated regions may not stitch.".into();
                        notice = Some(s.message.clone());
                    }
                }
                Step::Limit => {
                    automatic.store(false, Ordering::Release);
                    s.at_limit = true;
                    s.message="Capture limit reached (20,000 px / 24 MP). Finish to keep the captured portion.".into();
                }
            }
            if auto
                && aligned
                && !waiting
                && !s.at_limit
                && last_wheel.elapsed().as_millis() > 600
                && automatic.load(Ordering::Acquire)
            {
                if no_movement >= 3 {
                    automatic.store(false, Ordering::Release);
                    s.message="The page stopped advancing. Finish your capture, or try scrolling manually.".into();
                    notice = Some(s.message.clone());
                } else {
                    match target
                        .as_ref()
                        .map_err(|e| e.clone())
                        .and_then(|t| t.down())
                    {
                        Ok(()) => {
                            last_wheel = std::time::Instant::now();
                            waiting = true;
                            sample = None;
                        }
                        Err(e) => {
                            automatic.store(false, Ordering::Release);
                            notice = Some(e.clone());
                            s.message = e;
                        }
                    }
                }
            }
        }
        Ok(command.load(Ordering::Acquire) == 1)
    })();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    *app.state::<ScrollState>().0.lock().unwrap() = None;
    match result {
        Ok(true) => {
            let (w, h) = stitch.image.dimensions();
            session.image = super::frozen::CapturedImage {
                width: w,
                height: h,
                rgba: stitch.image.into_raw(),
            };
            session.scale = 1.;
            finish_commit(
                app,
                session,
                RectArg {
                    x: 0.,
                    y: 0.,
                    w: w as f64,
                    h: h as f64,
                },
                true,
            )
        }
        other => {
            if session.restore_main {
                super::restore_main_window(app);
            }
            if let Err(e) = other {
                super::toast(app, &e);
            }
            Ok(())
        }
    }
}
