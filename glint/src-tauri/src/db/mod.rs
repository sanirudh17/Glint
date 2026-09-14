use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create captures and settings",
        sql: "
            -- Idempotent (IF NOT EXISTS): the same glint.db is also opened by
            -- rusqlite (`ensure_captures_table` below), which creates `captures`
            -- without migration bookkeeping. If it wins the race, this migration
            -- must be a no-op success, not a 'table already exists' failure
            -- that rejects the whole plugin-sql load and breaks every settings
            -- persist (e.g. changing the capture folder on a fresh install).
            CREATE TABLE IF NOT EXISTS captures (
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
            CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);
            CREATE TABLE IF NOT EXISTS settings (
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

/// Forget plugin-sql's bookkeeping row for migration 1 so it re-applies.
///
/// v0.1.13 rewrote migration 1 as idempotent (`IF NOT EXISTS`), which changed
/// its checksum. Databases migrated by earlier releases recorded the old
/// checksum, so plugin-sql refused to load them at all ("migration 1 was
/// previously applied but has been modified") — breaking EVERY settings
/// persist (toggles stuck, dropdowns snapping back) with no visible error.
/// Since the current migration 1 SQL is a pure no-op on migrated databases,
/// forgetting + re-applying it is safe. A missing bookkeeping table (fresh DB
/// that plugin-sql hasn't touched yet) is fine — the DELETE just no-ops and
/// plugin-sql applies v1 itself on first load.
pub fn repair_migration_bookkeeping(conn: &Connection) {
    let _ = conn.execute("DELETE FROM _sqlx_migrations WHERE version = 1", []);
}

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

/// Split live capture rows (newest-first, as `list_captures` returns them) into the
/// ones to show and the ids of the ones whose file has vanished. Walks in order,
/// keeping rows whose file still exists (up to `cap` of them) and collecting the ids
/// of rows whose file is gone — the caller soft-deletes those so a capture deleted in
/// Explorer / the system self-heals out of the Library instead of lingering as a
/// broken row. `exists` is injected (not a hard-coded fs call) so this stays pure and
/// unit-testable. Stops once `cap` survivors are found, so a limited request (Home
/// previews only a few) never stats the whole library.
pub fn reconcile_rows<F: Fn(&str) -> bool>(
    rows: Vec<CaptureRow>,
    cap: usize,
    exists: F,
) -> (Vec<CaptureRow>, Vec<i64>) {
    let mut survivors = Vec::new();
    let mut missing = Vec::new();
    for r in rows {
        if survivors.len() >= cap {
            break;
        }
        if exists(&r.path) {
            survivors.push(r);
        } else {
            missing.push(r.id);
        }
    }
    (survivors, missing)
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

    /// Regression: migration 1 must survive the rusqlite race. The same glint.db
    /// is created by `ensure_captures_table` (no bookkeeping), so if it runs
    /// first, plugin-sql replays migration 1 against existing tables — plain
    /// CREATE TABLE would fail with "table captures already exists" and break
    /// every settings persist (e.g. changing the capture folder on fresh installs).
    #[test]
    fn migration_1_is_idempotent() {
        let ms = migrations();
        assert_eq!(ms.len(), 1);
        let sql = ms[0].sql.to_uppercase();
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS CAPTURES"),
            "captures table creation must be idempotent"
        );
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS SETTINGS"),
            "settings table creation must be idempotent"
        );
        assert!(
            sql.contains("CREATE INDEX IF NOT EXISTS"),
            "index creation must be idempotent"
        );
    }

    /// End-to-end shape of the race: tables pre-created the rusqlite way, then
    /// the migration SQL runs verbatim against the same connection without error.
    #[test]
    fn migration_sql_reruns_cleanly_over_rusqlite_tables() {
        let c = Connection::open_in_memory().unwrap();
        ensure_captures_table(&c).unwrap();
        c.execute_batch(migrations()[0].sql).unwrap();
        // And twice more for good measure — a retried migration is a pure no-op.
        c.execute_batch(migrations()[0].sql).unwrap();
    }

    /// Regression for the v0.1.13 checksum break: migration 1's SQL was made
    /// idempotent, changing its checksum, so databases migrated by earlier
    /// releases failed every plugin-sql load ("previously applied but has been
    /// modified") and broke all settings persists. Forgetting the v1 row lets
    /// the idempotent migration re-apply cleanly.
    #[test]
    fn repair_forgets_stale_v1_row_and_tolerates_missing_table() {
        let c = Connection::open_in_memory().unwrap();
        // Fresh DB (no bookkeeping table yet): must be a silent no-op.
        repair_migration_bookkeeping(&c);
        // Stale row recorded by a pre-idempotent release: removed.
        c.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            );
            INSERT INTO _sqlx_migrations
                (version, description, success, checksum, execution_time)
            VALUES (1, 'create captures and settings', 1, x'00', 0);",
        )
        .unwrap();
        repair_migration_bookkeeping(&c);
        let n: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM _sqlx_migrations WHERE version = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

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

    fn row(id: i64, path: &str) -> CaptureRow {
        CaptureRow {
            id,
            kind: "screenshot".into(),
            path: path.into(),
            thumb_path: None,
            width: None,
            height: None,
            bytes: None,
            created_at: id,
            title: None,
        }
    }

    #[test]
    fn reconcile_keeps_present_files_and_flags_missing() {
        let rows = vec![row(1, "/keep-a.png"), row(2, "/gone.png"), row(3, "/keep-b.png")];
        let (survivors, missing) = reconcile_rows(rows, usize::MAX, |p| p != "/gone.png");
        assert_eq!(
            survivors.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(),
            vec!["/keep-a.png", "/keep-b.png"],
        );
        assert_eq!(missing, vec![2]);
    }

    #[test]
    fn reconcile_stops_after_cap_survivors() {
        // With cap=2 and all files present, the 3rd row is never inspected.
        let rows = vec![row(1, "/a.png"), row(2, "/b.png"), row(3, "/c.png")];
        let (survivors, missing) = reconcile_rows(rows, 2, |_| true);
        assert_eq!(survivors.len(), 2);
        assert!(missing.is_empty());
    }

    #[test]
    fn reconcile_fills_cap_past_missing_rows() {
        // A missing row doesn't consume a survivor slot: cap=2 still yields 2 present files.
        let rows = vec![row(1, "/gone.png"), row(2, "/a.png"), row(3, "/b.png")];
        let (survivors, missing) = reconcile_rows(rows, 2, |p| p != "/gone.png");
        assert_eq!(survivors.iter().map(|r| r.id).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(missing, vec![1]);
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
