use rusqlite::Connection;
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Cleaner {
    after_id: i64,
    days: u32,
}

impl Cleaner {
    fn clean_expired(&mut self, conn: &Connection, days: u32, now: i64) -> rusqlite::Result<usize> {
        if self.days != days {
            self.after_id = 0;
            self.days = days;
        }
        if !matches!(days, 1 | 7 | 30) {
            return Ok(0);
        }
        let cutoff = now.saturating_sub(i64::from(days) * 86_400);
        let rows = {
            let mut stmt = conn.prepare("SELECT id, path FROM captures WHERE kind='screenshot' AND deleted_at IS NULL AND id > ?2 AND created_at <= ?1 AND NOT EXISTS (SELECT 1 FROM captures newer WHERE newer.path=captures.path AND newer.deleted_at IS NULL AND newer.created_at > ?1) ORDER BY id LIMIT 100")?;
            let mapped = stmt.query_map([cutoff, self.after_id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()?
        };
        self.after_id = if rows.len() == 100 {
            rows.last().unwrap().0
        } else {
            0
        };
        let mut removed = 0;
        for (id, path) in rows {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    log::warn!("Screenshot retention could not remove capture {id}: {error}");
                    continue;
                }
            }
            crate::db::soft_delete(conn, id)?;
            removed += 1;
        }
        Ok(removed)
    }
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut cleaner = Cleaner::default();
        loop {
            let days = app
                .state::<crate::settings::commands::SettingsState>()
                .0
                .lock()
                .unwrap()
                .screenshot_retention_days;
            if days != 0 {
                let state = app.state::<crate::Db>();
                let result = cleaner.clean_expired(
                    &state.0.lock().unwrap(),
                    days,
                    chrono::Utc::now().timestamp(),
                );
                match result {
                    Ok(count) if count > 0 => {
                        let _ = app.emit("capture-saved", ());
                    }
                    Err(error) => log::warn!("Screenshot retention failed: {error}"),
                    _ => {}
                }
            } else {
                cleaner = Cleaner::default();
            }
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retention_removes_only_expired_screenshots_and_preserves_failed_deletions() {
        let dir = std::env::temp_dir().join(format!(
            "glint-retention-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_captures_table(&conn).unwrap();
        let mut cleaner = Cleaner::default();
        let now = 10_000_000;
        let cases = [
            ("old.png", "screenshot", now - 8 * 86_400),
            ("new.png", "screenshot", now - 86_400),
            ("old.mp4", "recording", 1),
            ("old.gif", "gif", 1),
            ("blocked", "screenshot", 1),
        ];
        for (name, kind, created_at) in cases {
            let path = dir.join(name);
            if name == "blocked" {
                std::fs::create_dir(&path).unwrap();
            } else {
                std::fs::write(&path, b"owned fixture").unwrap();
            }
            crate::db::insert_capture(
                &conn,
                &crate::db::NewCapture {
                    kind: kind.into(),
                    path: path.to_string_lossy().into(),
                    thumb_path: None,
                    width: None,
                    height: None,
                    bytes: None,
                    created_at,
                },
            )
            .unwrap();
        }
        assert_eq!(cleaner.clean_expired(&conn, 0, now).unwrap(), 0);
        assert!(dir.join("old.png").exists());
        assert_eq!(cleaner.clean_expired(&conn, 7, now).unwrap(), 1);
        assert!(!dir.join("old.png").exists());
        for name in ["new.png", "old.mp4", "old.gif", "blocked"] {
            assert!(dir.join(name).exists());
        }
        let live: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM captures WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live, 4);
        assert_eq!(cleaner.clean_expired(&conn, 7, now).unwrap(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_batch_does_not_starve_later_files_and_is_retried() {
        let dir = std::env::temp_dir().join(format!(
            "glint-retention-batch-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&dir).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_captures_table(&conn).unwrap();
        for i in 0..101 {
            let path = dir.join(format!("{i}.png"));
            if i < 100 {
                std::fs::create_dir(&path).unwrap();
            } else {
                std::fs::write(&path, b"owned screenshot").unwrap();
            }
            crate::db::insert_capture(
                &conn,
                &crate::db::NewCapture {
                    kind: "screenshot".into(),
                    path: path.to_string_lossy().into(),
                    thumb_path: None,
                    width: None,
                    height: None,
                    bytes: None,
                    created_at: 1,
                },
            )
            .unwrap();
        }
        let mut cleaner = Cleaner::default();
        assert_eq!(cleaner.clean_expired(&conn, 1, 1_000_000).unwrap(), 0);
        assert!(dir.join("100.png").exists());
        assert_eq!(cleaner.clean_expired(&conn, 1, 1_000_000).unwrap(), 1);
        assert!(!dir.join("100.png").exists());
        std::fs::remove_dir(dir.join("0.png")).unwrap();
        std::fs::write(dir.join("0.png"), b"available again").unwrap();
        assert_eq!(cleaner.clean_expired(&conn, 1, 1_000_000).unwrap(), 1);
        assert!(!dir.join("0.png").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
