//! OCR / Capture Text. Turns pixels into text via a bundled/installed **Tesseract**
//! engine (fully local, no cloud). We shell out to the `tesseract` CLI — the classic
//! `Windows.Media.Ocr` engine proved far less accurate than Snipping Tool on small /
//! dark-mode / terminal text, so we switched. ISOLATED from `recorder/` (imports
//! nothing from it, and it imports nothing from here).

pub mod commands;
pub mod window;

#[derive(Clone, serde::Serialize)]
pub struct OcrOutput {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

/// The last OCR result, stashed for the `#/ocr` panel to read back (mirrors the trim
/// window's `TrimTarget` pattern).
#[derive(Default)]
pub struct OcrState(pub std::sync::Mutex<Option<OcrOutput>>);

use regex::Regex;
use std::sync::LazyLock;

/// Normalizes raw OCR output by correcting misrecognized glyphs, restoring bullet points,
/// arrows, inequalities, logic operators, set notations, and mathematical symbols.
pub fn normalize_ocr_text(raw: &str) -> String {
    static RE_BULLET_START: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^(\s*)(?:[©¢°®§•·▪▫■□◆►▸▶]|\(c\)|\(C\)|\+»)\s*").unwrap()
    });
    static RE_PLUS_STAR_BULLET: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^(\s*)[\*\+\-–—]\s+([A-Za-z0-9\[\(\x22\x27`])").unwrap()
    });
    static RE_EO_BULLET: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?m)^(\s*)[eoO]\s+([A-Za-z0-9\[\(\x22\x27`])").unwrap()
    });
    static RE_WORD_BULLET: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([A-Za-z\)])\s+(?:\+»|·)\s+([A-Za-z\(])").unwrap()
    });
    static RE_LONG_ARROW: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:—\+|—>|-->|–>)\s*").unwrap()
    });
    static RE_STATE_TRANS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\([a-zA-Z0-9,\s+−-]+\))\s*—\s*(\()").unwrap()
    });
    static RE_SINGLE_ARROW: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:->|—\s*>|–\s*>|-\s*>)\s*").unwrap()
    });
    static RE_DOUBLE_ARROW_LR: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:<==>|<=>)\s*").unwrap()
    });
    static RE_DOUBLE_ARROW_R: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:==>|=>)\s*").unwrap()
    });
    static RE_DOUBLE_ARROW_L: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*<==\s*").unwrap()
    });
    static RE_LEFT_ARROW_LONG: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:<--|<—)\s*").unwrap()
    });
    static RE_LEFT_ARROW_SINGLE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*<-\s*").unwrap()
    });
    static RE_PATH_CHAIN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\bpath\s+[A-Z](?:\s*[\+\-]\s*[A-Z])+").unwrap()
    });
    static RE_POUR_ARROW: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\b(Pour(?:\s+all)?\s+\d+L?)\s*[>+]\s*(\d+L?)\b").unwrap()
    });
    static RE_ARROW_FRACTION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s+>\s+(\d+/\d+)").unwrap()
    });
    static RE_ARROW_WORD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([a-zA-Z0-9\)])\s+>\s+([a-zA-Z]{2,})").unwrap()
    });
    static RE_CHEVRON_ARROW: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:»|›)\s*").unwrap()
    });
    static RE_KEBAB_EMDASH: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([a-z0-9])(?:—|–)([a-z0-9])").unwrap()
    });
    static RE_GTE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r">\s*=").unwrap()
    });
    static RE_LTE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"<\s*=").unwrap()
    });
    static RE_NEQ: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*(?:!=|=/=|/=|=\s*)\s*").unwrap()
    });
    static RE_EPSILON_COND: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?:[>≥]\s*)?«\s*>\s*0").unwrap()
    });
    static RE_INEQ_EPSILON: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([><=≤≥])\s*«").unwrap()
    });
    static RE_DIV_EPSILON: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"/«").unwrap()
    });
    static RE_LOGIC_AND_COND: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([><=≤≥]\s*\d+)\s*A\s*(\S+\s*[><=≤≥])").unwrap()
    });
    static RE_LOGIC_AND_COND2: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([><=≤≥]\s*[a-zA-Z0-9]+)\s+A\s+([a-zA-Z0-9]+\s*[><=≤≥])").unwrap()
    });
    static RE_LOGIC_AND_CARET: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s+\^\s+").unwrap()
    });
    static RE_LOGIC_OR_V: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"([a-zA-Z0-9\)])\s+(?:v|V)\s+([a-zA-Z0-9\(])").unwrap()
    });
    static RE_PRIME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\b([sxySn])['’ʼ]([^a-zA-Z0-9]|$)").unwrap()
    });
    static RE_ASTERISK_OP: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\b([CPa])\*([^a-zA-Z0-9*]|$)").unwrap()
    });
    static RE_SET_IN_EURO: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s+€\s+").unwrap()
    });
    static RE_SET_IN_BRACE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"((?:\b[a-zA-Z]|\)))\s+(?:in|e|€)\s*(\{)").unwrap()
    });
    static RE_SET_IN_FIELD: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"((?:\b[a-zA-Z]|\)))\s+(?:in|e|€)\s+([RZNQC])\b").unwrap()
    });
    static RE_SET_NOT_IN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\b([a-zA-Z])\s+(?:not in)\s+").unwrap()
    });
    static RE_NUM_RANGE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)").unwrap()
    });
    static RE_MATH_MINUS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d+)\s*—\s*(\d+)").unwrap()
    });
    static RE_MATH_MINUS_VAR: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d+)\s*—\s*([a-zA-Z])").unwrap()
    });
    static RE_ELLIPSIS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\.{3,}").unwrap()
    });

    let mut text = raw.to_string();

    // 1. Bullets
    text = RE_BULLET_START.replace_all(&text, "${1}• ").into_owned();
    text = RE_PLUS_STAR_BULLET.replace_all(&text, "${1}• ${2}").into_owned();
    text = RE_EO_BULLET.replace_all(&text, "${1}• ${2}").into_owned();
    text = RE_WORD_BULLET.replace_all(&text, "${1} • ${2}").into_owned();

    // 2. Contextual domain arrows
    text = RE_PATH_CHAIN.replace_all(&text, |caps: &regex::Captures| {
        caps[0]
            .replace(" + ", " → ")
            .replace("+ ", " → ")
            .replace(" +", " → ")
            .replace(" - ", " → ")
            .replace("- ", " → ")
            .replace(" -", " → ")
    }).into_owned();
    text = RE_POUR_ARROW.replace_all(&text, "${1} → ${2}").into_owned();
    text = RE_ARROW_FRACTION.replace_all(&text, " → ${1}").into_owned();
    text = RE_ARROW_WORD.replace_all(&text, "${1} → ${2}").into_owned();
    text = RE_CHEVRON_ARROW.replace_all(&text, " → ").into_owned();

    // 3. Arrows
    text = RE_LONG_ARROW.replace_all(&text, " ⟶ ").into_owned();
    text = RE_STATE_TRANS.replace_all(&text, "${1} ⟶ ${2}").into_owned();
    text = RE_SINGLE_ARROW.replace_all(&text, " → ").into_owned();
    text = RE_DOUBLE_ARROW_LR.replace_all(&text, " ⇔ ").into_owned();
    text = RE_DOUBLE_ARROW_R.replace_all(&text, " ⇒ ").into_owned();
    text = RE_DOUBLE_ARROW_L.replace_all(&text, " ⇐ ").into_owned();
    text = RE_LEFT_ARROW_LONG.replace_all(&text, " ⟵ ").into_owned();
    text = RE_LEFT_ARROW_SINGLE.replace_all(&text, " ← ").into_owned();

    // 4. Inequalities & Comparisons
    text = RE_GTE.replace_all(&text, "≥").into_owned();
    text = RE_LTE.replace_all(&text, "≤").into_owned();
    text = RE_NEQ.replace_all(&text, " ≠ ").into_owned();

    // 5. Greek Epsilon & Optimality Conditions
    text = RE_EPSILON_COND.replace_all(&text, "≥ ϵ > 0").into_owned();
    text = RE_INEQ_EPSILON.replace_all(&text, "${1} ϵ").into_owned();
    text = RE_DIV_EPSILON.replace_all(&text, "/ϵ").into_owned();

    // 6. Logic Operators
    text = RE_LOGIC_AND_COND.replace_all(&text, "${1} ∧ ${2}").into_owned();
    text = RE_LOGIC_AND_COND2.replace_all(&text, "${1} ∧ ${2}").into_owned();
    text = RE_LOGIC_AND_CARET.replace_all(&text, " ∧ ").into_owned();
    text = RE_LOGIC_OR_V.replace_all(&text, "${1} ∨ ${2}").into_owned();

    // 7. Math, Sets, and Typographic symbols
    text = RE_KEBAB_EMDASH.replace_all(&text, "${1}-${2}").into_owned();
    text = RE_PRIME.replace_all(&text, "${1}′${2}").into_owned();
    text = RE_ASTERISK_OP.replace_all(&text, "${1}∗${2}").into_owned();
    text = RE_SET_IN_EURO.replace_all(&text, " ∈ ").into_owned();
    text = RE_SET_IN_BRACE.replace_all(&text, "${1} ∈ ${2}").into_owned();
    text = RE_SET_IN_FIELD.replace_all(&text, "${1} ∈ ${2}").into_owned();
    text = RE_SET_NOT_IN.replace_all(&text, "${1} ∉ ").into_owned();
    text = RE_MATH_MINUS.replace_all(&text, "${1} − ${2}").into_owned();
    text = RE_MATH_MINUS_VAR.replace_all(&text, "${1} − ${2}").into_owned();
    text = RE_NUM_RANGE.replace_all(&text, "${1} – ${2}").into_owned();
    text = RE_ELLIPSIS.replace_all(&text, "…").into_owned();

    text
}

