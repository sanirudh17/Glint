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
    pub record_system_audio: bool,
    pub record_microphone: bool,
    pub record_webcam: bool,
    pub record_click_viz: bool,
    pub record_keystrokes: bool,
    pub record_cursor_spotlight: bool,
    pub record_cursor_hide: bool,
    /// "off" | "large" | "xl" — recorded-cursor magnification.
    pub record_cursor_size: String,
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
            record_system_audio: true,
            record_microphone: false,
            record_webcam: false,
            record_click_viz: false,
            record_keystrokes: false,
            record_cursor_spotlight: false,
            record_cursor_hide: false,
            record_cursor_size: "off".into(),
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
        "record_system_audio" => {
            s.record_system_audio =
                value.as_bool().ok_or("record_system_audio must be boolean")?;
        }
        "record_microphone" => {
            s.record_microphone = value.as_bool().ok_or("record_microphone must be boolean")?;
        }
        "record_webcam" => {
            s.record_webcam = value.as_bool().ok_or("record_webcam must be boolean")?;
        }
        "record_click_viz" => {
            s.record_click_viz = value.as_bool().ok_or("record_click_viz must be boolean")?;
        }
        "record_keystrokes" => {
            s.record_keystrokes = value.as_bool().ok_or("record_keystrokes must be boolean")?;
        }
        "record_cursor_spotlight" => {
            s.record_cursor_spotlight =
                value.as_bool().ok_or("record_cursor_spotlight must be boolean")?;
        }
        "record_cursor_hide" => {
            s.record_cursor_hide = value.as_bool().ok_or("record_cursor_hide must be boolean")?;
        }
        "record_cursor_size" => {
            let v = value.as_str().ok_or("record_cursor_size must be string")?;
            if !matches!(v, "off" | "large" | "xl") {
                return Err("record_cursor_size must be off|large|xl".into());
            }
            s.record_cursor_size = v.to_string();
        }
        other => return Err(format!("unknown settings key: {other}")),
    }
    Ok(())
}

pub mod commands;
pub mod hotkeys;
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

    #[test]
    fn defaults_audio_system_on_mic_off() {
        let s = Settings::default();
        assert!(s.record_system_audio);
        assert!(!s.record_microphone);
    }

    #[test]
    fn apply_update_sets_audio_bools() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_microphone", json!(true)).unwrap();
        assert!(s.record_microphone);
        apply_update(&mut s, "record_system_audio", json!(false)).unwrap();
        assert!(!s.record_system_audio);
    }

    #[test]
    fn defaults_webcam_off() {
        assert!(!Settings::default().record_webcam);
    }

    #[test]
    fn apply_update_sets_webcam() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_webcam", serde_json::json!(true)).unwrap();
        assert!(s.record_webcam);
    }

    #[test]
    fn defaults_fx_off() {
        let s = Settings::default();
        assert!(!s.record_click_viz);
        assert!(!s.record_keystrokes);
        assert!(!s.record_cursor_spotlight);
        assert!(!s.record_cursor_hide);
        assert_eq!(s.record_cursor_size, "off");
    }

    #[test]
    fn apply_update_sets_fx_bools() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_click_viz", json!(true)).unwrap();
        apply_update(&mut s, "record_keystrokes", json!(true)).unwrap();
        apply_update(&mut s, "record_cursor_spotlight", json!(true)).unwrap();
        apply_update(&mut s, "record_cursor_hide", json!(true)).unwrap();
        assert!(s.record_click_viz && s.record_keystrokes && s.record_cursor_spotlight && s.record_cursor_hide);
    }

    #[test]
    fn apply_update_sets_cursor_size_enum() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_cursor_size", json!("xl")).unwrap();
        assert_eq!(s.record_cursor_size, "xl");
    }

    #[test]
    fn apply_update_rejects_bad_cursor_size() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "record_cursor_size", json!("huge")).is_err());
        assert!(apply_update(&mut s, "record_cursor_size", json!(3)).is_err());
    }
}
