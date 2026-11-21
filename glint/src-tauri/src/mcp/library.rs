//! Read-only access to the Glint Library for agents. Opens glint.db with
//! SQLITE_OPEN_READ_ONLY, so a running Glint can never be disturbed or corrupted.
use rmcp::schemars;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::PathBuf;

/// Identifier of the installed app; its data lives in %APPDATA%\<id>.
const APP_ID: &str = "com.glint.app";

/// glint.db location: `GLINT_DATA_DIR` (tests, preview builds) or the installed app's.
pub fn database_path() -> Result<PathBuf, String> {
    let dir = match std::env::var_os("GLINT_DATA_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA isn't set")?).join(APP_ID),
    };
    Ok(dir.join("glint.db"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, schemars::JsonSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    All,
    Screenshot,
    Recording,
    Gif,
}

#[derive(Debug, Serialize)]
pub struct Capture {
    pub id: i64,
    pub kind: String,
    pub path: String,
    pub name: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    /// Local time, "YYYY-MM-DD HH:MM".
    pub created: String,
    /// True when the match came from text read inside the screenshot.
    pub text_match: bool,
}

fn open() -> Result<Connection, String> {
    let path = database_path()?;
    if !path.is_file() {
        return Err(format!("No Glint library found at {}. Open Glint once to create it.", path.display()));
    }
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Couldn't open the Glint library read-only: {e}"))
}

fn local_time(unix: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_opt(unix, 0).single().map(|t| t.format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default()
}

/// Newest first. `query` matches the capture's name or date (case-insensitive),
/// or — when Glint's screenshot-text index exists — words read inside screenshots.
pub fn search(query: Option<&str>, kind: Kind, limit: usize) -> Result<Vec<Capture>, String> {
    search_in(&open()?, query, kind, limit)
}

pub(crate) fn search_in(conn: &Connection, query: Option<&str>, kind: Kind, limit: usize) -> Result<Vec<Capture>, String> {
    let query = query.map(str::trim).filter(|q| !q.is_empty()).map(str::to_lowercase);
    // A missing text index (feature off, older library) just means no text matches.
    let text_hits: std::collections::HashSet<i64> = match &query {
        Some(q) => crate::db::text_index::search(conn, q).unwrap_or_default().into_iter().collect(),
        None => Default::default(),
    };
    let mut stmt = conn
        .prepare("SELECT id, kind, path, width, height, bytes, created_at, title FROM captures WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC")
        .map_err(|e| format!("Couldn't read the library: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get::<_, i64>(6)?, r.get::<_, Option<String>>(7)?))
        })
        .map_err(|e| format!("Couldn't read the library: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind_name, path, width, height, bytes, created_at, title) = row.map_err(|e| e.to_string())?;
        let wanted = match kind {
            Kind::All => true,
            Kind::Screenshot => kind_name == "screenshot",
            Kind::Recording => kind_name == "recording",
            Kind::Gif => kind_name == "gif",
        };
        if !wanted {
            continue;
        }
        let file = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or(&path).to_string();
        let name = title.unwrap_or_else(|| file.clone());
        let created = local_time(created_at);
        let text_match = text_hits.contains(&id);
        if let Some(q) = &query {
            let named = name.to_lowercase().contains(q) || file.to_lowercase().contains(q) || created.contains(q.as_str());
            if !named && !text_match {
                continue;
            }
        }
        out.push(Capture { id, kind: kind_name, path, name, width, height, bytes, created, text_match });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::ensure_captures_table(&c).unwrap();
        for (id, kind, path, title, at) in [
            (1, "screenshot", r"C:\cap\Glint 2026-11-01 at 10.00.00.png", None, 1_793_000_000),
            (2, "recording", r"C:\cap\demo.mp4", Some("Quarterly demo"), 1_793_100_000),
            (3, "screenshot", r"C:\cap\invoice.png", None, 1_793_200_000),
        ] {
            c.execute("INSERT INTO captures (id, kind, path, title, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, kind, path, title, at]).unwrap();
        }
        c.execute("UPDATE captures SET deleted_at = 1 WHERE id = 3", []).unwrap();
        c
    }

    #[test]
    fn newest_first_filters_kind_and_skips_deleted() {
        let c = library();
        let all = search_in(&c, None, Kind::All, 10).unwrap();
        assert_eq!(all.iter().map(|c| c.id).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(search_in(&c, None, Kind::Screenshot, 10).unwrap().len(), 1);
        assert_eq!(search_in(&c, None, Kind::All, 1).unwrap().len(), 1);
    }

    #[test]
    fn query_matches_title_filename_and_date_case_insensitively() {
        let c = library();
        assert_eq!(search_in(&c, Some("quarterly"), Kind::All, 10).unwrap()[0].id, 2);
        assert_eq!(search_in(&c, Some("GLINT 2026"), Kind::All, 10).unwrap()[0].id, 1);
        assert!(search_in(&c, Some("invoice"), Kind::All, 10).unwrap().is_empty(), "deleted captures never match");
        assert!(search_in(&c, Some("nothing-like-this"), Kind::All, 10).unwrap().is_empty());
    }
}