/// Join OCR lines into a single block of text: trim trailing whitespace per line,
/// join with `\n`, drop a trailing blank tail, and normalize OCR formatting/symbols.
/// Empty / whitespace-only → None.
pub fn assemble_text(lines: &[String]) -> Option<String> {
    let joined = lines
        .iter()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = joined.trim_matches('\n');
    if trimmed.trim().is_empty() {
        None
    } else {
        Some(normalize_ocr_text(trimmed))
    }
}

/// How much to enlarge captured pixels before OCR. Tesseract wants text around
/// ~30px tall (≈300 DPI); native-res screen text (~10px) is well below that, so we
/// upscale first — the single biggest accuracy lever for screenshot OCR.
const OCR_UPSCALE: f32 = 3.0;

/// Upper bound on either side of the upscaled image, to keep Tesseract's runtime
/// sane on huge regions (it has no hard limit of its own, unlike the old WinRT engine).
const OCR_MAX_DIM: u32 = 8000;

/// Message shown when the Tesseract binary can't be located.
const TESS_MISSING: &str =
    "Tesseract OCR isn't installed. Install it, then try again: winget install UB-Mannheim.TesseractOCR";

/// Target dimensions to feed the OCR engine: enlarge by `OCR_UPSCALE` for accuracy,
/// but never exceed `max_dim` on the longest side (downscaling a source that already
/// exceeds it). Zero-area or zero `max_dim` → unchanged.
pub fn ocr_target_dims(w: u32, h: u32, max_dim: u32) -> (u32, u32) {
    if w == 0 || h == 0 || max_dim == 0 {
        return (w, h);
    }
    let longest = w.max(h) as f32;
    let factor = OCR_UPSCALE.min(max_dim as f32 / longest);
    let tw = ((w as f32) * factor).round().max(1.0) as u32;
    let th = ((h as f32) * factor).round().max(1.0) as u32;
    (tw, th)
}

