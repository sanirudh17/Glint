use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create captures and settings",
        sql: "
            CREATE TABLE captures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,            -- 'screenshot' | 'recording'
                path TEXT NOT NULL,
                thumb_path TEXT,
                width INTEGER, height INTEGER,
                duration_ms INTEGER,           -- recordings only
                bytes INTEGER,
                app_name TEXT, window_title TEXT,
                created_at INTEGER NOT NULL,   -- unix seconds
                deleted_at INTEGER             -- soft delete
            );
            CREATE INDEX idx_captures_created ON captures(created_at);
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL            -- JSON-encoded
            );
        ",
        kind: MigrationKind::Up,
    }]
}

// ─── rusqlite captures layer (tray-core owns the captures table) ───────────────

use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct NewCapture {
    pub kind: String,
    pub path: String,
    pub thumb_path: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CaptureRow {
    pub id: i64,
    pub kind: String,
    pub path: String,
    pub thumb_path: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
}

/// Idempotent — matches the plugin-sql migration shape. Safe to call repeatedly and
/// at capture/library time (always after the main window's boot migration).
pub fn ensure_captures_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            path TEXT NOT NULL,
            thumb_path TEXT,
            width INTEGER, height INTEGER,
            duration_ms INTEGER,
            bytes INTEGER,
            app_name TEXT, window_title TEXT,
            created_at INTEGER NOT NULL,
            deleted_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);",
    )
}

pub fn insert_capture(conn: &Connection, c: &NewCapture) -> rusqlite::Result<i64> {
    ensure_captures_table(conn)?;
    conn.execute(
        "INSERT INTO captures (kind, path, thumb_path, width, height, bytes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![c.kind, c.path, c.thumb_path, c.width, c.height, c.bytes, c.created_at],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Update a capture row's file-derived fields after an in-place edit (trim overwrite).
/// `bytes` always overwrites; `thumb_path`/`width`/`height` use COALESCE so a `None`
/// preserves the existing value (a trim keeps the same resolution, so dimensions must
/// not be nulled out).
pub fn update_capture_file(
    conn: &Connection,
    id: i64,
    bytes: i64,
    thumb_path: Option<&str>,
    width: Option<i64>,
    height: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE captures SET bytes = ?1,
             thumb_path = COALESCE(?2, thumb_path),
             width = COALESCE(?3, width),
             height = COALESCE(?4, height)
         WHERE id = ?5",
        rusqlite::params![bytes, thumb_path, width, height, id],
    )?;
    Ok(())
}

pub fn list_captures(conn: &Connection) -> rusqlite::Result<Vec<CaptureRow>> {
    ensure_captures_table(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, path, thumb_path, width, height, bytes, created_at
         FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CaptureRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                path: r.get(2)?,
                thumb_path: r.get(3)?,
                width: r.get(4)?,
                height: r.get(5)?,
                bytes: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn soft_delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    ensure_captures_table(conn)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute("UPDATE captures SET deleted_at = ?1 WHERE id = ?2", rusqlite::params![now, id])?;
    Ok(())
}

pub fn capture_path(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    ensure_captures_table(conn)?;
    let mut stmt = conn.prepare("SELECT path FROM captures WHERE id = ?1 AND deleted_at IS NULL")?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        ensure_captures_table(&c).unwrap();
        c
    }

    fn sample(path: &str, at: i64) -> NewCapture {
        NewCapture {
            kind: "screenshot".into(),
            path: path.into(),
            thumb_path: Some(format!("{path}.thumb.png")),
            width: Some(800),
            height: Some(600),
            bytes: Some(1234),
            created_at: at,
        }
    }

    #[test]
    fn insert_returns_increasing_ids() {
        let c = mem();
        let a = insert_capture(&c, &sample("/a.png", 100)).unwrap();
        let b = insert_capture(&c, &sample("/b.png", 200)).unwrap();
        assert!(b > a);
    }

    #[test]
    fn list_is_newest_first() {
        let c = mem();
        insert_capture(&c, &sample("/old.png", 100)).unwrap();
        insert_capture(&c, &sample("/new.png", 200)).unwrap();
        let rows = list_captures(&c).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].path, "/new.png");
    }

    #[test]
    fn soft_delete_hides_a_row() {
        let c = mem();
        let id = insert_capture(&c, &sample("/x.png", 100)).unwrap();
        soft_delete(&c, id).unwrap();
        assert!(list_captures(&c).unwrap().is_empty());
        assert_eq!(capture_path(&c, id).unwrap(), None);
    }

    #[test]
    fn capture_path_returns_the_path() {
        let c = mem();
        let id = insert_capture(&c, &sample("/y.png", 100)).unwrap();
        assert_eq!(capture_path(&c, id).unwrap(), Some("/y.png".to_string()));
    }
}
