use super::words::Word;
use base64::Engine;
use regex::Regex;
use std::{
    ops::Range,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
};
use tauri::Manager;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Suggestion {
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn luhn(text: &str) -> bool {
    let digits: Vec<u32> = text.chars().filter_map(|c| c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) || digits.iter().all(|d| *d == digits[0]) {
        return false;
    }
    digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, d)| {
            let v = if i % 2 == 1 { d * 2 } else { *d };
            if v > 9 {
                v - 9
            } else {
                v
            }
        })
        .sum::<u32>()
        % 10
        == 0
}
pub fn ranges(text: &str) -> Vec<(Range<usize>, &'static str)> {
    static PATTERNS: LazyLock<Vec<(&str, Regex)>> = LazyLock::new(|| {
        vec![
        ("Card number",Regex::new(r"\b(?:[0-9]{4}[ -]){3}[0-9]{1,7}\b|\b[0-9]{13,19}\b|\b[0-9]{4}[ -][0-9]{6}[ -][0-9]{5}\b").unwrap()),
        ("Email",Regex::new(r"(?i)\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\b").unwrap()),
        ("API key",Regex::new(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})\b").unwrap()),
        // Word spacing is normalized below, retaining original offsets for boxes.
        ("JWT",Regex::new(r"ey[JIl1][A-Za-z0-9_@-]{5,}\.[A-Za-z0-9_@-]{5,}\.[A-Za-z0-9_-]{8,}").unwrap()),
        ("IP address",Regex::new(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b|[0-9A-Fa-f]*:[0-9A-Fa-f:]+").unwrap()),
        ("Phone",Regex::new(r"(?:\+?[0-9]{1,3}[ .-]?)?(?:\([0-9]{2,4}\)|[0-9]{2,4})[ .-][0-9]{3,4}[ .-][0-9]{3,4}\b|(?:\+?[0-9]{1,3}[ -])?[0-9]{5}[ -][0-9]{5}\b|\b[0-9]{10,15}\b").unwrap()),
    ]
    });
    let mut found: Vec<(Range<usize>, &str)> = vec![];
    for (kind, re) in PATTERNS.iter() {
        let candidates = if *kind == "JWT" {
            jwt_ocr_ranges(text, re)
        } else {
            re.find_iter(text).map(|m| m.range()).collect()
        };
        for range in candidates {
            let value = &text[range.clone()];
            if *kind == "Card number" && !luhn(value) {
                continue;
            }
            if *kind == "Phone"
                && !(7..=15).contains(&value.bytes().filter(|c| c.is_ascii_digit()).count())
            {
                continue;
            }
            if *kind == "IP address" && value.parse::<std::net::IpAddr>().is_err() {
                continue;
            }
            if found
                .iter()
                .any(|(r, _)| r.start < range.end && range.start < r.end)
            {
                continue;
            }
            found.push((range, kind));
        }
    }
    found.sort_by_key(|v| v.0.start);
    found
}

/// Small screenshot text is often split inside a JWT segment, not only at dots.
/// Normalize whitespace for matching, then map back to every original OCR word.
/// Keep the three long segments and recognizable header; ordinary prose and URLs
/// must not become token suggestions merely because their spaces were removed.
fn jwt_ocr_ranges(text: &str, pattern: &Regex) -> Vec<Range<usize>> {
    let mut compact = String::with_capacity(text.len());
    let mut offsets = Vec::with_capacity(text.len());
    for (offset, ch) in text.char_indices() {
        if !ch.is_whitespace() {
            compact.push(ch);
            offsets.extend(std::iter::repeat_n(offset, ch.len_utf8()));
        }
    }
    pattern
        .find_iter(&compact)
        .filter_map(|m| {
            let start = offsets[m.start()];
            // The regex ends in ASCII, so the last mapped character is one byte.
            let end = offsets[m.end() - 1] + 1;
            let previous = text[..start].chars().next_back();
            if previous.is_some_and(|ch| ch.is_alphanumeric() || ch == '_') {
                return None;
            }
            Some(start..end)
        })
        .collect()
}
pub fn detect(words: &[Word], width: u32, height: u32) -> Vec<Suggestion> {
    let mut out = vec![];
    let mut start = 0;
    while start < words.len() {
        let mut end = start + 1;
        while end < words.len() && words[end].line == words[start].line {
            end += 1;
        }
        let mut text = String::new();
        let mut spans = vec![];
        for word in &words[start..end] {
            if !text.is_empty() {
                text.push(' ');
            }
            let begin = text.len();
            text.push_str(&word.text);
            spans.push((begin..text.len(), word));
        }
        for (range, kind) in ranges(&text) {
            let matched: Vec<_> = spans
                .iter()
                .filter(|(r, _)| r.start < range.end && range.start < r.end)
                .map(|(_, w)| *w)
                .collect();
            if matched.is_empty() {
                continue;
            }
            let x = (matched.iter().map(|w| w.x).fold(f64::INFINITY, f64::min) - 4.).max(0.);
            let y = (matched.iter().map(|w| w.y).fold(f64::INFINITY, f64::min) - 4.).max(0.);
            let right =
                (matched.iter().map(|w| w.x + w.w).fold(0., f64::max) + 4.).min(width as f64);
            let bottom =
                (matched.iter().map(|w| w.y + w.h).fold(0., f64::max) + 4.).min(height as f64);
            if right > x && bottom > y {
                out.push(Suggestion {
                    kind: kind.into(),
                    x,
                    y,
                    w: right - x,
                    h: bottom - y,
                });
            }
        }
        start = end;
    }
    out
}

/// Use both independent readings for privacy recall. A more accurate transcription
/// model can still misread one IP or credential; a second reader may recover it.
pub(crate) fn detect_with_fallback(
    words: &[Word],
    rgba: &[u8],
    width: u32,
    height: u32,
    cancel: &AtomicBool,
) -> Result<Vec<Suggestion>, String> {
    let mut found = detect(words, width, height);
    if super::neural::engine_id() != "tesseract" {
        let secondary = super::words::recognize_tesseract(rgba, width, height, cancel)?;
        for suggestion in detect(&secondary, width, height) {
            merge_suggestion(&mut found, suggestion);
        }
    }
    Ok(found)
}
fn merge_suggestion(found: &mut Vec<Suggestion>, next: Suggestion) {
    for current in found.iter_mut().filter(|s| s.kind == next.kind) {
        let overlap_w = (current.x + current.w).min(next.x + next.w) - current.x.max(next.x);
        let overlap_h = (current.y + current.h).min(next.y + next.h) - current.y.max(next.y);
        if overlap_w > 0.
            && overlap_h > 0.
            && overlap_w * overlap_h > 0.5 * (current.w * current.h).min(next.w * next.h)
        {
            let right = (current.x + current.w).max(next.x + next.w);
            let bottom = (current.y + current.h).max(next.y + next.h);
            current.x = current.x.min(next.x);
            current.y = current.y.min(next.y);
            current.w = right - current.x;
            current.h = bottom - current.y;
            return;
        }
    }
    found.push(next);
}

#[derive(Default)]
pub struct ScanJobs {
    current: Option<(String, Arc<AtomicBool>)>,
    cancelled: std::collections::VecDeque<String>,
}
impl ScanJobs {
    fn cancel(&mut self, id: String) {
        if let Some((current, token)) = &self.current {
            if *current == id {
                token.store(true, Ordering::Relaxed);
            }
        }
        if self.cancelled.len() >= 64 {
            self.cancelled.pop_front();
        }
        self.cancelled.push_back(id);
    }
    fn begin(&mut self, id: String) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(self.cancelled.iter().any(|old| *old == id)));
        if let Some((_, old)) = self.current.take() {
            old.store(true, Ordering::Relaxed);
        }
        self.current = Some((id, token.clone()));
        token
    }
}
#[derive(Default)]
pub struct ScanState(pub Mutex<ScanJobs>);
#[tauri::command]
pub fn privacy_cancel(app: tauri::AppHandle, request_id: String) {
    app.state::<ScanState>()
        .0
        .lock()
        .unwrap()
        .cancel(request_id);
}
#[tauri::command(async)]
pub fn privacy_scan(
    app: tauri::AppHandle,
    png_base64: String,
    request_id: String,
) -> Result<Vec<Suggestion>, String> {
    let cancel = app
        .state::<ScanState>()
        .0
        .lock()
        .unwrap()
        .begin(request_id.clone());
    let result = (|| {
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        if png_base64.len() > 45_000_000 {
            return Err("Choose a smaller screenshot".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png_base64)
            .map_err(|_| "Couldn't read this screenshot")?;
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|_| "Couldn't read this screenshot")?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|_| "Choose an image no larger than 4,096 pixels per side")?
            .to_rgba8();
        let words = super::words::recognize(&image, image.width(), image.height(), &cancel)?;
        if cancel.load(Ordering::Relaxed) {
            return Err("Cancelled".into());
        }
        detect_with_fallback(&words, &image, image.width(), image.height(), &cancel)
    })();
    {
        let state = app.state::<ScanState>();
        let mut job = state.0.lock().unwrap();
        if job.current.as_ref().is_some_and(|j| j.0 == request_id) {
            job.current = None;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Candidate evaluation, not a quality pass: records misses without changing
    /// production selection. No download or model execution happens in this test.
    #[test]
    #[ignore = "requires GLINT_OCR_FIXTURES and the Indra benchmark JSON"]
    fn evaluate_indra_privacy_geometry() {
        let root = std::path::PathBuf::from(std::env::var("GLINT_OCR_FIXTURES").unwrap());
        let input = std::env::var("GLINT_INDRA_REPORT").unwrap_or("indra-benchmark.json".into());
        let report: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join(&input)).unwrap()).unwrap();
        let mut reports = vec![];
        for case in report["results"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["corpus"] == "privacy")
        {
            let name = case["file"].as_str().unwrap();
            assert_eq!(
                case["rotation"], 0,
                "probe assumes original image coordinates"
            );
            let mut image = image::open(root.join(name)).unwrap().to_rgba8();
            let words = case["lines"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .map(|(i, line)| {
                    let b = line["box"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_f64().unwrap())
                        .collect::<Vec<_>>();
                    assert!(b.iter().all(|v| v.is_finite()));
                    assert!(b[2] >= b[0] && b[3] >= b[1]);
                    // Public Indra output has line boxes. Do not invent character boxes.
                    Word {
                        text: line["text"].as_str().unwrap().into(),
                        line: i.to_string(),
                        x: b[0],
                        y: b[1],
                        w: b[2] - b[0],
                        h: b[3] - b[1],
                    }
                })
                .collect::<Vec<_>>();
            let found = detect(&words, image.width(), image.height());
            for suggestion in &found {
                for y in suggestion.y.floor() as u32
                    ..((suggestion.y + suggestion.h).ceil() as u32).min(image.height())
                {
                    for x in suggestion.x.floor() as u32
                        ..((suggestion.x + suggestion.w).ceil() as u32).min(image.width())
                    {
                        image.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
                    }
                }
            }
            let mut bounds = vec![];
            for bound in case["reference_bounds"].as_array().unwrap() {
                let kind = bound["kind"].as_str().unwrap();
                let b = bound["box"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap())
                    .collect::<Vec<_>>();
                let complete_box = found.iter().any(|s| {
                    s.kind == kind
                        && s.x <= b[0]
                        && s.y <= b[1]
                        && s.x + s.w >= b[2]
                        && s.y + s.h >= b[3]
                });
                let mut opaque = true;
                for y in b[1].ceil() as u32..b[3].floor() as u32 {
                    for x in b[0].ceil() as u32..b[2].floor() as u32 {
                        opaque &= image.get_pixel(x, y).0 == [0, 0, 0, 255];
                    }
                }
                bounds.push(serde_json::json!({"kind":kind,"complete_box":complete_box,"opaque_pixels":opaque}));
            }
            image
                .save(root.join(format!(
                    "{}-redacted-{name}",
                    input.trim_end_matches(".json")
                )))
                .unwrap();
            reports.push(serde_json::json!({"file":name,"bounds":bounds,"suggestions":found}));
        }
        assert_eq!(reports.len(), 10, "all privacy fixtures must be evaluated");
        let output = root.join(format!("{}-privacy.json", input.trim_end_matches(".json")));
        std::fs::write(output, serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    }
    #[test]
    fn independent_readers_merge_coverage_without_merging_distinct_values() {
        let mut found = vec![Suggestion {
            kind: "Email".into(),
            x: 10.,
            y: 10.,
            w: 100.,
            h: 20.,
        }];
        merge_suggestion(
            &mut found,
            Suggestion {
                kind: "Email".into(),
                x: 8.,
                y: 8.,
                w: 106.,
                h: 24.,
            },
        );
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].x, found[0].w), (8., 106.));
        merge_suggestion(
            &mut found,
            Suggestion {
                kind: "Email".into(),
                x: 200.,
                y: 10.,
                w: 80.,
                h: 20.,
            },
        );
        assert_eq!(found.len(), 2);
        merge_suggestion(
            &mut found,
            Suggestion {
                kind: "Phone".into(),
                x: 8.,
                y: 8.,
                w: 106.,
                h: 24.,
            },
        );
        assert_eq!(found.len(), 3);
    }
    #[test]
    fn detects_jwt_with_ocr_spaces_and_maps_the_entire_original_span() {
        // Exact OCR error from the half-size composed screenshot regression.
        let token = "eyIhbGci0i JIUZIINiI9. eyIzdwIiOiIkZW1vIne. ABCDEFGHIIKLMNOP";
        let text = format!("é Token: {token}");
        let found = ranges(&text);
        let jwt = found.iter().find(|v| v.1 == "JWT").unwrap();
        assert_eq!(&text[jwt.0.clone()], token);
        let words = [
            ("Token:", 0.),
            ("eyIhbGci0i", 60.),
            ("JIUZIINiI9.", 150.),
            ("eyIzdwIiOiIkZW1vIne.", 240.),
            ("ABCDEFGHIIKLMNOP", 410.),
        ]
        .map(|(text, x)| Word {
            text: text.into(),
            line: "1".into(),
            x,
            y: 10.,
            w: 80.,
            h: 16.,
        });
        let found = detect(&words, 600, 100);
        let jwt = found.iter().find(|v| v.kind == "JWT").unwrap();
        assert_eq!((jwt.x, jwt.y, jwt.w, jwt.h), (56., 6., 438., 24.));
    }
    #[test]
    fn jwt_normalization_keeps_structure_and_boundaries() {
        for text in [
            "Token: this is ordinary prose with 1234 numbers",
            "https://example.com/some/path",
            "moneyJabcdefgh.abcdefgh.abcdefgh",
            "eyJabcdefgh.onlyTwoSegments",
            "eyJabc.short.parts",
        ] {
            assert!(!ranges(text).iter().any(|v| v.1 == "JWT"), "{text}");
        }
        for text in [
            "eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiJkZW1vIn0 . ABCDEFGHIJKLMNOP",
            "Token: ey1hbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ABCDEFGHIJKLMNOP",
        ] {
            assert!(ranges(text).iter().any(|v| v.1 == "JWT"), "{text}");
        }
    }
    #[test]
    fn recognizes_common_international_formats_and_ipv6_loopback() {
        assert!(ranges("+91 98765 43210").iter().any(|v| v.1 == "Phone"));
        assert!(ranges("::1").iter().any(|v| v.1 == "IP address"));
        assert!(ranges("3782 822463 10005")
            .iter()
            .any(|v| v.1 == "Card number"));
    }
    #[test]
    fn cancellation_before_start_and_replacement_are_honored() {
        let mut jobs = ScanJobs::default();
        jobs.cancel("one".into());
        assert!(jobs.begin("one".into()).load(Ordering::Relaxed));
        let previous = jobs.begin("two".into());
        let current = jobs.begin("three".into());
        assert!(previous.load(Ordering::Relaxed));
        assert!(!current.load(Ordering::Relaxed));
    }
    #[test]
    fn validates_cards_and_rejects_lookalikes() {
        assert!(luhn("4111 1111 1111 1111"));
        assert!(!luhn("4111 1111 1111 1112"));
        assert!(!luhn("0000000000000000"));
    }
    #[test]
    fn detects_every_required_kind_without_duplicate_card_phone() {
        let text="mail@sample.test 4111 1111 1111 1111 +1 (415) 555-0172 192.168.1.10 2001:db8::1 sk-proj-ABCDEFGHIJKLMNOP123456789 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ABCDEFGHIJKLMNOP";
        let found = ranges(text);
        for kind in [
            "Email",
            "Card number",
            "Phone",
            "IP address",
            "API key",
            "JWT",
        ] {
            assert!(found.iter().any(|v| v.1 == kind), "{kind}");
        }
        assert_eq!(found.iter().filter(|v| v.1 == "Card number").count(), 1);
        assert!(!ranges("Version 999.400.3.500 and 4111111111111112")
            .iter()
            .any(|v| v.1 == "IP address" || v.1 == "Card number"));
    }
    #[test]
    fn maps_unicode_and_multiword_cards_to_padded_boxes() {
        let words = [
            ("é", 0.),
            ("4111", 20.),
            ("1111", 60.),
            ("1111", 100.),
            ("1111", 140.),
        ]
        .map(|(text, x)| Word {
            text: text.into(),
            line: "1".into(),
            x,
            y: 10.,
            w: 32.,
            h: 16.,
        });
        let s = detect(&words, 200, 100);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].kind, "Card number");
        assert_eq!((s[0].x, s[0].y, s[0].w, s[0].h), (16., 6., 160., 24.));
    }
}
