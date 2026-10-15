//! Word geometry for privacy review and local indexing. Never logs recognized text.
use std::{
    io::Read,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub struct Word {
    pub text: String,
    pub line: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn parse_tsv(tsv: &str, sx: f64, sy: f64) -> Vec<Word> {
    tsv.lines()
        .skip(1)
        .filter_map(|line| {
            let c: Vec<_> = line.splitn(12, '\t').collect();
            if c.len() != 12 || c[0] != "5" || c[11].trim().is_empty() {
                return None;
            }
            let x = c[6].parse::<f64>().ok()? / sx;
            let y = c[7].parse::<f64>().ok()? / sy;
            let w = c[8].parse::<f64>().ok()? / sx;
            let h = c[9].parse::<f64>().ok()? / sy;
            if w <= 0. || h <= 0. || !x.is_finite() || !y.is_finite() {
                return None;
            }
            Some(Word {
                text: c[11].trim().into(),
                line: format!("{}:{}:{}:{}", c[1], c[2], c[3], c[4]),
                x,
                y,
                w,
                h,
            })
        })
        .collect()
}

pub fn text(words: &[Word]) -> String {
    let mut out = String::new();
    let mut line = "";
    for w in words {
        if !out.is_empty() {
            out.push(if line == w.line { ' ' } else { '\n' });
        }
        out.push_str(&w.text);
        line = &w.line;
    }
    out
}

pub fn recognize(rgba: &[u8], w: u32, h: u32, cancel: &AtomicBool) -> Result<Vec<Word>, String> {
    if w == 0 || h == 0 || rgba.len() != w as usize * h as usize * 4 {
        return Err("Couldn't read this image".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Cancelled".into());
    }
    let png = super::preprocess_to_png(rgba, w, h)?;
    let tess = super::resolve_tesseract().ok_or(super::TESS_MISSING)?;
    let path = std::env::temp_dir().join(format!(
        "glint-words-{}-{}.png",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    std::fs::write(&path, png).map_err(|_| "Couldn't prepare local text scan")?;
    let result = (|| {
        let mut cmd = std::process::Command::new(tess.exe);
        cmd.arg(&path)
            .arg("stdout")
            .args(["-l", "eng", "--oem", "1", "--psm", "6"]);
        if let Some(td) = tess.tessdata {
            cmd.arg("--tessdata-dir").arg(td);
        }
        // The lean bundle ships eng.traineddata without tessdata/configs/tsv.
        cmd.args(["-c", "tessedit_create_tsv=1"])
            .env("OMP_THREAD_LIMIT", "2")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = super::no_window(&mut cmd)
            .spawn()
            .map_err(|_| "Couldn't start local text scan")?;
        let mut stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let output = std::thread::spawn(move || {
            let mut bytes = vec![];
            stdout.read_to_end(&mut bytes).map(|_| bytes)
        });
        let errors = std::thread::spawn(move || {
            let mut bytes = vec![];
            let _ = stderr.read_to_end(&mut bytes);
        });
        let start = Instant::now();
        let mut stopped = None;
        let status = loop {
            if cancel.load(Ordering::Relaxed) || start.elapsed() > Duration::from_secs(45) {
                stopped = Some(if cancel.load(Ordering::Relaxed) {
                    "Cancelled"
                } else {
                    "Text scan timed out. Try a smaller image."
                });
                let _ = child.kill();
                break child.wait();
            }
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(e) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(e);
                }
            }
        };
        let bytes = output
            .join()
            .map_err(|_| "Couldn't read local text scan")?
            .map_err(|_| "Couldn't read local text scan")?;
        let _ = errors.join();
        if let Some(message) = stopped {
            return Err(message.to_string());
        }
        if !status
            .map_err(|_| "Couldn't finish local text scan")?
            .success()
        {
            return Err("Local text scan failed. Try a clearer image.".into());
        }
        if !bytes.starts_with(b"level\tpage_num") {
            return Err(
                "The local text engine did not return word positions. Try reopening Glint.".into(),
            );
        }
        let (rw, rh) = super::ocr_target_dims(w, h, super::OCR_MAX_DIM);
        Ok(parse_tsv(
            &String::from_utf8_lossy(&bytes),
            rw as f64 / w as f64,
            rh as f64 / h as f64,
        ))
    })();
    let _ = std::fs::remove_file(path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_upscaled_words_back_to_source_pixels() {
        let t="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t30\t60\t120\t42\t95\thello\n";
        let w = parse_tsv(t, 3., 3.);
        assert_eq!((w[0].x, w[0].y, w[0].w, w[0].h), (10., 20., 40., 14.));
        assert_eq!(text(&w), "hello");
    }
}
