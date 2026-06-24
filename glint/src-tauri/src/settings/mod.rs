use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hotkeys {
    pub capture_area: String,
    pub capture_window: String,
    pub capture_fullscreen: String,
    pub record: String,
    pub copy_path: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            capture_area: "CmdOrCtrl+Shift+1".into(),
            capture_window: "CmdOrCtrl+Shift+2".into(),
            capture_fullscreen: "CmdOrCtrl+Shift+3".into(),
            record: "CmdOrCtrl+Shift+5".into(),
            copy_path: "CmdOrCtrl+Shift+C".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: Theme,
    pub accent: String,
    pub hotkeys: Hotkeys,
    pub auto_save: bool,
    pub auto_copy: bool,
    pub open_in_editor: bool,
    pub explorer_menu_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            accent: "#5B7CFA".into(),
            hotkeys: Hotkeys::default(),
            auto_save: true,
            auto_copy: true,
            open_in_editor: false,
            explorer_menu_enabled: true,
        }
    }
}

/// Validate and set one field by key. Keeps the source of truth for valid shapes in Rust.
pub fn apply_update(s: &mut Settings, key: &str, value: serde_json::Value) -> Result<(), String> {
    match key {
        "theme" => {
            s.theme = serde_json::from_value(value).map_err(|e| e.to_string())?;
        }
        "accent" => {
            s.accent = value.as_str().ok_or("accent must be string")?.to_string();
        }
        "hotkeys" => {
            s.hotkeys = serde_json::from_value(value).map_err(|e| e.to_string())?;
        }
        "auto_save" => {
            s.auto_save = value.as_bool().ok_or("auto_save must be boolean")?;
        }
        "auto_copy" => {
            s.auto_copy = value.as_bool().ok_or("auto_copy must be boolean")?;
        }
        "open_in_editor" => {
            s.open_in_editor = value.as_bool().ok_or("open_in_editor must be boolean")?;
        }
        "explorer_menu_enabled" => {
            s.explorer_menu_enabled =
                value.as_bool().ok_or("explorer_menu_enabled must be boolean")?;
        }
        other => return Err(format!("unknown settings key: {other}")),
    }
    Ok(())
}

pub mod commands;
pub mod hydrate;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_are_dark_theme() {
        let s = Settings::default();
        assert!(matches!(s.theme, Theme::Dark));
        assert_eq!(s.hotkeys.capture_area, "CmdOrCtrl+Shift+1");
    }

    #[test]
    fn roundtrips_through_json() {
        let s = Settings::default();
        let text = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&text).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn apply_update_sets_known_key() {
        let mut s = Settings::default();
        apply_update(&mut s, "theme", json!("light")).unwrap();
        assert!(matches!(s.theme, Theme::Light));
    }

    #[test]
    fn apply_update_rejects_unknown_key() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "nope", json!(1)).is_err());
    }

    #[test]
    fn apply_update_rejects_bad_value() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "theme", json!("chartreuse")).is_err());
    }

    #[test]
    fn defaults_enable_autosave_and_autocopy() {
        let s = Settings::default();
        assert!(s.auto_save && s.auto_copy);
    }

    #[test]
    fn apply_update_sets_autosave_bool() {
        let mut s = Settings::default();
        apply_update(&mut s, "auto_save", json!(false)).unwrap();
        assert!(!s.auto_save);
    }

    #[test]
    fn apply_update_rejects_non_bool_autosave() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "auto_save", json!("yes")).is_err());
    }

    #[test]
    fn apply_update_sets_open_in_editor_bool() {
        let mut s = Settings::default();
        assert!(!s.open_in_editor);
        apply_update(&mut s, "open_in_editor", json!(true)).unwrap();
        assert!(s.open_in_editor);
    }

    #[test]
    fn defaults_enable_explorer_menu() {
        let s = Settings::default();
        assert!(s.explorer_menu_enabled);
    }

    #[test]
    fn apply_update_sets_explorer_menu_bool() {
        let mut s = Settings::default();
        apply_update(&mut s, "explorer_menu_enabled", json!(false)).unwrap();
        assert!(!s.explorer_menu_enabled);
    }

    #[test]
    fn apply_update_rejects_non_bool_explorer_menu() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "explorer_menu_enabled", json!("yes")).is_err());
    }
}
