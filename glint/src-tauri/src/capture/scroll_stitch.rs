//! Bounded manual-scroll stitching. No screen, window or filesystem dependencies.
//! An uncertain match never alters the accumulated image or the reference frame.
use image::RgbaImage;

pub const MAX_HEIGHT: u32 = 20_000;
pub const MAX_PIXELS: u64 = 24_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Unchanged,
    Appended(u32),
    Uncertain,
    Limit,
}

pub struct Stitcher {
    pub image: RgbaImage,
    previous: RgbaImage,
    pub strips: u32,
}

fn valid_size(w: u32, h: u32) -> bool {
    w >= 64 && h >= 128 && h <= MAX_HEIGHT && w as u64 * h as u64 <= MAX_PIXELS
}

// Ignore the outermost columns, including scrollbars and their moving thumbs.
fn row_error(a: &RgbaImage, ay: u32, b: &RgbaImage, by: u32) -> f64 {
    let mut error = 0u64;
    for col in 0..48 {
        let x = a.width() / 24 + col * (a.width() * 11 / 12 - 1) / 47;
        let p = a.get_pixel(x, ay);
        let q = b.get_pixel(x, by);
        for c in 0..3 {
            error += p[c].abs_diff(q[c]) as u64;
        }
    }
    error as f64 / 144.
}

