//! Cached CPU composition and a bounded FFmpeg frame pipeline.
use super::{
    ffmpeg::{self, VideoEncoder},
    studio::Events,
    studio_cursor::{self, CursorConfig, Mapping, Point},
    trim::{self, CamOverlay, KeepSegment},
};
use font8x8::UnicodeFonts;
use image::{GrayImage, Luma, Rgb, RgbImage};
use serde::Deserialize;
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Border {
    pub width: f64,
    pub color: String,
    pub style: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub enabled: bool,
    pub background: Value,
    pub padding: f64,
    pub radius: f64,
    pub shadow: f64,
    pub aspect: String,
    pub chrome: Value,
    pub shadow_color: Option<String>,
    pub border: Option<Border>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Clip {
    pub start: f64,
    pub end: f64,
    pub speed: f64,
    pub kept: bool,
    pub order: f64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub look: Look,
    pub cursor: CursorConfig,
    pub crop: Option<Crop>,
    pub clips: Vec<Clip>,
    pub fade_in: f64,
    pub fade_out: f64,
    pub cam: Option<Value>,
}
impl Project {
    pub fn segments(&self, duration: f64) -> Result<Vec<KeepSegment>, String> {
        if self.version != 1 {
            return Err("Unsupported Studio project version".into());
        }
        self.cursor.validate()?;
        for n in [self.look.padding, self.look.radius, self.look.shadow] {
            if !(0.0..=100.0).contains(&n) {
                return Err("Invalid look settings".into());
            }
        }
        if !matches!(
            self.look.aspect.as_str(),
            "auto" | "1:1" | "16:9" | "4:3" | "9:16" | "4:5"
        ) {
            return Err("Invalid aspect".into());
        }
        if !matches!(
            self.look.background["type"].as_str(),
            Some("solid" | "gradient" | "image" | "transparent")
        ) {
            return Err("Invalid background".into());
        }
        if !(0.0..=2.0).contains(&self.fade_in) || !(0.0..=2.0).contains(&self.fade_out) {
            return Err("Invalid fades".into());
        }
        if let Some(border) = self.look.border.as_ref() {
            if !(0.0..=16.0).contains(&border.width)
                || !matches!(border.style.as_str(), "solid" | "dashed")
            {
                return Err("Invalid border".into());
            }
        }
        let mut clips: Vec<_> = self.clips.iter().filter(|c| c.kept).collect();
        clips.sort_by(|a, b| a.order.total_cmp(&b.order));
        trim::validate_segments(
            &clips
                .into_iter()
                .map(|c| KeepSegment {
                    start: c.start,
                    end: c.end,
                    speed: c.speed,
                })
                .collect::<Vec<_>>(),
            duration,
        )
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Layout {
    pub width: u32,
    pub height: u32,
    pub content_w: u32,
    pub content_h: u32,
    pub x: u32,
    pub y: u32,
    pub chrome_h: u32,
    pub crop: Crop,
    pub scale: f64,
    pub radius: f64,
}
pub fn layout(w: u32, h: u32, crop: Option<Crop>, look: &Look) -> Result<Layout, String> {
    let c = crop.unwrap_or(Crop {
        x: 0.,
        y: 0.,
        w: w as f64,
        h: h as f64,
    });
    if [c.x, c.y, c.w, c.h].iter().any(|v| !v.is_finite())
        || c.x < 0.
        || c.y < 0.
        || c.w < 2.
        || c.h < 2.
        || c.x + c.w > w as f64 + 0.01
        || c.y + c.h > h as f64 + 0.01
    {
        return Err("Crop is outside the source video".into());
    }
    let chrome = if look.enabled && look.chrome["style"].as_str().unwrap_or("none") != "none" {
        (c.w * 0.045).round().clamp(28., 120.)
    } else {
        0.
    };
    let pad = if look.enabled {
        (look.padding / 100. * 0.25 * c.w.max(c.h)).round()
    } else {
        0.
    };
    let (mut cw, mut ch) = (c.w + 2. * pad, c.h + chrome + 2. * pad);
    let ratio = if look.enabled {
        match look.aspect.as_str() {
            "1:1" => Some(1.),
            "16:9" => Some(16. / 9.),
            "4:3" => Some(4. / 3.),
            "9:16" => Some(9. / 16.),
            "4:5" => Some(4. / 5.),
            _ => None,
        }
    } else {
        None
    };
    if let Some(r) = ratio {
        if cw / ch < r {
            cw = (ch * r).round();
        } else {
            ch = (cw / r).round();
        }
    }
    let scale = (1920. / cw.max(ch)).min(1.);
    let even = |v: f64| ((v * scale / 2.).round() as u32 * 2).max(2);
    let x = ((cw - c.w) / 2.).round();
    let y = ((ch - chrome - c.h) / 2.).round() + chrome;
    Ok(Layout {
        width: even(cw),
        height: even(ch),
        content_w: (c.w * scale).round().max(2.) as u32,
        content_h: (c.h * scale).round().max(2.) as u32,
        x: (x * scale).round() as u32,
        y: (y * scale).round() as u32,
        chrome_h: (chrome * scale).round() as u32,
        crop: c,
        scale,
        radius: if look.enabled {
            look.radius / 100. * 0.5 * c.w.min(c.h) * scale
        } else {
            0.
        },
    })
}
fn color(s: &str) -> Result<[u8; 3], String> {
    let s = s.strip_prefix('#').unwrap_or(s);
    if s.len() != 6 || !s.is_ascii() {
        return Err("Use a six-digit hex color".into());
    }
    Ok([
        u8::from_str_radix(&s[0..2], 16).map_err(|_| "Invalid color")?,
        u8::from_str_radix(&s[2..4], 16).map_err(|_| "Invalid color")?,
        u8::from_str_radix(&s[4..6], 16).map_err(|_| "Invalid color")?,
    ])
}
fn sdf(x: f64, y: f64, w: f64, h: f64, r: f64) -> f64 {
    let qx = (x - w / 2.).abs() - (w / 2. - r);
    let qy = (y - h / 2.).abs() - (h / 2. - r);
    qx.max(0.).hypot(qy.max(0.)) + qx.max(qy).min(0.) - r
}
// Distance clockwise along the rounded outline, matching a canvas [8, 6] dash.
fn outline_distance(x: f64, y: f64, w: f64, h: f64, r: f64) -> f64 {
    let horizontal = w - 2. * r;
    let vertical = h - 2. * r;
    let arc = std::f64::consts::FRAC_PI_2 * r;
    if r > 0. {
        if x > w - r && y < r {
            return horizontal + ((y - r).atan2(x - w + r) + std::f64::consts::FRAC_PI_2) * r;
        }
        if x > w - r && y > h - r {
            return horizontal + arc + vertical + (y - h + r).atan2(x - w + r) * r;
        }
        if x < r && y > h - r {
            return 2. * horizontal
                + 2. * arc
                + vertical
                + ((y - h + r).atan2(x - r) - std::f64::consts::FRAC_PI_2) * r;
        }
        if x < r && y < r {
            return 2. * horizontal
                + 3. * arc
                + 2. * vertical
                + ((y - r).atan2(x - r) + std::f64::consts::PI) * r;
        }
    }
    let sides = [
        (y.abs(), 0),
        ((w - x).abs(), 1),
        ((h - y).abs(), 2),
        (x.abs(), 3),
    ];
    match sides.iter().min_by(|a, b| a.0.total_cmp(&b.0)).unwrap().1 {
        0 => x - r,
        1 => horizontal + arc + y - r,
        2 => horizontal + 2. * arc + vertical + w - r - x,
        _ => 2. * horizontal + 3. * arc + vertical + h - r - y,
    }
}
// Three separable box passes approximate a Gaussian without a radius-sized
// convolution at every pixel. This is cached once, independent of clip length.
fn blur_shadow(mask: GrayImage, sigma: f64) -> GrayImage {
    let (w, h) = (mask.width() as usize, mask.height() as usize);
    let ideal = (4. * sigma * sigma + 1.).sqrt();
    let lower = (ideal.floor() as usize).max(1) | 1;
    let lower = if lower as f64 > ideal {
        lower.saturating_sub(2).max(1)
    } else {
        lower
    };
    let upper = lower + 2;
    let count = ((12. * sigma * sigma - 3. * (lower * lower) as f64 - 12. * lower as f64 - 9.)
        / (-4. * lower as f64 - 4.))
        .round()
        .clamp(0., 3.) as usize;
    let mut pixels: Vec<f32> = mask.into_raw().into_iter().map(|n| n as f32).collect();
    let mut temporary = vec![0f32; pixels.len()];
    for pass in 0..3 {
        let radius = (if pass < count { lower } else { upper }) / 2;
        if radius == 0 {
            continue;
        }
        let divisor = (radius * 2 + 1) as f32;
        for y in 0..h {
            let row = y * w;
            let mut sum = pixels[row] * radius as f32;
            for x in 0..=radius {
                sum += pixels[row + x.min(w - 1)];
            }
            for x in 0..w {
                temporary[row + x] = sum / divisor;
                sum += pixels[row + (x + radius + 1).min(w - 1)]
                    - pixels[row + x.saturating_sub(radius)];
            }
        }
        for x in 0..w {
            let mut sum = temporary[x] * radius as f32;
            for y in 0..=radius {
                sum += temporary[y.min(h - 1) * w + x];
            }
            for y in 0..h {
                pixels[y * w + x] = sum / divisor;
                sum += temporary[(y + radius + 1).min(h - 1) * w + x]
                    - temporary[y.saturating_sub(radius) * w + x];
            }
        }
    }
    GrayImage::from_raw(
        w as u32,
        h as u32,
        pixels
            .into_iter()
            .map(|n| n.round().clamp(0., 255.) as u8)
            .collect(),
    )
    .unwrap()
}
fn blend(image: &mut RgbImage, x: i32, y: i32, c: [u8; 3], alpha: f64) {
    if x < 0 || y < 0 || x >= image.width() as i32 || y >= image.height() as i32 {
        return;
    }
    let p = image.get_pixel_mut(x as u32, y as u32);
    for i in 0..3 {
        p[i] = (p[i] as f64 * (1. - alpha) + c[i] as f64 * alpha).round() as u8;
    }
}
fn text(image: &mut RgbImage, label: &str, x: i32, y: i32, scale: u32, c: [u8; 3]) {
    for (i, ch) in label.chars().take(120).enumerate() {
        if let Some(glyph) = font8x8::BASIC_FONTS.get(ch) {
            for (row, bits) in glyph.iter().enumerate() {
                for col in 0..8 {
                    if bits & (1 << col) != 0 {
                        for oy in 0..scale {
                            for ox in 0..scale {
                                blend(
                                    image,
                                    x + i as i32 * 8 * scale as i32
                                        + col * scale as i32
                                        + ox as i32,
                                    y + row as i32 * scale as i32 + oy as i32,
                                    c,
                                    1.,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Gradient {
    id: String,
    angle_deg: f64,
    stops: Vec<Stop>,
}
#[derive(Deserialize)]
struct Stop {
    offset: f64,
    color: String,
}
pub struct Renderer {
    pub layout: Layout,
    plate: RgbImage,
    spans: Vec<(u32, u32)>,
    border: Vec<(u32, u32, [u8; 3])>,
    path: Vec<Point>,
    effects: Events,
    mapping: Mapping,
    cursor: CursorConfig,
}
impl Renderer {
    pub fn new(
        project: &Project,
        events: &Events,
        source_w: u32,
        source_h: u32,
    ) -> Result<Self, String> {
        if events.version != 1 || events.geometry.width == 0 || events.geometry.height == 0 {
            return Err("Invalid event geometry".into());
        }
        let l = layout(source_w, source_h, project.crop, &project.look)?;
        let look = &project.look;
        let mut plate = RgbImage::new(l.width, l.height);
        if look.enabled {
            match look.background["type"].as_str().unwrap_or("transparent") {
                "solid" => {
                    let c = color(
                        look.background["color"]
                            .as_str()
                            .ok_or("Missing background color")?,
                    )?;
                    plate.pixels_mut().for_each(|p| *p = Rgb(c));
                }
                "gradient" => {
                    let gradients: Vec<Gradient> =
                        serde_json::from_str(include_str!("../../../src/look/gradients.json"))
                            .map_err(|e| e.to_string())?;
                    let g = gradients
                        .iter()
                        .find(|g| Some(g.id.as_str()) == look.background["gradientId"].as_str())
                        .unwrap_or(&gradients[0]);
                    let stops: Vec<_> = g
                        .stops
                        .iter()
                        .map(|s| Ok((s.offset, color(&s.color)?)))
                        .collect::<Result<_, String>>()?;
                    let dx = g.angle_deg.to_radians().cos();
                    let dy = g.angle_deg.to_radians().sin();
                    let len = dx.abs() * l.width as f64 + dy.abs() * l.height as f64;
                    for (x, y, p) in plate.enumerate_pixels_mut() {
                        let t = (((x as f64 - l.width as f64 / 2.) * dx
                            + (y as f64 - l.height as f64 / 2.) * dy)
                            / len
                            + 0.5)
                            .clamp(0., 1.);
                        let a = stops.iter().rev().find(|s| s.0 <= t).unwrap_or(&stops[0]);
                        let b = stops
                            .iter()
                            .find(|s| s.0 >= t)
                            .unwrap_or(stops.last().unwrap());
                        let f = if b.0 > a.0 {
                            (t - a.0) / (b.0 - a.0)
                        } else {
                            0.
                        };
                        for i in 0..3 {
                            p[i] =
                                (a.1[i] as f64 + (b.1[i] as f64 - a.1[i] as f64) * f).round() as u8;
                        }
                    }
                }
                "image" => {
                    use base64::Engine;
                    let url = look.background["dataUrl"]
                        .as_str()
                        .ok_or("Missing background image")?;
                    let (_, bytes) = url
                        .split_once(",")
                        .ok_or("Choose a background image before exporting")?;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(bytes)
                        .map_err(|e| e.to_string())?;
                    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
                        .with_guessed_format()
                        .map_err(|e| e.to_string())?;
                    let mut limits = image::Limits::default();
                    limits.max_image_width = Some(16000);
                    limits.max_image_height = Some(16000);
                    reader.limits(limits);
                    let rgba = reader.decode().map_err(|e| e.to_string())?.to_rgba8();
                    // Premultiply over MP4 black before resizing. Transparent RGB
                    // must not bleed into visible pixels during interpolation.
                    let img = RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
                        let pixel = rgba.get_pixel(x, y);
                        let alpha = pixel[3] as f64 / 255.;
                        Rgb([0, 1, 2].map(|i| (pixel[i] as f64 * alpha).round() as u8))
                    });
                    let scale = (l.width as f64 / img.width() as f64)
                        .max(l.height as f64 / img.height() as f64);
                    let img = image::imageops::resize(
                        &img,
                        (img.width() as f64 * scale).ceil() as u32,
                        (img.height() as f64 * scale).ceil() as u32,
                        image::imageops::FilterType::Triangle,
                    );
                    for (x, y, p) in plate.enumerate_pixels_mut() {
                        *p = *img.get_pixel(x, y);
                    }
                }
                _ => {}
            }
        }
        let top = l.y - l.chrome_h;
        let card_h = l.content_h + l.chrome_h;
        if look.enabled && look.shadow > 0. {
            let edge = l.content_w.max(l.content_h) as f64;
            let t = look.shadow / 100.;
            let sigma = (0.02 + t * 0.1) * edge / 2.;
            let offset = (0.01 + t * 0.05) * edge;
            let opacity = 0.2 + t * 0.5;
            let c = color(look.shadow_color.as_deref().unwrap_or("#000000"))?;
            // Blur the card's alpha mask, as Canvas does in the preview. A distance
            // falloff made exported shadows much darker and broader at the edge.
            let halo = (sigma * 3. + offset.abs()).ceil() as u32 + 1;
            let mut mask = GrayImage::new(l.width + halo * 2, l.height + halo * 2);
            for (x, y, pixel) in mask.enumerate_pixels_mut() {
                let distance = sdf(
                    x as f64 - halo as f64 - l.x as f64,
                    y as f64 - halo as f64 - top as f64 - offset,
                    l.content_w as f64,
                    card_h as f64,
                    l.radius,
                );
                *pixel = Luma([((0.5 - distance).clamp(0., 1.) * 255.).round() as u8]);
            }
            let mask = blur_shadow(mask, sigma);
            for y in 0..l.height {
                for x in 0..l.width {
                    let alpha = opacity * mask.get_pixel(x + halo, y + halo)[0] as f64 / 255.;
                    blend(&mut plate, x as i32, y as i32, c, alpha);
                }
            }
        }
        if l.chrome_h > 0 {
            let dark = look.chrome["theme"] == "dark";
            let c = if dark { [37, 39, 44] } else { [238, 238, 238] };
            for y in top..l.y {
                for x in l.x..l.x + l.content_w {
                    if sdf(
                        (x - l.x) as f64,
                        (y - top) as f64,
                        l.content_w as f64,
                        card_h as f64,
                        l.radius,
                    ) <= 0.
                    {
                        plate.put_pixel(x, y, Rgb(c));
                    }
                }
            }
            let label = if look.chrome["style"] == "browser" {
                look.chrome["url"].as_str()
            } else {
                look.chrome["title"].as_str()
            }
            .unwrap_or("");
            let font = (l.chrome_h / 24).max(1);
            let tx = l.x as i32
                + (l.content_w as i32 - label.chars().count() as i32 * 8 * font as i32) / 2;
            text(
                &mut plate,
                label,
                tx,
                top as i32 + (l.chrome_h / 3) as i32,
                font,
                if dark { [255, 255, 255] } else { [32, 32, 32] },
            );
        }
        let spans = (0..l.content_h)
            .map(|y| {
                let mut left = 0;
                while left < l.content_w
                    && sdf(
                        left as f64,
                        (y + l.chrome_h) as f64,
                        l.content_w as f64,
                        card_h as f64,
                        l.radius,
                    ) > 0.
                {
                    left += 1;
                }
                let mut right = l.content_w;
                while right > left
                    && sdf(
                        (right - 1) as f64,
                        (y + l.chrome_h) as f64,
                        l.content_w as f64,
                        card_h as f64,
                        l.radius,
                    ) > 0.
                {
                    right -= 1;
                }
                (left, right)
            })
            .collect();
        let mut border = Vec::new();
        if let Some(b) = look
            .border
            .as_ref()
            .filter(|b| look.enabled && b.width > 0.)
        {
            let c = color(&b.color)?;
            let half_width = b.width * l.scale / 2.;
            let left = (l.x as f64 - half_width).floor().max(0.) as u32;
            let upper = (top as f64 - half_width).floor().max(0.) as u32;
            let right = (l.x as f64 + l.content_w as f64 + half_width)
                .ceil()
                .min(l.width as f64) as u32;
            let bottom = (top as f64 + card_h as f64 + half_width)
                .ceil()
                .min(l.height as f64) as u32;
            for y in upper..bottom {
                for x in left..right {
                    let px = x as f64 - l.x as f64;
                    let py = y as f64 - top as f64;
                    let d = sdf(px, py, l.content_w as f64, card_h as f64, l.radius);
                    let distance =
                        outline_distance(px, py, l.content_w as f64, card_h as f64, l.radius)
                            / l.scale;
                    if d.abs() <= half_width
                        && (b.style != "dashed" || distance.rem_euclid(14.) < 8.)
                    {
                        border.push((x, y, c));
                    }
                }
            }
        }
        let mapping = Mapping {
            source_w: source_w as f64,
            source_h: source_h as f64,
            crop_x: l.crop.x,
            crop_y: l.crop.y,
            x: l.x as f64,
            y: l.y as f64,
            w: l.content_w as f64,
            h: l.content_h as f64,
            scale: l.scale,
        };
        let mut effects = events.clone();
        effects.events.retain(|e| e.data["kind"] != "cursor");
        effects.events.sort_by(|a, b| a.t.total_cmp(&b.t));
        Ok(Self {
            layout: l,
            plate,
            spans,
            border,
            path: studio_cursor::smooth_path(events, project.cursor.smoothing),
            effects,
            mapping,
            cursor: project.cursor.clone(),
        })
    }
    fn allowed(&self, x: i32, y: i32) -> bool {
        let l = self.layout;
        if x < l.x as i32
            || y < l.y as i32
            || x >= (l.x + l.content_w) as i32
            || y >= (l.y + l.content_h) as i32
        {
            return false;
        }
        let (a, b) = self.spans[(y - l.y as i32) as usize];
        x >= l.x as i32 + a as i32 && x < l.x as i32 + b as i32
    }
    pub fn frame(&self, raw: &[u8], t: f64, out: &mut RgbImage) {
        out.as_mut().copy_from_slice(self.plate.as_raw());
        let l = self.layout;
        for (y, (a, b)) in self.spans.iter().copied().enumerate() {
            let src = (y * l.content_w as usize + a as usize) * 3;
            let dst = ((y + l.y as usize) * l.width as usize + l.x as usize + a as usize) * 3;
            let n = (b - a) as usize * 3;
            out.as_mut()[dst..dst + n].copy_from_slice(&raw[src..src + n]);
        }
        let m = self.mapping;
        let c = &self.cursor;
        if let Some(p) = studio_cursor::point_at(&self.path, t)
            .filter(|p| c.visible && (!c.hide_idle || t - p.moved_at < c.idle_seconds))
        {
            let (x, y) = m.point(p.x, p.y, &self.effects);
            let size = c.size * l.scale;
            if m.inside(x, y) {
                let polygon = [
                    (0., 0.),
                    (0., 1.),
                    (0.24, 0.74),
                    (0.42, 1.08),
                    (0.6, 0.98),
                    (0.4, 0.65),
                    (0.76, 0.65),
                ];
                let inside = |px: f64, py: f64| {
                    if c.style == "dot" {
                        px.hypot(py) < size / 4.
                    } else {
                        let mut yes = false;
                        for i in 0..polygon.len() {
                            let a = polygon[i];
                            let b = polygon[(i + 1) % polygon.len()];
                            let (ax, ay, bx, by) = (a.0 * size, a.1 * size, b.0 * size, b.1 * size);
                            if (ay > py) != (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax
                            {
                                yes = !yes;
                            }
                        }
                        yes
                    }
                };
                for oy in -size.ceil() as i32..(size * 1.1).ceil() as i32 {
                    for ox in -size.ceil() as i32..size.ceil() as i32 {
                        if inside(ox as f64, oy as f64) {
                            let px = x.round() as i32 + ox;
                            let py = y.round() as i32 + oy;
                            if self.allowed(px, py) {
                                let edge = [(-1., 0.), (1., 0.), (0., -1.), (0., 1.)].iter().any(
                                    |(dx, dy)| !inside(ox as f64 + dx * 2., oy as f64 + dy * 2.),
                                );
                                blend(
                                    out,
                                    px,
                                    py,
                                    if edge { [23, 26, 32] } else { [255, 255, 255] },
                                    1.,
                                );
                            }
                        }
                    }
                }
            }
        }
        let recent_start = self.effects.events.partition_point(|e| e.t < t - 0.9);
        let recent_end = self.effects.events.partition_point(|e| e.t <= t);
        let recent = &self.effects.events[recent_start..recent_end];
        if c.clicks {
            for e in recent
                .iter()
                .filter(|e| e.data["kind"] == "click" && t - e.t <= 0.45)
            {
                if let (Some(ex), Some(ey)) = (e.data["x"].as_f64(), e.data["y"].as_f64()) {
                    let (x, y) = m.point(ex, ey, &self.effects);
                    let age = t - e.t;
                    let r = c.click_size * l.scale * (0.3 + age / 0.45 * 0.7);
                    let rgb = if e.data["button"] == "right" {
                        [255, 182, 96]
                    } else {
                        [79, 174, 255]
                    };
                    for oy in -r.ceil() as i32 - 2..=r.ceil() as i32 + 2 {
                        for ox in -r.ceil() as i32 - 2..=r.ceil() as i32 + 2 {
                            if ((ox as f64).hypot(oy as f64) - r).abs() < 1.5 * l.scale {
                                let px = x.round() as i32 + ox;
                                let py = y.round() as i32 + oy;
                                if self.allowed(px, py) {
                                    blend(out, px, py, rgb, 1. - age / 0.45);
                                }
                            }
                        }
                    }
                }
            }
        }
        if c.keystrokes {
            if let Some(e) = recent.iter().rev().find(|e| {
                e.data["kind"] == "key" && e.data["down"] == true && e.data["isModifier"] != true
            }) {
                let mut labels: Vec<&str> = e.data["modifiers"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|s| s.as_str()).collect())
                    .unwrap_or_default();
                labels.push(e.data["text"].as_str().unwrap_or(""));
                let label = labels.join(" + ");
                let font = (3. * l.scale).round().max(1.) as u32;
                let bw = (label.chars().count() as u32 * 8 * font + 32)
                    .min(l.content_w.saturating_sub(16));
                let bx = l.x + (l.content_w - bw) / 2;
                let by = (l.y + l.content_h).saturating_sub((64. * l.scale) as u32);
                let bh = (42. * l.scale).round().max(12.) as u32;
                for y in by..by + bh {
                    for x in bx..bx + bw {
                        if self.allowed(x as i32, y as i32) {
                            blend(out, x as i32, y as i32, [23, 26, 32], 1.);
                        }
                    }
                }
                text(
                    out,
                    &label,
                    bx as i32 + 8,
                    by as i32 + ((bh - 8 * font) / 2) as i32,
                    font,
                    [255, 255, 255],
                );
            }
        }
        for (x, y, c) in &self.border {
            out.put_pixel(*x, *y, Rgb(*c));
        }
    }
}
pub fn source_time(segments: &[KeepSegment], t: f64) -> f64 {
    let mut elapsed = 0.;
    for s in segments {
        let duration = (s.end - s.start) / s.speed;
        if t < elapsed + duration {
            return s.start + (t - elapsed).max(0.) * s.speed;
        }
        elapsed += duration;
    }
    segments.last().map(|s| s.end).unwrap_or(0.)
}
fn command(binary: &Path) -> Command {
    let mut cmd = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}
type Process = Arc<Mutex<Child>>;
struct Children {
    processes: Vec<Process>,
    done: Arc<AtomicBool>,
    watch: Option<std::thread::JoinHandle<()>>,
}
impl Children {
    fn new() -> Self {
        Self {
            processes: Vec::new(),
            done: Arc::new(AtomicBool::new(false)),
            watch: None,
        }
    }
    fn push(&mut self, child: Child) -> Process {
        let p = Arc::new(Mutex::new(child));
        self.processes.push(p.clone());
        p
    }
    fn watch(&mut self, cancel: Arc<AtomicBool>) {
        let children = self.processes.clone();
        let done = self.done.clone();
        self.watch = Some(std::thread::spawn(move || {
            while !done.load(Ordering::Relaxed) {
                if cancel.load(Ordering::Relaxed) {
                    for p in &children {
                        let _ = p.lock().unwrap().kill();
                    }
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }));
    }
}
impl Drop for Children {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Relaxed);
        for p in &self.processes {
            let mut c = p.lock().unwrap();
            if c.try_wait().ok().flatten().is_none() {
                let _ = c.kill();
            }
            let _ = c.wait();
        }
        if let Some(t) = self.watch.take() {
            let _ = t.join();
        }
    }
}
fn stderr(child: &mut Child) -> std::thread::JoinHandle<String> {
    let mut pipe = child.stderr.take().unwrap();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.by_ref().take(16384).read_to_end(&mut bytes);
        let _ = std::io::copy(&mut pipe, &mut std::io::sink());
        String::from_utf8_lossy(&bytes).into_owned()
    })
}
fn wait(p: &Process) -> Result<bool, String> {
    loop {
        if let Some(status) = p.lock().unwrap().try_wait().map_err(|e| e.to_string())? {
            return Ok(status.success());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
pub fn detect_encoder(binary: &Path, cancel: &AtomicBool) -> VideoEncoder {
    for encoder in [VideoEncoder::Nvenc, VideoEncoder::Qsv, VideoEncoder::Amf] {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let mut args: Vec<String> = [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=size=128x128:rate=30",
            "-frames:v",
            "3",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        args.extend(ffmpeg::encoder_args(encoder, "high"));
        args.extend(["-f".into(), "null".into(), "-".into()]);
        let Ok(mut child) = command(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() {
                        return encoder;
                    }
                    break;
                }
                Err(_) => break,
                _ => {}
            }
            if start.elapsed() > Duration::from_secs(5) || cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    VideoEncoder::Libx264
}
fn audio_graph(segments: &[KeepSegment], fade_in: f64, fade_out: f64) -> String {
    let mut graph = String::new();
    for (i, s) in segments.iter().enumerate() {
        graph.push_str(&format!(
            "[1:a]atrim={}:{},asetpts=PTS-STARTPTS,atempo={}[a{i}];",
            s.start, s.end, s.speed
        ));
    }
    for i in 0..segments.len() {
        graph.push_str(&format!("[a{i}]"));
    }
    graph.push_str(&format!(
        "concat=n={}:v=0:a=1,aresample=async=1:first_pts=0",
        segments.len()
    ));
    if fade_in > 0. {
        graph.push_str(&format!(",afade=t=in:st=0:d={fade_in}:curve=qsin"));
    }
    if fade_out > 0. {
        graph.push_str(&format!(
            ",afade=t=out:st={}:d={fade_out}:curve=qsin",
            (trim::output_duration(segments) - fade_out).max(0.)
        ));
    }
    graph.push_str("[outa]");
    graph
}
pub struct ExportSpec<'a> {
    pub binary: &'a Path,
    pub source: &'a str,
    pub output: &'a Path,
    pub project: &'a Project,
    pub events: &'a Events,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub audio: bool,
    pub cam: Option<&'a str>,
    pub cam_overlay: Option<CamOverlay>,
}
pub fn export(
    spec: &ExportSpec,
    cancel: Arc<AtomicBool>,
    progress: impl Fn(f64) + Sync,
) -> Result<VideoEncoder, String> {
    let chosen = detect_encoder(spec.binary, &cancel);
    match encode(spec, cancel.clone(), &progress, chosen) {
        Ok(()) => Ok(chosen),
        Err(e) if chosen != VideoEncoder::Libx264 && !cancel.load(Ordering::Relaxed) => {
            log::warn!("Studio hardware encode failed ({e}); retry x264");
            encode(spec, cancel, &progress, VideoEncoder::Libx264)?;
            Ok(VideoEncoder::Libx264)
        }
        Err(e) => Err(e),
    }
}
fn encode(
    spec: &ExportSpec,
    cancel: Arc<AtomicBool>,
    progress: &(impl Fn(f64) + Sync),
    encoder: VideoEncoder,
) -> Result<(), String> {
    let segments = spec.project.segments(spec.duration)?;
    let renderer = Renderer::new(spec.project, spec.events, spec.width, spec.height)?;
    let l = renderer.layout;
    let total = trim::output_duration(&segments);
    let fps = spec.fps.clamp(1., 120.);
    let mut args = trim::build_trim_args(
        spec.source,
        "-",
        &segments,
        false,
        spec.project.fade_in,
        spec.project.fade_out,
        spec.cam,
        spec.cam_overlay.clone(),
    );
    let tail = args.iter().position(|s| s == "-c:v").unwrap();
    args.truncate(tail);
    let progress_idx = args.iter().position(|s| s == "-progress").unwrap();
    args.drain(progress_idx..progress_idx + 2);
    let graph_idx = args.iter().position(|s| s == "-filter_complex").unwrap() + 1;
    args[graph_idx] = format!(
        "{};[edited]crop={}:{}:{}:{}:exact=1,scale={}:{},fps={},format=rgb24[outv]",
        args[graph_idx].replace("[outv]", "[edited]"),
        l.crop.w,
        l.crop.h,
        l.crop.x,
        l.crop.y,
        l.content_w,
        l.content_h,
        fps
    );
    args.extend([
        "-filter_complex_threads".into(),
        "2".into(),
        "-threads".into(),
        "2".into(),
        "-an".into(),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgb24".into(),
        "pipe:1".into(),
    ]);
    let mut children = Children::new();
    let mut decode = command(spec.binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut raw = decode.stdout.take().unwrap();
    let decode_errors = stderr(&mut decode);
    let decode = children.push(decode);
    let mut args: Vec<String> = [
        "-y",
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        &format!("{}x{}", l.width, l.height),
        "-framerate",
        &fps.to_string(),
        "-i",
        "pipe:0",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if spec.audio {
        args.extend([
            "-i".into(),
            spec.source.into(),
            "-filter_complex".into(),
            audio_graph(&segments, spec.project.fade_in, spec.project.fade_out),
            "-map".into(),
            "[outa]".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    }
    args.extend(["-map".into(), "0:v".into()]);
    args.extend(ffmpeg::encoder_args(encoder, "high"));
    args.extend([
        "-t".into(),
        total.to_string(),
        "-movflags".into(),
        "+faststart".into(),
        spec.output.to_string_lossy().to_string(),
    ]);
    let mut encode = command(spec.binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut output = encode.stdin.take().unwrap();
    let encode_errors = stderr(&mut encode);
    let encode = children.push(encode);
    children.watch(cancel.clone());
    let mut input = vec![0u8; l.content_w as usize * l.content_h as usize * 3];
    let mut frame = RgbImage::new(l.width, l.height);
    let mut n = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("Export cancelled".into());
        }
        match raw.read_exact(&mut input) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.to_string()),
        }
        renderer.frame(&input, source_time(&segments, n as f64 / fps), &mut frame);
        output
            .write_all(frame.as_raw())
            .map_err(|e| format!("Encoder stopped: {e}"))?;
        n += 1;
        if n % 15 == 0 {
            progress((n as f64 / fps / total * 100.).min(99.));
        }
    }
    drop(output);
    let decode_ok = wait(&decode)?;
    let encode_ok = wait(&encode)?;
    let de = decode_errors.join().unwrap_or_default();
    let ee = encode_errors.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled".into());
    }
    if !decode_ok || !encode_ok || n == 0 || n as f64 / fps < total - 2. / fps {
        return Err(format!("Export failed: {de} {ee}"));
    }
    progress(100.);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn background_fixture() -> (Project, Events) {
        let mut project: Project =
            serde_json::from_value(super::super::studio::initial_project(2.)).unwrap();
        project.look.shadow = 0.;
        project.look.radius = 0.;
        project.look.padding = 40.;
        project.cursor.visible = false;
        project.cursor.clicks = false;
        project.cursor.keystrokes = false;
        let events = serde_json::from_value(serde_json::json!({
            "version":1,"geometry":{"x":0,"y":0,"width":320,"height":200,"monitorX":0,"monitorY":0,"monitorWidth":320,"monitorHeight":200,"dpiScale":1.0},"events":[]
        })).unwrap();
        (project, events)
    }
    fn render_fixture(project: &Project, events: &Events) -> (Layout, RgbImage) {
        let renderer = Renderer::new(project, events, 320, 200).unwrap();
        let l = renderer.layout;
        let raw: Vec<u8> = [180, 80, 40]
            .into_iter()
            .cycle()
            .take(l.content_w as usize * l.content_h as usize * 3)
            .collect();
        let mut frame = RgbImage::new(l.width, l.height);
        renderer.frame(&raw, 0., &mut frame);
        (l, frame)
    }

    #[test]
    fn all_solid_colors_and_gradients_reach_the_export_pixels() {
        let (mut project, events) = background_fixture();
        for hex in [
            "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#a12b7c", "#0a0a0a",
        ] {
            project.look.background = serde_json::json!({"type":"solid","color":hex});
            let (_, frame) = render_fixture(&project, &events);
            assert_eq!(frame.get_pixel(0, 0).0, color(hex).unwrap());
        }
        let gradients: Vec<Gradient> =
            serde_json::from_str(include_str!("../../../src/look/gradients.json")).unwrap();
        for g in gradients {
            project.look.background = serde_json::json!({"type":"gradient","gradientId":g.id});
            let (l, frame) = render_fixture(&project, &events);
            for (x, y, stop) in [
                (l.width - 1, 0, &g.stops[0]),
                (0, l.height - 1, g.stops.last().unwrap()),
            ] {
                let expected = color(&stop.color).unwrap();
                for (actual, expected) in frame.get_pixel(x, y).0.into_iter().zip(expected) {
                    assert!(
                        (actual as i16 - expected as i16).abs() <= 2,
                        "gradient {} endpoint differs",
                        g.id
                    );
                }
            }
        }
    }

    #[test]
    fn transparent_and_alpha_images_flatten_over_mp4_black() {
        use base64::Engine;
        let (mut project, events) = background_fixture();
        project.look.background = serde_json::json!({"type":"transparent"});
        assert_eq!(
            render_fixture(&project, &events).1.get_pixel(0, 0).0,
            [0, 0, 0]
        );
        for (alpha, expected) in [(0, [0, 0, 0]), (128, [100, 50, 25]), (255, [200, 100, 50])] {
            let image = image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 100, 50, alpha]));
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            let data = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
            project.look.background = serde_json::json!({"type":"image","dataUrl":format!("data:image/png;base64,{data}")});
            assert_eq!(
                render_fixture(&project, &events).1.get_pixel(0, 0).0,
                expected
            );
        }
        let mut image = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 0, 0, 0]));
        image.put_pixel(1, 0, image::Rgba([0, 255, 0, 255]));
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
        project.look.background =
            serde_json::json!({"type":"image","dataUrl":format!("data:image/png;base64,{data}")});
        let (_, frame) = render_fixture(&project, &events);
        // Invisible red must never bleed into the scaled visible green edge.
        for x in 0..frame.width() {
            assert_eq!(frame.get_pixel(x, 0)[0], 0);
        }
    }

    #[test]
    fn shadow_blur_preserves_uniform_masks_and_spreads_an_impulse_symmetrically() {
        let uniform = blur_shadow(GrayImage::from_pixel(40, 40, Luma([255])), 5.);
        assert!(uniform.pixels().all(|p| p[0] == 255));
        let mut mask = GrayImage::new(41, 41);
        mask.put_pixel(20, 20, Luma([255]));
        let blurred = blur_shadow(mask, 2.);
        assert!(blurred.get_pixel(20, 20)[0] > 0 && blurred.get_pixel(20, 20)[0] < 255);
        for offset in 0..10 {
            assert_eq!(
                blurred.get_pixel(20 + offset, 20),
                blurred.get_pixel(20 - offset, 20)
            );
            assert_eq!(
                blurred.get_pixel(20 + offset, 20),
                blurred.get_pixel(20, 20 + offset)
            );
        }
        let total: u32 = blurred.pixels().map(|p| p[0] as u32).sum();
        assert!((200..=300).contains(&total));
    }

    #[test]
    fn radius_shadow_color_and_border_width_style_change_the_expected_pixels() {
        let (mut project, events) = background_fixture();
        project.look.background = serde_json::json!({"type":"solid","color":"#ffffff"});
        let (l, square) = render_fixture(&project, &events);
        assert_eq!(square.get_pixel(l.x + 1, l.y + 1).0, [180, 80, 40]);
        project.look.radius = 100.;
        assert_eq!(
            render_fixture(&project, &events)
                .1
                .get_pixel(l.x + 1, l.y + 1)
                .0,
            [255, 255, 255]
        );
        project.look.radius = 0.;
        project.look.shadow = 100.;
        project.look.shadow_color = Some("#0000ff".into());
        let (_, shadow) = render_fixture(&project, &events);
        let pixel = shadow
            .get_pixel(l.x + l.content_w / 2, l.y + l.content_h + 8)
            .0;
        assert!(pixel[0] < 255 && pixel[1] < 255 && pixel[2] == 255);
        project.look.shadow = 0.;
        project.look.border = Some(Border {
            width: 4.,
            color: "#00ff00".into(),
            style: "solid".into(),
        });
        let (_, bordered) = render_fixture(&project, &events);
        assert_eq!(bordered.get_pixel(l.x + 16, l.y - 1).0, [0, 255, 0]);
        assert_eq!(bordered.get_pixel(l.x + 16, l.y - 3).0, [255, 255, 255]);
        project.look.border.as_mut().unwrap().width = 16.;
        assert_eq!(
            render_fixture(&project, &events)
                .1
                .get_pixel(l.x + 16, l.y - 3)
                .0,
            [0, 255, 0]
        );
        project.look.border.as_mut().unwrap().style = "dashed".into();
        let (_, dashed) = render_fixture(&project, &events);
        assert_eq!(dashed.get_pixel(l.x + 2, l.y - 1).0, [0, 255, 0]);
        assert_eq!(dashed.get_pixel(l.x + 10, l.y - 1).0, [255, 255, 255]);
    }

    #[test]
    fn every_aspect_and_padding_extreme_stays_even_and_contains_the_content() {
        let (mut project, _) = background_fixture();
        for aspect in ["auto", "1:1", "16:9", "4:3", "9:16", "4:5"] {
            project.look.aspect = aspect.into();
            for padding in [0., 40., 100.] {
                project.look.padding = padding;
                let l = layout(1920, 1080, None, &project.look).unwrap();
                assert_eq!(l.width % 2, 0);
                assert_eq!(l.height % 2, 0);
                assert!(l.x + l.content_w <= l.width && l.y + l.content_h <= l.height);
                if aspect != "auto" {
                    let (w, h) = aspect.split_once(':').unwrap();
                    let ratio = w.parse::<f64>().unwrap() / h.parse::<f64>().unwrap();
                    assert!((l.width as f64 / l.height as f64 - ratio).abs() < 0.003);
                }
            }
        }
        assert!(layout(
            1920,
            1080,
            Some(Crop {
                x: 0.,
                y: 0.,
                w: 2000.,
                h: 1080.
            }),
            &project.look
        )
        .is_err());
    }
    #[test]
    fn timeline_time_follows_reorder_and_speed() {
        let s = [
            KeepSegment {
                start: 8.,
                end: 10.,
                speed: 0.5,
            },
            KeepSegment {
                start: 1.,
                end: 5.,
                speed: 2.,
            },
        ];
        assert_eq!(source_time(&s, 2.), 9.);
        assert_eq!(source_time(&s, 4.5), 2.);
    }
    #[test]
    fn portrait_layout_is_even_and_crop_remains_in_source() {
        let p: Project =
            serde_json::from_value(super::super::studio::initial_project(60.)).unwrap();
        let mut look = p.look;
        look.aspect = "9:16".into();
        let l = layout(
            1920,
            1080,
            Some(Crop {
                x: 100.,
                y: 50.,
                w: 800.,
                h: 600.,
            }),
            &look,
        )
        .unwrap();
        assert_eq!(l.height, 1708);
        assert_eq!(l.width, 960);
        assert_eq!(l.crop.x, 100.);
    }

    #[test]
    fn golden_frame_pixels_preserve_crop_cursor_and_click_toggles() {
        let mut p: Project =
            serde_json::from_value(super::super::studio::initial_project(2.)).unwrap();
        p.look.background = serde_json::json!({"type":"solid","color":"#102030"});
        p.look.shadow = 0.;
        p.crop = Some(Crop {
            x: 100.,
            y: 50.,
            w: 320.,
            h: 200.,
        });
        p.cursor.style = "dot".into();
        p.cursor.smoothing = 0.;
        p.cursor.hide_idle = false;
        p.cursor.clicks = false;
        let events: Events = serde_json::from_value(serde_json::json!({
            "version":1,"geometry":{"x":-640,"y":0,"width":1280,"height":800,"monitorX":-640,"monitorY":0,"monitorWidth":1280,"monitorHeight":800,"dpiScale":2.0},
            "events":[{"t":0.0,"kind":"cursor","x":-200,"y":300},{"t":0.0,"kind":"click","x":-200,"y":300,"button":"left"}]
        })).unwrap();
        let renderer = Renderer::new(&p, &events, 640, 400).unwrap();
        let l = renderer.layout;
        let raw: Vec<u8> = [180, 80, 40]
            .into_iter()
            .cycle()
            .take(l.content_w as usize * l.content_h as usize * 3)
            .collect();
        let mut frame = RgbImage::new(l.width, l.height);
        renderer.frame(&raw, 0.15, &mut frame);
        assert_eq!(frame.get_pixel(0, 0).0, [16, 32, 48]);
        assert_eq!(frame.get_pixel(32, 32).0, [16, 32, 48]);
        assert_eq!(frame.get_pixel(50, 50).0, [180, 80, 40]);
        assert_eq!(frame.get_pixel(152, 132).0, [255, 255, 255]);
        p.cursor.visible = false;
        Renderer::new(&p, &events, 640, 400)
            .unwrap()
            .frame(&raw, 0.15, &mut frame);
        assert_eq!(frame.get_pixel(152, 132).0, [180, 80, 40]);
        p.cursor.clicks = true;
        Renderer::new(&p, &events, 640, 400)
            .unwrap()
            .frame(&raw, 0.15, &mut frame);
        assert_eq!(frame.get_pixel(171, 132).0, [113, 143, 183]);
    }

    #[test]
    fn changing_smoothing_changes_the_rendered_cursor_during_movement() {
        let (mut project, mut events) = background_fixture();
        project.look.enabled = false;
        project.cursor.visible = true;
        project.cursor.hide_idle = false;
        project.cursor.style = "dot".into();
        events.events = serde_json::from_value(serde_json::json!([
            {"t":0.,"kind":"cursor","x":50.,"y":50.},
            {"t":0.1,"kind":"cursor","x":250.,"y":150.}
        ])).unwrap();
        project.cursor.smoothing = 0.;
        let renderer = Renderer::new(&project, &events, 320, 200).unwrap();
        let raw: Vec<u8> = [180, 80, 40].into_iter().cycle().take(320 * 200 * 3).collect();
        let mut direct = RgbImage::new(320, 200);
        renderer.frame(&raw, 0.1, &mut direct);
        project.cursor.smoothing = 1.;
        let mut smooth = RgbImage::new(320, 200);
        Renderer::new(&project, &events, 320, 200).unwrap().frame(&raw, 0.1, &mut smooth);
        assert_eq!(direct.get_pixel(250, 150).0, [255, 255, 255]);
        assert_eq!(smooth.get_pixel(250, 150).0, [180, 80, 40]);
        assert_eq!(smooth.get_pixel(129, 89).0, [255, 255, 255]);
    }
}
