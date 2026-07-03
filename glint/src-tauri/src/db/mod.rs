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
    // NOTE: the `captures.title` column (Phase 18) is intentionally NOT a plugin-sql
    // migration. It is added idempotently by `ensure_captures_table` (rusqlite) below,
    // which owns the captures schema. A migration here raced that ALTER and failed with
    // "duplicate column name: title", which rejected the whole sql-plugin DB load and
    // broke every settings persist. Keep schema changes to `captures` in one place.
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
    pub title: Option<String>,
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
            deleted_at INTEGER,
            title TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);",
    )?;
    // Older DBs created before the title column: add it, ignoring "duplicate column".
    let _ = conn.execute("ALTER TABLE captures ADD COLUMN title TEXT", []);
    Ok(())
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

/// Look up a live (non-deleted) capture's id by exact file path. Used when a file is
/// opened from Explorer so an in-place Overwrite can update the right Library row (a
/// path with no row is an external file → the caller falls back to id -1).
pub fn find_capture_id_by_path(conn: &Connection, path: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM captures WHERE path = ?1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
        rusqlite::params![path],
        |r| r.get::<_, i64>(0),
    )
    .ok()
}

pub fn list_captures(conn: &Connection) -> rusqlite::Result<Vec<CaptureRow>> {
    ensure_captures_table(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, path, thumb_path, width, height, bytes, created_at, title
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
                title: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Set (or clear, with `None`) a capture's custom title.
pub fn set_title(conn: &Connection, id: i64, title: Option<&str>) -> rusqlite::Result<()> {
    ensure_captures_table(conn)?;
    conn.execute("UPDATE captures SET title = ?1 WHERE id = ?2", rusqlite::params![title, id])?;
    Ok(())
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

    #[test]
    fn set_title_round_trips_and_clears() {
        let c = mem();
        let id = insert_capture(&c, &sample("/t.png", 100)).unwrap();
        set_title(&c, id, Some("Invoice")).unwrap();
        let rows = list_captures(&c).unwrap();
        assert_eq!(rows[0].title.as_deref(), Some("Invoice"));
        set_title(&c, id, None).unwrap();
        assert_eq!(list_captures(&c).unwrap()[0].title, None);
    }
}
