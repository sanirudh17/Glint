//! Local OCR text index. Keep schema ownership here, outside SQL-plugin migration 1.
use rusqlite::{params, Connection};
pub fn ensure(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS capture_text(capture_id INTEGER PRIMARY KEY,body TEXT NOT NULL,fingerprint TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS capture_text_fts USING fts5(body,tokenize='unicode61');
    CREATE TRIGGER IF NOT EXISTS capture_text_insert AFTER INSERT ON capture_text BEGIN
      INSERT INTO capture_text_fts(rowid,body) VALUES(new.capture_id,new.body); END;
    CREATE TRIGGER IF NOT EXISTS capture_text_update AFTER UPDATE ON capture_text BEGIN
      DELETE FROM capture_text_fts WHERE rowid=old.capture_id;
      INSERT INTO capture_text_fts(rowid,body) VALUES(new.capture_id,new.body); END;
    CREATE TRIGGER IF NOT EXISTS capture_text_delete AFTER DELETE ON capture_text BEGIN
      DELETE FROM capture_text_fts WHERE rowid=old.capture_id; END;
    CREATE TRIGGER IF NOT EXISTS capture_text_capture_delete AFTER UPDATE OF deleted_at ON captures WHEN new.deleted_at IS NOT NULL BEGIN
      DELETE FROM capture_text WHERE capture_id=new.id; END;
    CREATE TRIGGER IF NOT EXISTS capture_text_capture_remove AFTER DELETE ON captures BEGIN
      DELETE FROM capture_text WHERE capture_id=old.id; END;"
)
}
pub fn fingerprint(path: &str) -> Option<String> {
    let m = std::fs::metadata(path).ok()?;
    let t = m
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(format!("v1:{}:{t}", m.len()))
}
pub fn current(conn: &Connection, id: i64, fingerprint: &str) -> bool {
    conn.query_row(
        "SELECT fingerprint=?2 FROM capture_text WHERE capture_id=?1",
        params![id, fingerprint],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
pub fn put(
    conn: &Connection,
    id: i64,
    body: &str,
    fingerprint: &str,
    auto_name: bool,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    // A capture may have been deleted while OCR was running. Never recreate its index.
    let exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM captures WHERE id=?1 AND deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if exists {
        tx.execute("INSERT INTO capture_text(capture_id,body,fingerprint) VALUES(?1,?2,?3) ON CONFLICT(capture_id) DO UPDATE SET body=excluded.body,fingerprint=excluded.fingerprint",params![id,body,fingerprint])?;
        if auto_name {
            if let Some(name) = name_from_text(body) {
                tx.execute("UPDATE captures SET title=?2,title_origin='ocr' WHERE id=?1 AND (title_origin='ocr' OR ((title IS NULL OR title='') AND title_origin IS NULL))",params![id,name])?;
            }
        }
    }
    tx.commit()
}
pub fn name_from_text(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| {
            line.chars().filter(|c| c.is_alphabetic()).count() >= 3
                && crate::ocr::privacy::ranges(line).is_empty()
        })
        .map(|line| line.chars().take(80).collect())
}
pub fn search(conn: &Connection, query: &str) -> rusqlite::Result<Vec<i64>> {
    let terms: Vec<_> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .take(16)
        .map(|s| format!("\"{s}\"*"))
        .collect();
    if terms.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt=conn.prepare("SELECT f.rowid FROM capture_text_fts f JOIN captures c ON c.id=f.rowid WHERE capture_text_fts MATCH ?1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC")?;
    let rows = stmt
        .query_map([terms.join(" AND ")], |r| r.get(0))?
        .collect();
    rows
}
#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        super::super::ensure_captures_table(&c).unwrap();
        for id in 1..=2 {
            c.execute(
                "INSERT INTO captures(id,kind,path,created_at) VALUES(?1,'screenshot','/fake',1)",
                [id],
            )
            .unwrap();
        }
        c
    }
    #[test]
    fn migrates_idempotently_and_searches_only_pixels() {
        let c = db();
        super::super::ensure_captures_table(&c).unwrap();
        put(&c, 1, "Invisible otterfjord text", "a", false).unwrap();
        assert_eq!(search(&c, "OTTERFJ").unwrap(), vec![1]);
        assert!(search(&c, "\" OR * --").unwrap().is_empty());
        put(&c, 1, "Replaced pixels", "b", false).unwrap();
        assert!(search(&c, "otterfjord").unwrap().is_empty());
        assert!(current(&c, 1, "b"));
        super::super::soft_delete(&c, 1).unwrap();
        assert!(search(&c, "replaced").unwrap().is_empty());
        assert_eq!(
            c.query_row("SELECT count(*) FROM capture_text", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            c.query_row("SELECT count(*) FROM capture_text_fts", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn preserves_manual_names_and_respects_the_naming_switch() {
        let c = db();
        put(&c, 1, "Generated title", "a", false).unwrap();
        let title: Option<String> = c
            .query_row("SELECT title FROM captures WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert!(title.is_none());
        super::super::set_title(&c, 1, Some("Manual")).unwrap();
        put(&c, 1, "Other title", "b", true).unwrap();
        assert_eq!(
            c.query_row("SELECT title FROM captures WHERE id=1", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Manual"
        );
        put(&c, 2, "mail@sample.test\nUseful heading", "a", true).unwrap();
        assert_eq!(
            c.query_row("SELECT title FROM captures WHERE id=2", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Useful heading"
        );
    }
}
