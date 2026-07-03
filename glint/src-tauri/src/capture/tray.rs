//! The Quick Access Overlay's model: an accumulating, capped stack of recent
//! captures. Pure (no Tauri types) so its logic is unit-tested in isolation.

use serde::Serialize;
use std::sync::Mutex;

pub const TRAY_CAP: usize = 5;

#[derive(Clone, Serialize)]
pub struct TrayItem {
    pub id: u64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub saved: bool,
    pub thumb: String,
}

#[derive(Default)]
pub struct TrayStore {
    items: Vec<TrayItem>, // newest last
    next_id: u64,
}

#[derive(Default)]
pub struct TrayState(pub Mutex<TrayStore>);

impl TrayStore {
    /// Append a new item (assigns its id). Returns `(new_id, evicted_oldest)` —
    /// `evicted` is `Some` when the push exceeded `TRAY_CAP`, so the caller can
    /// clean up its temp file.
    pub fn push(
        &mut self,
        path: String,
        width: u32,
        height: u32,
        saved: bool,
        thumb: String,
    ) -> (u64, Option<TrayItem>) {
        let id = self.next_id;
        self.next_id += 1;
        self.items.push(TrayItem { id, path, width, height, saved, thumb });
        let evicted = if self.items.len() > TRAY_CAP {
            Some(self.items.remove(0))
        } else {
            None
        };
        (id, evicted)
    }

    /// All items, newest last (the UI renders them bottom-anchored).
    pub fn list(&self) -> Vec<TrayItem> {
        self.items.clone()
    }

    pub fn get(&self, id: u64) -> Option<TrayItem> {
        self.items.iter().find(|i| i.id == id).cloned()
    }

    /// Remove an item by id, returning it (for temp-file cleanup) if present.
    pub fn remove(&mut self, id: u64) -> Option<TrayItem> {
        let idx = self.items.iter().position(|i| i.id == id)?;
        Some(self.items.remove(idx))
    }

    /// Flip an item to "saved" and repoint it at the durable file (Save action).
    pub fn mark_saved(&mut self, id: u64, path: String) {
        if let Some(it) = self.items.iter_mut().find(|i| i.id == id) {
            it.saved = true;
            it.path = path;
        }
    }

    /// Empty the tray, returning every item (for temp-file cleanup).
    pub fn clear(&mut self) -> Vec<TrayItem> {
        std::mem::take(&mut self.items)
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push(store: &mut TrayStore, tag: &str, saved: bool) -> u64 {
        store.push(format!("/tmp/{tag}.png"), 10, 10, saved, "data:thumb".into()).0
    }

    #[test]
    fn push_assigns_increasing_ids_newest_last() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", false);
        let b = push(&mut s, "b", false);
        assert!(b > a);
        let ids: Vec<u64> = s.list().iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![a, b]); // newest last
    }

    #[test]
    fn exceeding_cap_evicts_oldest_and_returns_it() {
        let mut s = TrayStore::default();
        let mut ids = vec![];
        for n in 0..TRAY_CAP {
            ids.push(push(&mut s, &format!("i{n}"), false));
        }
        let (_new, evicted) = s.push("/tmp/over.png".into(), 1, 1, false, "t".into());
        let evicted = evicted.expect("6th push evicts the oldest");
        assert_eq!(evicted.id, ids[0]);
        assert_eq!(s.list().len(), TRAY_CAP);
        assert!(s.get(ids[0]).is_none());
    }

    #[test]
    fn remove_returns_the_item_or_none() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", true);
        assert!(s.remove(a).unwrap().saved);
        assert!(s.remove(a).is_none());
        assert!(s.remove(999).is_none());
    }

    #[test]
    fn mark_saved_flips_flag_and_path() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", false);
        s.mark_saved(a, "/pics/a.png".into());
        let it = s.get(a).unwrap();
        assert!(it.saved);
        assert_eq!(it.path, "/pics/a.png");
    }

    #[test]
    fn clear_empties_and_returns_all() {
        let mut s = TrayStore::default();
        push(&mut s, "a", false);
        push(&mut s, "b", false);
        let removed = s.clear();
        assert_eq!(removed.len(), 2);
        assert!(s.is_empty());
    }
}
