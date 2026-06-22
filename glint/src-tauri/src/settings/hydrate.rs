//! Hydrate the in-memory Settings from the persisted `settings` table at startup.
//! Tolerant of a missing table (first launch — nothing persisted yet → defaults).

use super::{apply_update, Settings};
use rusqlite::Connection;

/// Read every persisted setting row and apply known keys onto `s`. Unknown keys and
/// any read error (e.g. the table doesn't exist yet) are ignored — defaults stand.
pub fn hydrate_from_db(conn: &Connection, s: &mut Settings) {
    let mut stmt = match conn.prepare("SELECT key, value FROM settings") {
        Ok(stmt) => stmt,
        Err(_) => return, // table missing on first launch
    };
    let rows = match stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        Ok(rows) => rows,
        Err(_) => return,
    };
    for (key, raw) in rows.flatten() {
        // Persisted values are JSON-encoded (the JS persistSetting wraps with JSON.stringify).
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            let _ = apply_update(s, &key, value);
        }
    }
}