fn row_detail(image: &RgbaImage, y: u32) -> bool {
    let (mut low, mut high) = (255, 0);
    for col in 0..48 {
        let x = image.width() / 24 + col * (image.width() * 11 / 12 - 1) / 47;
        let p = image.get_pixel(x, y);
        let luma = (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3;
        low = low.min(luma);
        high = high.max(luma);
    }
    high - low >= 20
}

pub fn same_frame(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.dimensions() != b.dimensions() {
        return false;
    }
    (0..48).all(|i| row_error(a, i * (a.height() - 1) / 47, b, i * (b.height() - 1) / 47) < 0.7)
}

/// A caret, clock or small hover animation must not keep a settled page waiting.
/// Substantial motion still needs to stop before we accept a strip.
pub fn settled_frame(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.dimensions() != b.dimensions() {
        return false;
    }
    if same_frame(a, b) {
        return true;
    }
    let (mut stable, mut error) = (0, 0.);
    for i in 0..48 {
        let e = row_error(a, i * (a.height() - 1) / 47, b, i * (b.height() - 1) / 47);
        if e < 1.5 {
            stable += 1;
        }
        error += e;
    }
    stable >= 44 && error / 48. < 3.
}

impl Stitcher {
    pub fn new(first: RgbaImage) -> Result<Self, String> {
        if !valid_size(first.width(), first.height()) {
            return Err(
                "Select a region at least 64 × 128 pixels, within the 24-megapixel capture limit."
                    .into(),
            );
        }
        Ok(Self {
            image: first.clone(),
            previous: first,
            strips: 1,
        })
    }

    pub fn push(&mut self, next: RgbaImage) -> Step {
        let prev = &self.previous;
        if prev.dimensions() != next.dimensions() {
            return Step::Uncertain;
        }
        if settled_frame(prev, &next) {
            return Step::Unchanged;
        }
        let h = prev.height();
        // Static headers/footers are identified in place, then excluded from the
        // displacement search. Limit their reach so whitespace cannot eat a page.
        let mut top = 0;
        while top < h / 4 && row_error(prev, top, &next, top) < 0.7 {
            top += 1;
        }
        let mut bottom = 0;
        while bottom < h / 4 && row_error(prev, h - 1 - bottom, &next, h - 1 - bottom) < 0.7 {
            bottom += 1;
        }
        let guard = (h / 32).max(4);
        let start = top.max(guard);
        let end = h - bottom.max(guard);
        let min_overlap = (h / 4).max(64);
        if end <= start + min_overlap {
            return Step::Uncertain;
        }
        let details: Vec<_> = (0..h).map(|y| row_detail(prev, y)).collect();
        let mut candidates = Vec::new();
        for shift in 1..end - start - min_overlap + 1 {
            let length = end - start - shift;
            let (mut sum, mut count, mut bad) = (0., 0, 0);
            for i in 0..48 {
                let y = start + i * (length - 1) / 47;
                if !details[(y + shift) as usize] {
                    continue;
                }
                let error = row_error(prev, y + shift, &next, y);
                sum += error;
                count += 1;
                if error > 8. {
                    bad += 1;
                }
            }
            if count >= 8 && bad * 5 <= count {
                candidates.push((sum / count as f64, shift));
            }
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        let Some(&(error, shift)) = candidates.first() else {
            return Step::Uncertain;
        };
        if error > 3.
            || candidates
                .iter()
                .any(|(e, d)| d.abs_diff(shift) > 2 && *e < error + 1.5)
        {
            return Step::Uncertain;
        }
        // Check the full overlap, not just anchors: reject substantial animation,
        // horizontal movement, lazy-load reflow or an unrelated window.
        let mut mismatch = 0;
        let rows = end - start - shift;
        for y in start..end - shift {
            if row_error(prev, y + shift, &next, y) > 8. {
                mismatch += 1;
            }
        }
        if mismatch * 20 > rows {
            return Step::Uncertain;
        }
        let Some(height) = self.image.height().checked_add(shift) else {
            return Step::Limit;
        };
        if !valid_size(self.image.width(), height) {
            return Step::Limit;
        }
        let row_bytes = self.image.width() as usize * 4;
        let cut = (self.image.height() - bottom) as usize * row_bytes;
        let new_start = (h - bottom - shift) as usize * row_bytes;
        let new_end = (h - bottom) as usize * row_bytes;
        let mut pixels = Vec::with_capacity(height as usize * row_bytes);
        pixels.extend_from_slice(&self.image.as_raw()[..cut]);
        pixels.extend_from_slice(&next.as_raw()[new_start..new_end]);
        pixels.extend_from_slice(&next.as_raw()[new_end..]);
        self.image = RgbaImage::from_raw(self.image.width(), height, pixels).unwrap();
        self.previous = next;
        self.strips += 1;
        Step::Appended(shift)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    fn page(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| {
            // Deterministic distinct text-like lines, including blank line gaps.
            let n = x.wrapping_mul(73856093) ^ y.wrapping_mul(19349663);
            let text = y % 27 < 14 && x > 12 && x < w - 12 && n % 11 < 5;
            Rgba(if text {
                [
                    (n % 180) as u8,
                    ((n >> 8) % 180) as u8,
                    ((n >> 16) % 180) as u8,
                    255,
                ]
            } else {
                [245, 245, 245, 255]
            })
        })
    }
    fn frame(page: &RgbaImage, offset: u32, header: u32, footer: u32) -> RgbaImage {
        let mut out = image::imageops::crop_imm(page, 0, offset, page.width(), 480).to_image();
        for (x, y, p) in out.enumerate_pixels_mut() {
            if y < header {
                *p = Rgba([(x % 160) as u8, 25, 60, 255]);
            }
            if y >= 480 - footer {
                *p = Rgba([20, (x % 150) as u8, 85, 255]);
            }
        }
        out
    }
    #[test]
    fn text_page_and_chat_stitch_exactly_with_sticky_bands() {
        let p = page(320, 3000);
        for (header, footer) in [(0, 0), (44, 0), (44, 32), (0, 32)] {
            let mut stitch = Stitcher::new(frame(&p, 0, header, footer)).unwrap();
            for (offset, delta) in [(137, 137), (318, 181), (509, 191), (720, 211), (960, 240)] {
                assert_eq!(
                    stitch.push(frame(&p, offset, header, footer)),
                    Step::Appended(delta)
                );
            }
            let mut expected = image::imageops::crop_imm(&p, 0, 0, 320, 1440).to_image();
            for (x, y, pixel) in expected.enumerate_pixels_mut() {
                if y < header {
                    *pixel = Rgba([(x % 160) as u8, 25, 60, 255]);
                }
                if y >= 1440 - footer {
                    *pixel = Rgba([20, (x % 150) as u8, 85, 255]);
                }
            }
            assert_eq!(stitch.image, expected);
            assert_eq!(stitch.strips, 6);
        }
    }
    #[test]
    fn uncertain_repeating_blank_reverse_and_overscroll_do_not_corrupt_output() {
        let p = page(320, 3000);
        let first = frame(&p, 300, 0, 0);
        let mut stitch = Stitcher::new(first.clone()).unwrap();
        assert_eq!(stitch.push(first.clone()), Step::Unchanged);
        for next in [
            frame(&p, 100, 0, 0),
            frame(&p, 1000, 0, 0),
            RgbaImage::from_pixel(320, 480, Rgba([255; 4])),
        ] {
            assert_eq!(stitch.push(next), Step::Uncertain);
            assert_eq!(stitch.image, first);
        }
        let repeating = RgbaImage::from_fn(320, 480, |x, y| {
            Rgba([if (x + y % 24) % 17 < 8 { 20 } else { 230 }; 4])
        });
        let mut repeated = Stitcher::new(repeating).unwrap();
        let shifted = RgbaImage::from_fn(320, 480, |x, y| {
            Rgba([if (x + (y + 5) % 24) % 17 < 8 { 20 } else { 230 }; 4])
        });
        assert_eq!(repeated.push(shifted), Step::Uncertain);
    }
    #[test]
    fn limits_are_checked_before_allocation() {
        assert!(valid_size(1200, 20000));
        assert!(!valid_size(1201, 20000));
        assert!(!valid_size(100, 20001));
        assert!(!valid_size(63, 480));
    }
    #[test]
    fn small_animation_settles_but_a_scrolling_page_does_not() {
        let p = page(320, 1500);
        let a = frame(&p, 0, 44, 32);
        let mut blink = a.clone();
        for x in 15..100 {
            for y in 20..24 {
                blink.put_pixel(x, y, Rgba([250, 250, 250, 255]));
            }
        }
        assert!(settled_frame(&a, &blink));
        assert!(!settled_frame(&a, &frame(&p, 140, 44, 32)));
        assert_eq!(Stitcher::new(a).unwrap().push(blink), Step::Unchanged);
    }
}