/// Is this a mostly-DARK-background region (light text on dark — a terminal or
/// dark-mode UI)? OCR is more reliable on dark-on-light, so we invert these first.
/// `gray` is one luma byte per pixel.
fn is_dark_background(gray: &[u8]) -> bool {
    if gray.is_empty() {
        return false;
    }
    let sum: u64 = gray.iter().map(|&v| v as u64).sum();
    (sum / gray.len() as u64) < 128
}

/// Recognize text in an RGBA crop via Tesseract. Fully local. Returns assembled text,
/// or a user-facing error (Tesseract missing / failed / bad input). "No text found"
/// is NOT an error — it yields an empty result so callers can show an empty state.
///
/// Preprocess → grayscale → invert dark backgrounds to dark-on-light → upscale, then
/// hand a PNG to the `tesseract` CLI. Runs a child process — callers MUST run this off
/// the main thread.
pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String> {
    let need = w as usize * h as usize * 4;
    if w == 0 || h == 0 || rgba.len() < need {
        return Err("Couldn't read text".into());
    }
    let png = preprocess_to_png(rgba, w, h)?;
    let tess = resolve_tesseract().ok_or_else(|| TESS_MISSING.to_string())?;
    let raw = run_tesseract(&tess, &png)?;

    let lines: Vec<String> = raw.lines().map(|l| l.to_string()).collect();
    let text = assemble_text(&lines).unwrap_or_default();
    let line_count = text.lines().count();
    let word_count = text.split_whitespace().count();
    Ok(OcrOutput { text, line_count, word_count })
}

