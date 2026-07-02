//! Pure virtual-key → display-label mapping for the keystroke overlay. No Win32
//! imports here — the raw vk arrives from the hook; this table is unit-testable.

/// Map a Windows virtual-key code to a display label + whether it's a modifier.
/// Returns None for keys we don't visualize.
pub fn vk_label(vk: u32) -> Option<(&'static str, bool)> {
    let m = |s| Some((s, true));
    let k = |s| Some((s, false));
    match vk {
        // Modifiers (generic + L/R variants the LL hook may deliver).
        0x10 | 0xA0 | 0xA1 => m("Shift"),
        0x11 | 0xA2 | 0xA3 => m("Ctrl"),
        0x12 | 0xA4 | 0xA5 => m("Alt"),
        0x5B | 0x5C => m("Win"),
        // Letters A–Z.
        0x41..=0x5A => k(LETTERS[(vk - 0x41) as usize]),
        // Top-row digits 0–9.
        0x30..=0x39 => k(DIGITS[(vk - 0x30) as usize]),
        // Common named keys.
        0x0D => k("Enter"),
        0x1B => k("Esc"),
        0x20 => k("Space"),
        0x09 => k("Tab"),
        0x08 => k("Backspace"),
        0x2E => k("Del"),
        0x25 => k("←"),
        0x26 => k("↑"),
        0x27 => k("→"),
        0x28 => k("↓"),
        0x70..=0x7B => k(FKEYS[(vk - 0x70) as usize]),
        _ => None,
    }
}

const LETTERS: [&str; 26] = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
];
const DIGITS: [&str; 10] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const FKEYS: [&str; 12] = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_letters_and_digits() {
        assert_eq!(vk_label(0x41), Some(("A", false)));
        assert_eq!(vk_label(0x5A), Some(("Z", false)));
        assert_eq!(vk_label(0x30), Some(("0", false)));
        assert_eq!(vk_label(0x39), Some(("9", false)));
    }

    #[test]
    fn modifiers_flagged() {
        assert_eq!(vk_label(0x11), Some(("Ctrl", true)));
        assert_eq!(vk_label(0xA2), Some(("Ctrl", true)));
        assert_eq!(vk_label(0x10), Some(("Shift", true)));
        assert_eq!(vk_label(0x5B), Some(("Win", true)));
    }

    #[test]
    fn named_and_function_keys() {
        assert_eq!(vk_label(0x1B), Some(("Esc", false)));
        assert_eq!(vk_label(0x20), Some(("Space", false)));
        assert_eq!(vk_label(0x70), Some(("F1", false)));
        assert_eq!(vk_label(0x7B), Some(("F12", false)));
    }

    #[test]
    fn unknown_is_none() {
        assert_eq!(vk_label(0x00), None);
        assert_eq!(vk_label(0xFF), None);
    }
}
