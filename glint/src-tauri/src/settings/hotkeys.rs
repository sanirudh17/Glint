//! Pure hotkey helpers: the rebindable action list, accelerator validation, and
//! duplicate detection. No Tauri types — unit-tested in isolation.

use super::Hotkeys;

pub const HOTKEY_ACTIONS: [&str; 5] =
    ["capture_area", "capture_window", "capture_fullscreen", "record", "copy_path"];

#[derive(Debug, PartialEq)]
pub enum HotkeyError {
    Empty,
    NoModifier,
    BadKey(String),
    Duplicate(String), // conflicting action key
}

/// Any modifier token (case-insensitive), including Shift.
fn is_modifier(tok: &str) -> bool {
    matches!(
        tok.to_ascii_lowercase().as_str(),
        "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" | "cmd" | "command"
            | "alt" | "option" | "super" | "win" | "meta" | "shift"
    )
}

/// A "real" modifier that qualifies a global shortcut (Shift alone does not).
fn is_real_modifier(tok: &str) -> bool {
    is_modifier(tok) && !tok.eq_ignore_ascii_case("shift")
}

/// Known non-modifier main keys (matches the frontend mapper's output tokens).
fn is_valid_key(tok: &str) -> bool {
    let u = tok.to_ascii_uppercase();
    if u.len() == 1 {
        let b = u.as_bytes()[0];
        if b.is_ascii_alphanumeric() {
            return true; // A-Z, 0-9
        }
    }
    if let Some(n) = u.strip_prefix('F') {
        if let Ok(num) = n.parse::<u32>() {
            return (1..=24).contains(&num); // F1-F24
        }
    }
    matches!(
        u.as_str(),
        "SPACE" | "TAB" | "ENTER" | "UP" | "DOWN" | "LEFT" | "RIGHT"
            | "-" | "=" | "," | "." | "/" | "\\" | ";" | "'" | "[" | "]" | "`"
    )
}

pub fn validate_accelerator(accel: &str) -> Result<(), HotkeyError> {
    if accel.trim().is_empty() {
        return Err(HotkeyError::Empty);
    }
    let toks: Vec<&str> = accel.split('+').map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    let mut has_real_mod = false;
    let mut key_count = 0;
    for t in &toks {
        if is_modifier(t) {
            if is_real_modifier(t) {
                has_real_mod = true;
            }
        } else if is_valid_key(t) {
            key_count += 1;
        } else {
            return Err(HotkeyError::BadKey((*t).to_string()));
        }
    }
    if key_count != 1 {
        return Err(HotkeyError::BadKey(format!("expected one key, got {key_count}")));
    }
    if !has_real_mod {
        return Err(HotkeyError::NoModifier);
    }
    Ok(())
}

/// Normalized comparable form: uppercase tokens, modifier aliases folded, sorted.
fn normalize(accel: &str) -> String {
    let mut toks: Vec<String> = accel
        .split('+')
        .map(|t| {
            let u = t.trim().to_ascii_uppercase();
            match u.as_str() {
                "CMDORCTRL" | "COMMANDORCONTROL" | "CONTROL" => "CTRL".to_string(),
                "OPTION" => "ALT".to_string(),
                "WIN" | "META" | "CMD" | "COMMAND" | "SUPER" => "SUPER".to_string(),
                _ => u,
            }
        })
        .filter(|t| !t.is_empty())
        .collect();
    toks.sort();
    toks.join("+")
}

pub fn get_field<'a>(h: &'a Hotkeys, action: &str) -> Option<&'a str> {
    Some(match action {
        "capture_area" => h.capture_area.as_str(),
        "capture_window" => h.capture_window.as_str(),
        "capture_fullscreen" => h.capture_fullscreen.as_str(),
        "record" => h.record.as_str(),
        "copy_path" => h.copy_path.as_str(),
        _ => return None,
    })
}

pub fn set_field(h: &mut Hotkeys, action: &str, accel: String) -> bool {
    match action {
        "capture_area" => h.capture_area = accel,
        "capture_window" => h.capture_window = accel,
        "capture_fullscreen" => h.capture_fullscreen = accel,
        "record" => h.record = accel,
        "copy_path" => h.copy_path = accel,
        _ => return false,
    }
    true
}

/// If `accel` (normalized) equals any OTHER action's binding, return that action key.
pub fn duplicate_of(h: &Hotkeys, action: &str, accel: &str) -> Option<String> {
    let target = normalize(accel);
    for other in HOTKEY_ACTIONS {
        if other == action {
            continue;
        }
        if let Some(v) = get_field(h, other) {
            if !v.is_empty() && normalize(v) == target {
                return Some(other.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hk() -> Hotkeys {
        Hotkeys {
            capture_area: "CmdOrCtrl+Shift+1".into(),
            capture_window: "CmdOrCtrl+Shift+2".into(),
            capture_fullscreen: "CmdOrCtrl+Shift+3".into(),
            record: "CmdOrCtrl+Shift+5".into(),
            copy_path: "CmdOrCtrl+Shift+C".into(),
        }
    }

    #[test]
    fn valid_combo_with_ctrl_ok() {
        assert!(validate_accelerator("Ctrl+Shift+4").is_ok());
        assert!(validate_accelerator("Alt+A").is_ok());
        assert!(validate_accelerator("Super+F5").is_ok());
        assert!(validate_accelerator("CmdOrCtrl+Shift+1").is_ok());
    }

    #[test]
    fn shift_only_or_bare_rejected() {
        assert_eq!(validate_accelerator("Shift+A"), Err(HotkeyError::NoModifier));
        assert_eq!(validate_accelerator("A"), Err(HotkeyError::NoModifier));
    }

    #[test]
    fn empty_is_empty_error() {
        assert_eq!(validate_accelerator("  "), Err(HotkeyError::Empty));
    }

    #[test]
    fn unknown_key_rejected() {
        assert!(matches!(validate_accelerator("Ctrl+Foo"), Err(HotkeyError::BadKey(_))));
    }

    #[test]
    fn needs_exactly_one_main_key() {
        assert!(matches!(validate_accelerator("Ctrl+A+B"), Err(HotkeyError::BadKey(_))));
        assert!(matches!(validate_accelerator("Ctrl+Alt"), Err(HotkeyError::BadKey(_))));
    }

    #[test]
    fn punctuation_and_fkeys_ok() {
        for a in ["Ctrl+/", "Ctrl+.", "Ctrl+-", "Ctrl+[", "Alt+F12"] {
            assert!(validate_accelerator(a).is_ok(), "{a} should be valid");
        }
    }

    #[test]
    fn duplicate_detected_order_insensitive() {
        let h = hk();
        // Shift+Ctrl+2 == capture_window's CmdOrCtrl+Shift+2
        assert_eq!(duplicate_of(&h, "record", "Shift+Ctrl+2").as_deref(), Some("capture_window"));
        // Rebinding an action to its OWN current value is not a duplicate.
        assert_eq!(duplicate_of(&h, "capture_window", "Ctrl+Shift+2"), None);
        // A fresh combo collides with nothing.
        assert_eq!(duplicate_of(&h, "record", "Ctrl+Shift+9"), None);
    }

    #[test]
    fn get_set_field_roundtrip() {
        let mut h = hk();
        assert_eq!(get_field(&h, "record"), Some("CmdOrCtrl+Shift+5"));
        assert!(set_field(&mut h, "record", "Ctrl+Shift+9".into()));
        assert_eq!(get_field(&h, "record"), Some("Ctrl+Shift+9"));
        assert!(!set_field(&mut h, "nope", "x".into()));
        assert_eq!(get_field(&h, "nope"), None);
    }
}