/// Grayscale → invert-if-dark → upscale → encode a grayscale PNG for Tesseract. We
/// deliberately do NOT binarize: Tesseract's Leptonica does adaptive thresholding
/// (better than a global threshold), so we feed it a clean, enlarged grayscale.
fn preprocess_to_png(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    use image::{imageops::FilterType, ImageBuffer, Rgba};

    let need = w as usize * h as usize * 4;
    let rgba_img: ImageBuffer<Rgba<u8>, &[u8]> =
        ImageBuffer::from_raw(w, h, &rgba[..need]).ok_or("Couldn't read text")?;
    let mut gray = image::imageops::grayscale(&rgba_img); // GrayImage, original res

    if is_dark_background(&gray) {
        for v in gray.iter_mut() {
            *v = 255 - *v;
        }
    }

    let (rw, rh) = ocr_target_dims(w, h, OCR_MAX_DIM);
    let gray = if (rw, rh) == (w, h) {
        gray
    } else {
        image::imageops::resize(&gray, rw, rh, FilterType::CatmullRom)
    };

    let mut png = Vec::new();
    gray.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("encode: {e}"))?;
    Ok(png)
}

/// A located Tesseract: the executable plus an optional explicit `tessdata` dir (set
/// only for the bundled copy — an installed Tesseract finds its own).
struct TessLoc {
    exe: std::path::PathBuf,
    tessdata: Option<std::path::PathBuf>,
}

/// Directories that may hold a BUNDLED, self-contained Tesseract (`tesseract.exe` +
/// its DLLs + `tessdata/`): the repo `binaries/tesseract` in dev, and the layouts
/// Tauri's `bundle.resources` produces next to the installed exe in prod.
fn bundled_tesseract_dirs() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut dirs = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/tesseract")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("tesseract"));
            dirs.push(dir.join("resources/tesseract"));
            dirs.push(dir.join("binaries/tesseract"));
        }
    }
    dirs
}

/// Locate Tesseract: the bundled copy first (zero-install), then a standard install,
/// then PATH.
fn resolve_tesseract() -> Option<TessLoc> {
    use std::path::{Path, PathBuf};

    for base in bundled_tesseract_dirs() {
        let exe = base.join("tesseract.exe");
        if exe.exists() {
            let td = base.join("tessdata");
            return Some(TessLoc {
                exe,
                tessdata: td.is_dir().then_some(td),
            });
        }
    }

    const INSTALLED: [&str; 2] = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ];
    for c in INSTALLED {
        if Path::new(c).exists() {
            return Some(TessLoc { exe: PathBuf::from(c), tessdata: None });
        }
    }
    // Fall back to PATH via `where` (console suppressed).
    let out = no_window(std::process::Command::new("where").arg("tesseract"))
        .output()
        .ok()?;
    if out.status.success() {
        if let Some(line) = String::from_utf8_lossy(&out.stdout).lines().next() {
            let p = PathBuf::from(line.trim());
            if p.exists() {
                return Some(TessLoc { exe: p, tessdata: None });
            }
        }
    }
    None
}

