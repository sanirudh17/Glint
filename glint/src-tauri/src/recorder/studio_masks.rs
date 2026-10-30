//! Privacy masks mutate decoded source pixels before crop/zoom/resampling.
use super::studio_render::{blur_shadow, color};
use image::{GrayImage, Luma};
use serde::Deserialize;
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Keyframe {
    pub t: f64,
    #[serde(flatten)]
    pub rect: Rect,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Mask {
    pub id: String,
    pub start: f64,
    pub end: f64,
    #[serde(rename = "type")]
    pub kind: String,
    pub keyframes: Vec<Keyframe>,
    pub strength: f64,
    pub color: String,
    #[serde(default)]
    pub opacity: Option<f64>,
    #[serde(default, rename = "blurOutside")]
    pub blur_outside: bool,
}
pub fn validate(masks: &[Mask], duration: f64, width: f64, height: f64) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if masks.len() > 512 {
        return Err("Too many masks".into());
    }
    for m in masks {
        if !ids.insert(&m.id)
            || m.id.is_empty()
            || [m.start, m.end, m.strength].iter().any(|v| !v.is_finite())
            || m.start < 0.
            || m.end <= m.start
            || m.end > duration + 0.05
            || !(8.0..=80.0).contains(&m.strength)
            || !matches!(m.kind.as_str(), "blur" | "pixelate" | "solid" | "highlight")
            || m.opacity.is_some_and(|value| !(0.0..=1.0).contains(&value))
            || m.keyframes.is_empty()
            || m.keyframes.len() > 512
        {
            return Err("Invalid mask".into());
        }
        color(&m.color)?;
        let mut times = Vec::new();
        for p in &m.keyframes {
            let r = p.rect;
            if [p.t, r.x, r.y, r.w, r.h].iter().any(|v| !v.is_finite())
                || p.t < 0.
                || p.t > duration + 0.05
                || r.x < 0.
                || r.y < 0.
                || r.w < 2.
                || r.h < 2.
                || r.x + r.w > width + 0.01
                || r.y + r.h > height + 0.01
                || times.contains(&p.t)
            {
                return Err("Mask is outside the source video".into());
            }
            times.push(p.t);
        }
    }
    Ok(())
}
pub fn rect_at(mask: &Mask, t: f64) -> Rect {
    let mut points: Vec<_> = mask.keyframes.iter().collect();
    points.sort_by(|a, b| a.t.total_cmp(&b.t));
    let index = points.partition_point(|p| p.t <= t);
    let a = points[index.saturating_sub(1)];
    let b = points[index.min(points.len() - 1)];
    let f = if b.t > a.t {
        ((t - a.t) / (b.t - a.t)).clamp(0., 1.)
    } else {
        0.
    };
    Rect {
        x: a.rect.x + (b.rect.x - a.rect.x) * f,
        y: a.rect.y + (b.rect.y - a.rect.y) * f,
        w: a.rect.w + (b.rect.w - a.rect.w) * f,
        h: a.rect.h + (b.rect.h - a.rect.h) * f,
    }
}
pub fn apply(raw: &mut [u8], width: u32, height: u32, masks: &[Mask], t: f64) {
    let stride = width as usize * 3;
    for mask in masks
        .iter()
        .filter(|m| m.start <= t && t < m.end && m.kind != "highlight")
    {
        let r = rect_at(mask, t);
        let x = r.x.floor().max(0.) as usize;
        let y = r.y.floor().max(0.) as usize;
        let w = (r.w.ceil() as usize).min(width as usize - x);
        let h = (r.h.ceil() as usize).min(height as usize - y);
        match mask.kind.as_str() {
            "solid" => {
                let c = color(&mask.color).unwrap_or([22, 26, 32]);
                for row in y..y + h {
                    for col in x..x + w {
                        let i = row * stride + col * 3;
                        raw[i..i + 3].copy_from_slice(&c);
                    }
                }
            }
            "pixelate" => {
                let size = mask.strength.round() as usize;
                for by in (0..h).step_by(size) {
                    for bx in (0..w).step_by(size) {
                        let bh = size.min(h - by);
                        let bw = size.min(w - bx);
                        let mut sum = [0u32; 3];
                        for row in 0..bh {
                            for col in 0..bw {
                                let i = (y + by + row) * stride + (x + bx + col) * 3;
                                for c in 0..3 {
                                    sum[c] += raw[i + c] as u32;
                                }
                            }
                        }
                        let c = sum.map(|v| (v / (bw * bh) as u32) as u8);
                        for row in 0..bh {
                            for col in 0..bw {
                                let i = (y + by + row) * stride + (x + bx + col) * 3;
                                raw[i..i + 3].copy_from_slice(&c);
                            }
                        }
                    }
                }
            }
            _ => {
                for channel in 0..3 {
                    let gray = GrayImage::from_fn(w as u32, h as u32, |col, row| {
                        Luma([raw[(y + row as usize) * stride + (x + col as usize) * 3 + channel]])
                    });
                    let blurred = blur_shadow(gray, mask.strength / 2.);
                    for row in 0..h {
                        for col in 0..w {
                            raw[(y + row) * stride + (x + col) * 3 + channel] =
                                blurred.get_pixel(col as u32, row as u32)[0];
                        }
                    }
                }
            }
        }
    }
    for mask in masks
        .iter()
        .filter(|m| m.start <= t && t < m.end && m.kind == "highlight")
    {
        let r = rect_at(mask, t);
        let inside = |x: usize, y: usize| {
            x as f64 >= r.x && y as f64 >= r.y && (x as f64) < r.x + r.w && (y as f64) < r.y + r.h
        };
        if mask.blur_outside {
            for channel in 0..3 {
                let gray = GrayImage::from_fn(width, height, |x, y| {
                    Luma([raw[y as usize * stride + x as usize * 3 + channel]])
                });
                let blurred = blur_shadow(gray, mask.strength / 2.);
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        if !inside(x, y) {
                            raw[y * stride + x * 3 + channel] =
                                blurred.get_pixel(x as u32, y as u32)[0];
                        }
                    }
                }
            }
        }
        let factor = 1. - mask.opacity.unwrap_or(0.55);
        for y in 0..height as usize {
            for x in 0..width as usize {
                if !inside(x, y) {
                    let i = y * stride + x * 3;
                    for channel in 0..3 {
                        raw[i + channel] = (raw[i + channel] as f64 * factor).round() as u8;
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn mask(kind: &str) -> Mask {
        serde_json::from_value(serde_json::json!({"id":"privacy","start":0.,"end":3.,"type":kind,"keyframes":[{"t":0.,"x":10.,"y":10.,"w":40.,"h":20.}],"strength":12.,"color":"#123456"})).unwrap()
    }
    #[test]
    fn solid_rewrites_source_pixels_without_changing_neighbors() {
        let mut bytes = vec![255u8; 100 * 60 * 3];
        apply(&mut bytes, 100, 60, &[mask("solid")], 1.);
        assert_eq!(
            &bytes[(15 * 100 + 20) * 3..(15 * 100 + 20) * 3 + 3],
            &[18, 52, 86]
        );
        assert_eq!(&bytes[0..3], &[255, 255, 255]);
    }
    #[test]
    fn blur_and_pixelate_remove_fine_pixel_detail() {
        for kind in ["blur", "pixelate"] {
            let mut bytes: Vec<u8> = (0..60)
                .flat_map(|y| {
                    (0..100).flat_map(move |x| [if (x + y) % 2 == 0 { 255 } else { 0 }; 3])
                })
                .collect();
            apply(&mut bytes, 100, 60, &[mask(kind)], 1.);
            let pixel = bytes[(20 * 100 + 30) * 3];
            assert!((80..=180).contains(&pixel));
        }
    }
    #[test]
    fn highlight_never_restores_pixels_rewritten_by_privacy_masks() {
        let privacy = mask("solid");
        let mut focus = mask("solid");
        focus.id = "focus".into();
        focus.kind = "highlight".into();
        focus.opacity = Some(0.5);
        focus.blur_outside = true;
        focus.keyframes[0].rect = Rect {
            x: 15.,
            y: 12.,
            w: 20.,
            h: 14.,
        };
        let mut bytes = vec![255u8; 100 * 60 * 3];
        apply(&mut bytes, 100, 60, &[focus, privacy], 1.);
        assert_eq!(
            &bytes[(20 * 100 + 20) * 3..(20 * 100 + 20) * 3 + 3],
            &[18, 52, 86]
        );
        assert!(bytes[0] < 255);
    }
}