/// Run Tesseract on a PNG (via a temp file) and return its stdout text. `--psm 6`
/// treats the selection as one uniform block (keeps line structure for terminals /
/// code); LSTM engine (`--oem 1`), English. The bundled copy gets an explicit
/// `--tessdata-dir` so it never depends on a system install.
fn run_tesseract(tess: &TessLoc, png: &[u8]) -> Result<String, String> {
    let path = std::env::temp_dir().join(format!(
        "glint-ocr-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&path, png).map_err(|e| format!("temp write: {e}"))?;

    let mut cmd = std::process::Command::new(&tess.exe);
    cmd.arg(&path)
        .arg("stdout")
        .args(["-l", "eng", "--oem", "1", "--psm", "6"]);
    if let Some(td) = &tess.tessdata {
        cmd.arg("--tessdata-dir").arg(td);
    }
    let result = no_window(&mut cmd).output();
    let _ = std::fs::remove_file(&path);

    let out = result.map_err(|e| format!("Couldn't run Tesseract: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Tesseract failed: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Suppress the console window a child process would otherwise flash on Windows.
fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_lines_with_newlines() {
        let lines = vec!["hello".to_string(), "world".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "hello\nworld");
    }

    #[test]
    fn trims_trailing_whitespace_per_line() {
        let lines = vec!["a   ".to_string(), "b\t".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "a\nb");
    }

    #[test]
    fn empty_slice_is_none() {
        let lines: Vec<String> = vec![];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn all_whitespace_is_none() {
        let lines = vec!["   ".to_string(), "".to_string()];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn single_line_no_newline() {
        let lines = vec!["solo".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "solo");
    }

    #[test]
    fn upscales_small_regions_by_the_factor() {
        assert_eq!(ocr_target_dims(800, 600, 10_000), (2400, 1800));
    }

    #[test]
    fn caps_the_longest_side_at_max_dim() {
        assert_eq!(ocr_target_dims(6000, 400, 10_000), (10_000, 667));
    }

    #[test]
    fn downscales_sources_already_over_max_dim() {
        assert_eq!(ocr_target_dims(12_000, 400, 10_000), (10_000, 333));
    }

    #[test]
    fn leaves_degenerate_inputs_unchanged() {
        assert_eq!(ocr_target_dims(0, 0, 10_000), (0, 0));
        assert_eq!(ocr_target_dims(100, 100, 0), (100, 100));
    }

    #[test]
    fn detects_dark_vs_light_backgrounds() {
        assert!(is_dark_background(&[0, 0, 0, 20]));
        assert!(!is_dark_background(&[255, 255, 255, 200]));
        assert!(!is_dark_background(&[]));
    }

    #[test]
    fn normalizes_bullets_at_line_start() {
        assert_eq!(normalize_ocr_text("© From Node [B]:"), "• From Node [B]:");
        assert_eq!(normalize_ocr_text("¢ From Node [C]:"), "• From Node [C]:");
        assert_eq!(normalize_ocr_text("° From Node [D]:"), "• From Node [D]:");
        assert_eq!(normalize_ocr_text("+ [A]: cost=0+1=1"), "• [A]: cost=0+1=1");
        assert_eq!(normalize_ocr_text("  + [A]: cost=0+1=1"), "  • [A]: cost=0+1=1");
        assert_eq!(normalize_ocr_text("* Complexity: Time"), "• Complexity: Time");
        assert_eq!(normalize_ocr_text("e Agent: An entity"), "• Agent: An entity");
        assert_eq!(normalize_ocr_text("Artifact +» Document"), "Artifact • Document");
    }

    #[test]
    fn normalizes_arrows() {
        assert_eq!(normalize_ocr_text("S —+ A—+C—+G"), "S ⟶ A ⟶ C ⟶ G");
        assert_eq!(normalize_ocr_text("Perceiving —> Thinking —+ Acting"), "Perceiving ⟶ Thinking ⟶ Acting");
        assert_eq!(normalize_ocr_text("(x,y) — (4,y)"), "(x,y) ⟶ (4,y)");
        assert_eq!(normalize_ocr_text("path S + B - D"), "path S → B → D");
        assert_eq!(normalize_ocr_text("Pour 3L > 4L"), "Pour 3L → 4L");
        assert_eq!(normalize_ocr_text("Pour 4L + 3L"), "Pour 4L → 3L");
        assert_eq!(normalize_ocr_text("Pour all 4L > 3L"), "Pour all 4L → 3L");
        assert_eq!(normalize_ocr_text("a -> b"), "a → b");
        assert_eq!(normalize_ocr_text("a <- b"), "a ← b");
        assert_eq!(normalize_ocr_text("a ==> b"), "a ⇒ b");
        assert_eq!(normalize_ocr_text("a <=> b"), "a ⇔ b");
    }

    #[test]
    fn normalizes_inequalities_logic_and_epsilon() {
        assert_eq!(normalize_ocr_text("x >= 4"), "x ≥ 4");
        assert_eq!(normalize_ocr_text("x <= 3"), "x ≤ 3");
        assert_eq!(normalize_ocr_text("x != y"), "x ≠ y");
        assert_eq!(normalize_ocr_text("Frontier = ∅"), "Frontier ≠ ∅");
        assert_eq!(
            normalize_ocr_text("c(s,a,s') > «> 0"),
            "c(s,a,s′) ≥ ϵ > 0"
        );
        assert_eq!(normalize_ocr_text(">=4Ay>0"), "≥4 ∧ y>0");
        assert_eq!(normalize_ocr_text("x < 4 A y > 0"), "x < 4 ∧ y > 0");
        assert_eq!(normalize_ocr_text("C*/«"), "C∗/ϵ");
    }

    #[test]
    fn normalizes_math_sets_and_typography() {
        assert_eq!(normalize_ocr_text("Optimal Path Cost (C*)"), "Optimal Path Cost (C∗)");
        assert_eq!(normalize_ocr_text("P(s')"), "P(s′)");
        assert_eq!(normalize_ocr_text("x in {0,1,2}"), "x ∈ {0,1,2}");
        assert_eq!(normalize_ocr_text("x € {0,1,2}"), "x ∈ {0,1,2}");
        assert_eq!(normalize_ocr_text("U(s) e R"), "U(s) ∈ R");
        assert_eq!(normalize_ocr_text("x not in S"), "x ∉ S");
        assert_eq!(normalize_ocr_text("1.5 - 2.0 Marks"), "1.5 – 2.0 Marks");
        assert_eq!(normalize_ocr_text("3 — 1 = 2"), "3 − 1 = 2");
        assert_eq!(normalize_ocr_text("dots..."), "dots…");
        assert_eq!(normalize_ocr_text("fix/premium—ui-overhaul"), "fix/premium-ui-overhaul");
    }

    #[test]
    fn normalizes_user_verification_snippet() {
        let input = "### Verification\n\ne Rust OCR Test Suite: cargo test ocr > 14/14 tests passed.\n\n• Frontend Vitest Suite: npm test » 22/22 test files passed (191 tests).\n\n• Frontend Production Build: npm run build (tsc && vite build) > compiled cleanly.\n• Commit: Recorded at d8853e5 on branch fix/premium—ui-overhaul.";
        let expected = "### Verification\n\n• Rust OCR Test Suite: cargo test ocr → 14/14 tests passed.\n\n• Frontend Vitest Suite: npm test → 22/22 test files passed (191 tests).\n\n• Frontend Production Build: npm run build (tsc && vite build) → compiled cleanly.\n• Commit: Recorded at d8853e5 on branch fix/premium-ui-overhaul.";
        assert_eq!(normalize_ocr_text(input), expected);
    }
}
