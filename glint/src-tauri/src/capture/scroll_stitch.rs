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
    row_error_at(a, ay, b, by, &sample_columns(a.width()))
}

fn sample_columns(width: u32) -> [u32; 48] {
    std::array::from_fn(|col| width / 24 + col as u32 * (width * 11 / 12 - 1) / 47)
}

fn row_error_at(a: &RgbaImage, ay: u32, b: &RgbaImage, by: u32, columns: &[u32]) -> f64 {
    let mut error = 0u64;
    for &x in columns {
        let p = a.get_pixel(x, ay);
        let q = b.get_pixel(x, by);
        for c in 0..3 {
            error += p[c].abs_diff(q[c]) as u64;
        }
    }
    error as f64 / (columns.len() * 3) as f64
}

// Match the moving page, not fixed browser margins/navigation beside it. Derive
// this from motion at the same screen coordinates before searching offsets.
fn alignment_columns(a: &RgbaImage, b: &RgbaImage) -> Vec<u32> {
    sample_columns(a.width())
        .into_iter()
        .filter(|&x| {
            let mut changed = 0;
            for row in 0..64 {
                let y = row * (a.height() - 1) / 63;
                let (p, q) = (a.get_pixel(x, y), b.get_pixel(x, y));
                let error = (0..3).map(|c| p[c].abs_diff(q[c]) as u32).sum::<u32>();
                if error > 12 {
                    changed += 1;
                }
            }
            changed >= 6
        })
        .collect()
}

fn row_detail(image: &RgbaImage, y: u32, columns: &[u32]) -> bool {
    let (mut low, mut high) = (255, 0);
    for &x in columns {
        let p = image.get_pixel(x, y);
        let luma = (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3;
        low = low.min(luma);
        high = high.max(luma);
    }
    high - low >= 20
}

// Large selections can contain several nearly identical paragraphs. Sparse
// anchors locate candidates; actual moving pixels (including small letters and
// digits between the anchors) must distinguish their offsets before acceptance.
fn refine_candidates(
    a: &RgbaImage,
    b: &RgbaImage,
    start: u32,
    end: u32,
    candidates: &mut Vec<(f64, u32)>,
) -> bool {
    let coarse = candidates[0].0;
    candidates.retain(|(error, _)| *error <= coarse + 1.5);
    if candidates.len() > 16 {
        return false;
    }
    let columns: Vec<_> = (a.width() / 24..a.width() * 23 / 24)
        .filter(|&x| {
            (0..64).any(|row| {
                let y = row * (a.height() - 1) / 63;
                let (p, q) = (a.get_pixel(x, y), b.get_pixel(x, y));
                (0..3).any(|c| p[c].abs_diff(q[c]) > 4)
            })
        })
        .collect();
    if columns.is_empty() {
        return false;
    }
    for (score, shift) in candidates.iter_mut() {
        let mut squared = 0u64;
        let mut count = 0u64;
        for y in start..end - *shift {
            for &x in &columns {
                let (p, q) = (a.get_pixel(x, y + *shift), b.get_pixel(x, y));
                for c in 0..3 {
                    let d = p[c].abs_diff(q[c]) as u64;
                    squared += d * d;
                    count += 1;
                }
            }
        }
        *score = (squared as f64 / count.max(1) as f64).sqrt();
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (best, shift) = candidates[0];
    best <= 3.
        && !candidates
            .iter()
            .any(|(e, d)| d.abs_diff(shift) > 2 && *e < best + 0.25)
}

fn extend_stationary_sides(
    output: &mut RgbaImage,
    prev: &RgbaImage,
    next: &RgbaImage,
    top: u32,
    bottom: u32,
    shift: u32,
) {
    let end = prev.height() - bottom;
    let moving = |x| {
        (top..end).any(|y| {
            let (p, q) = (prev.get_pixel(x, y), next.get_pixel(x, y));
            (0..3).any(|c| p[c].abs_diff(q[c]) > 4)
        })
    };
    let Some(left) = (0..prev.width()).find(|&x| moving(x)) else {
        return;
    };
    let right = (left..prev.width()).rfind(|&x| moving(x)).unwrap();
    let new_end = output.height() - bottom;
    let tail = (end - top).min(64);
    for x in (0..left).chain(right + 1..prev.width()) {
        let mut colors = std::collections::HashMap::new();
        for row in 0..64 {
            let color = *prev.get_pixel(x, top + row * (end - top - 1) / 63);
            *colors.entry(color.0).or_insert(0u32) += 1;
        }
        let (color, count) = colors.into_iter().max_by_key(|(_, n)| *n).unwrap();
        // Only extend a clear flat panel background, never guess at photographs
        // or patterned sidebars. Move its fixed bottom controls once to the end.
        if count < 32 {
            continue;
        }
        for y in new_end - shift - tail..new_end {
            output.put_pixel(x, y, image::Rgba(color));
        }
        for row in 0..tail {
            output.put_pixel(
                x,
                new_end - tail + row,
                *next.get_pixel(x, end - tail + row),
            );
        }
    }
}

pub fn same_frame(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.dimensions() != b.dimensions() {
        return false;
    }
    (0..48).all(|i| row_error(a, i * (a.height() - 1) / 47, b, i * (b.height() - 1) / 47) < 0.7)
}

/// A caret, clock or small hover animation must not keep a settled page waiting.
/// Substantial motion still needs to stop before we accept a strip.
fn strict_settled_frame(a: &RgbaImage, b: &RgbaImage) -> bool {
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

fn strict_offset(prev: &RgbaImage, next: &RgbaImage) -> Option<(u32, u32, u32)> {
    let h = prev.height();
    let columns = alignment_columns(prev, &next);
    if columns.len() < 4 {
        return None;
    }
    let error_at = |ay, by| row_error_at(prev, ay, &next, by, &columns);
    // Static headers/footers are identified in place, then excluded from the
    // displacement search. Full-window captures may include tall toolbars;
    // retain at least 128 pixels of moving content rather than capping chrome
    // at one quarter of the whole selection.
    let mut top = 0;
    while top < h - 128 && error_at(top, top) < 0.7 {
        top += 1;
    }
    let mut bottom = 0;
    while bottom < h - top - 128 && error_at(h - 1 - bottom, h - 1 - bottom) < 0.7 {
        bottom += 1;
    }
    let guard = (h / 32).max(4);
    let start = top.max(guard);
    let end = h - bottom.max(guard);
    let Some(moving_height) = end.checked_sub(start) else {
        return None;
    };
    let min_overlap = (moving_height / 4).max(64);
    if end <= start + min_overlap {
        return None;
    }
    let details: Vec<_> = (0..h).map(|y| row_detail(prev, y, &columns)).collect();
    let mut candidates = Vec::new();
    for shift in 1..end - start - min_overlap + 1 {
        let length = end - start - shift;
        let (mut sum, mut count, mut bad) = (0., 0, 0);
        for i in 0..48 {
            let y = start + i * (length - 1) / 47;
            if !details[(y + shift) as usize] {
                continue;
            }
            let error = error_at(y + shift, y);
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
    let Some(&(error, _)) = candidates.first() else {
        return None;
    };
    if error > 3. {
        return None;
    }
    if candidates.iter().skip(1).any(|(e, _)| *e < error + 1.5)
        && !refine_candidates(prev, &next, start, end, &mut candidates)
    {
        return None;
    }
    let shift = candidates[0].1;
    // Check the full overlap, not just anchors: reject substantial animation,
    // horizontal movement, lazy-load reflow or an unrelated window.
    let mut mismatch = 0;
    let rows = end - start - shift;
    for y in start..end - shift {
        if error_at(y + shift, y) > 8. {
            mismatch += 1;
        }
    }
    if mismatch * 20 > rows {
        return None;
    }

    Some((shift, top, bottom))
}

const PATCH_COLS: u32 = 9;
const PATCH_ROWS: u32 = 5;
const PATCH_BYTES: usize = (PATCH_COLS * PATCH_ROWS * 3) as usize;

struct Patch {
    x: u32,
    y: u32,
    col: u32,
    row: u32,
    pixels: [u8; PATCH_BYTES],
}
fn patches(image: &RgbaImage) -> Vec<Patch> {
    let mut result = Vec::new();
    for row in 0..32 {
        for col in 0..24 {
            let x = image.width() / 24 + col * (image.width() * 11 / 12 - PATCH_COLS * 2) / 23;
            let y = image.height() / 32 + row * (image.height() * 15 / 16 - PATCH_ROWS * 2) / 31;
            let mut pixels = [0; PATCH_BYTES];
            let (mut low, mut high) = (255u32, 0u32);
            for dy in 0..PATCH_ROWS {
                for dx in 0..PATCH_COLS {
                    let p = image.get_pixel(x + dx * 2, y + dy * 2);
                    let luma = (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3;
                    low = low.min(luma);
                    high = high.max(luma);
                    for c in 0..3 {
                        pixels[((dy * PATCH_COLS + dx) * 3) as usize + c] = p[c];
                    }
                }
            }
            if high - low >= 20 {
                result.push(Patch {
                    x,
                    y,
                    col,
                    row,
                    pixels,
                });
            }
        }
    }
    result
}
fn patch_matches(image: &RgbaImage, patch: &Patch, shift: u32) -> bool {
    if patch.y + shift + (PATCH_ROWS - 1) * 2 >= image.height() {
        return false;
    }
    let mut error = 0u32;
    for dy in 0..PATCH_ROWS {
        for dx in 0..PATCH_COLS {
            let p = image.get_pixel(patch.x + dx * 2, patch.y + shift + dy * 2);
            for c in 0..3 {
                error +=
                    p[c].abs_diff(patch.pixels[((dy * PATCH_COLS + dx) * 3) as usize + c]) as u32;
                if error > PATCH_BYTES as u32 * 3 {
                    return false;
                }
            }
        }
    }
    true
}
fn stable_layout(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.dimensions() != b.dimensions() {
        return false;
    }
    let anchors = patches(b);
    let matching: Vec<_> = anchors.iter().filter(|p| patch_matches(a, p, 0)).collect();
    if matching.len() < 24 || matching.len() * 4 < anchors.len() {
        return false;
    }
    let (min_x, max_x) = (
        matching.iter().map(|p| p.x).min().unwrap(),
        matching.iter().map(|p| p.x).max().unwrap(),
    );
    let (min_y, max_y) = (
        matching.iter().map(|p| p.y).min().unwrap(),
        matching.iter().map(|p| p.y).max().unwrap(),
    );
    max_x - min_x >= a.width() / 4 && max_y - min_y >= a.height() / 3
}

/// A local video, thumbnail or spinner need not settle if enough detailed page
/// content remains stable. Matching still has to prove a coherent scroll offset.
pub fn settled_frame(a: &RgbaImage, b: &RgbaImage) -> bool {
    strict_settled_frame(a, b) || stable_layout(a, b)
}

// Fallback for local updates: vote with detailed 2D patches, not whole rows.
// Fixed chrome/sidebar patches cannot vote because they match at zero offset.
// Competing offsets or weak/spatially concentrated evidence are never appended.
fn patch_alignment(
    a: &RgbaImage,
    b: &RgbaImage,
    temporal: Option<&RgbaImage>,
) -> Result<Option<(u32, u32, u32)>, ()> {
    let anchors: Vec<_> = patches(b)
        .into_iter()
        .filter(|p| temporal.is_none_or(|frame| patch_matches(frame, p, 0)))
        .filter(|p| !patch_matches(a, p, 0))
        .collect();
    let mut candidates = Vec::new();
    let mut peak = 0usize;
    let mut possible_offsets = Vec::new();
    for shift in 1..a.height() - a.height().max(256) / 4 {
        let (mut count, mut xs, mut ys) = (0usize, 0u32, 0u32);
        for p in &anchors {
            if patch_matches(a, p, shift) {
                count += 1;
                xs |= 1 << p.col;
                ys |= 1 << p.row;
            }
        }
        peak = peak.max(count);
        if count >= 8 && xs.count_ones() >= 3 && ys.count_ones() >= 3 {
            possible_offsets.push(shift);
        }
        if count >= 16 && count * 6 >= anchors.len() && xs.count_ones() >= 4 && ys.count_ones() >= 4
        {
            let y_span = 31 - ys.leading_zeros() - ys.trailing_zeros();
            if y_span >= 5 {
                candidates.push((count, shift));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let Some(&(count, mut shift)) = candidates.first() else {
        return if peak < 8 && stable_layout(a, b) {
            Ok(None)
        } else {
            Err(())
        };
    };
    let mut verified_pixels = false;
    if candidates
        .iter()
        .any(|(n, d)| d.abs_diff(shift) > 2 && n * 2 >= count)
    {
        // Repeated feed cards can share whole paragraphs. Verify the actual
        // stable moving pixels between anchors before calling that ambiguous.
        // Tiles changing between consecutive samples cannot participate.
        let tile_width = a.width().div_ceil(16);
        let mut stable = vec![true; (tile_width * a.height().div_ceil(16)) as usize];
        if let Some(frame) = temporal {
            for y in (0..a.height()).step_by(2) {
                for x in (0..a.width()).step_by(2) {
                    let (p, q) = (frame.get_pixel(x, y), b.get_pixel(x, y));
                    if (0..3).any(|c| p[c].abs_diff(q[c]) > 4) {
                        stable[(y / 16 * tile_width + x / 16) as usize] = false;
                    }
                }
            }
        }
        let mut refined = Vec::new();
        for &(votes, delta) in &candidates {
            if votes * 2 < count {
                continue;
            }
            let (mut top, mut bottom) = (0, 0);
            while top < a.height() - delta - 64 && row_error(a, top, b, top) < 0.7 {
                top += 1;
            }
            while bottom < a.height() - top - delta - 64
                && row_error(a, a.height() - 1 - bottom, b, a.height() - 1 - bottom) < 0.7
            {
                bottom += 1;
            }
            let (mut squared, mut samples) = (0u64, 0u64);
            for y in (top..a.height() - bottom - delta).step_by(2) {
                for x in (a.width() / 24..a.width() * 23 / 24).step_by(2) {
                    if !stable[(y / 16 * tile_width + x / 16) as usize]
                        || !stable[((y + delta) / 16 * tile_width + x / 16) as usize]
                    {
                        continue;
                    }
                    let (p, zero) = (b.get_pixel(x, y), a.get_pixel(x, y));
                    if (0..3).all(|c| p[c].abs_diff(zero[c]) <= 4) {
                        continue;
                    }
                    let old = a.get_pixel(x, y + delta);
                    for c in 0..3 {
                        let d = p[c].abs_diff(old[c]) as u64;
                        squared += d * d;
                        samples += 1;
                    }
                }
            }
            if samples >= 128 {
                refined.push(((squared as f64 / samples as f64).sqrt(), delta));
            }
        }
        refined.sort_by(|a, b| a.0.total_cmp(&b.0));
        let Some(&(error, best)) = refined.first() else {
            return Err(());
        };
        if error > 3.
            || refined
                .iter()
                .any(|(e, d)| d.abs_diff(best) > 2 && *e < error + 0.25)
        {
            return Err(());
        }
        shift = best;
        verified_pixels = true;
    }
    // A smaller second group can be hidden by the unequal overlap lengths of
    // two offsets. Reject coherent *exclusive* matches elsewhere on the page:
    // that is reflow, not a local image update. Repeated text matching both
    // offsets is handled by the ambiguity guard above.
    for other in possible_offsets
        .into_iter()
        .filter(|d| !verified_pixels && d.abs_diff(shift) > 2)
    {
        let (mut count, mut xs, mut ys) = (0usize, 0u32, 0u32);
        for p in &anchors {
            if !patch_matches(a, p, shift) && patch_matches(a, p, other) {
                count += 1;
                xs |= 1 << p.col;
                ys |= 1 << p.row;
            }
        }
        if count >= 8 && xs.count_ones() >= 3 && ys.count_ones() >= 3 {
            return Err(());
        }
    }
    let h = a.height();
    let mut top = 0;
    let mut bottom = 0;
    while top < h - shift - 64 && row_error(a, top, b, top) < 0.7 {
        top += 1;
    }
    while bottom < h - top - shift - 64 && row_error(a, h - 1 - bottom, b, h - 1 - bottom) < 0.7 {
        bottom += 1;
    }
    Ok(Some((shift, top, bottom)))
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
        self.push_inner(next, None)
    }

    /// Consecutive samples identify locally animated patches. Those cannot vote
    /// for displacement, but stable content around them still can.
    pub fn push_settled(&mut self, next: RgbaImage, temporal: &RgbaImage) -> Step {
        if strict_settled_frame(&next, temporal) {
            self.push(next)
        } else {
            self.push_inner(next, Some(temporal))
        }
    }

    fn push_inner(&mut self, next: RgbaImage, temporal: Option<&RgbaImage>) -> Step {
        let prev = &self.previous;
        if prev.dimensions() != next.dimensions() {
            return Step::Uncertain;
        }
        if strict_settled_frame(prev, &next) {
            return Step::Unchanged;
        }
        let (shift, top, bottom) = if let Some(offset) = strict_offset(prev, &next) {
            offset
        } else {
            match patch_alignment(prev, &next, temporal) {
                Ok(Some(offset)) => offset,
                Ok(None) => {
                    self.previous = next;
                    return Step::Unchanged;
                }
                Err(()) => return Step::Uncertain,
            }
        };
        let h = prev.height();
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
        extend_stationary_sides(&mut self.image, prev, &next, top, bottom, shift);
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

    #[test]
    fn large_window_with_stationary_sidebars_and_tall_chrome_aligns() {
        let content = page(900, 3000);
        let window = |offset: u32| {
            RgbaImage::from_fn(1600, 1000, |x, y| {
                if (340..1240).contains(&x) && (300..820).contains(&y) {
                    *content.get_pixel(x - 340, y - 300 + offset)
                } else {
                    // Detailed fixed navigation on both sides, plus large toolbars.
                    Rgba([((x * 13 + y * 7) % 180) as u8, (y % 150) as u8, 80, 255])
                }
            })
        };
        let mut stitch = Stitcher::new(window(0)).unwrap();
        for offset in [120, 240, 360, 480] {
            assert_eq!(stitch.push(window(offset)), Step::Appended(120));
        }
        assert_eq!(stitch.image.height(), 1480);
        for y in 300..1300 {
            for x in 340..1240 {
                assert_eq!(
                    stitch.image.get_pixel(x, y),
                    content.get_pixel(x - 340, y - 300)
                );
            }
        }
    }

    #[test]
    fn repeated_paragraphs_keep_small_unique_details_between_anchors() {
        let mut content = RgbaImage::from_fn(320, 3000, |x, y| {
            let n = x.wrapping_mul(73856093) ^ (y % 112).wrapping_mul(19349663);
            Rgba(if y % 112 < 60 && x > 12 && x < 305 && n % 11 < 5 {
                [25, 35, 45, 255]
            } else {
                [245, 245, 245, 255]
            })
        });
        for index in 0..26 {
            for bit in 0..5 {
                for y in 10..18 {
                    for x in 0..2 {
                        content.put_pixel(
                            34 + bit * 4 + x,
                            index * 112 + y,
                            Rgba(if index & (1 << bit) != 0 {
                                [5, 5, 5, 255]
                            } else {
                                [245, 245, 245, 255]
                            }),
                        );
                    }
                }
            }
        }
        let frame = |offset| image::imageops::crop_imm(&content, 0, offset, 320, 1000).to_image();
        let mut stitch = Stitcher::new(frame(0)).unwrap();
        assert_eq!(stitch.push(frame(120)), Step::Appended(120));
        assert_eq!(stitch.push(frame(240)), Step::Appended(120));
        assert_eq!(
            stitch.image,
            image::imageops::crop_imm(&content, 0, 0, 320, 1240).to_image()
        );
        // Repeated text plus a changing preview must use stable fine details,
        // rather than rejecting every repeated paragraph as a competing offset.
        let animated = |offset, tick: u32| {
            let mut image = frame(offset);
            for y in 200..350 {
                for x in 180..310 {
                    image.put_pixel(x, y, Rgba([(tick * 37 % 255) as u8, 90, 120, 255]));
                }
            }
            image
        };
        let mut stitch = Stitcher::new(animated(0, 0)).unwrap();
        assert_eq!(
            stitch.push_settled(animated(120, 2), &animated(120, 1)),
            Step::Appended(120)
        );
        assert_eq!(
            stitch.push_settled(animated(240, 4), &animated(240, 3)),
            Step::Appended(120)
        );
    }

    #[test]
    fn stationary_sidebar_keeps_navigation_and_bottom_controls_once() {
        let content = page(320, 2000);
        let window = |offset| {
            RgbaImage::from_fn(600, 480, |x, y| {
                if x >= 180 && x < 500 && y >= 44 && y < 448 {
                    *content.get_pixel(x - 180, y - 44 + offset)
                } else if y < 44 || y >= 448 {
                    Rgba([30, 40, 50, 255])
                } else if y == 440 || y == 441 || y == 60 {
                    Rgba([200, 210, 220, 255])
                } else {
                    Rgba([40, 50, 60, 255])
                }
            })
        };
        let mut stitch = Stitcher::new(window(0)).unwrap();
        assert_eq!(stitch.push(window(120)), Step::Appended(120));
        assert_eq!(stitch.push(window(240)), Step::Appended(120));
        assert_eq!(stitch.image.get_pixel(20, 60), &Rgba([200, 210, 220, 255]));
        assert_eq!(stitch.image.get_pixel(20, 440), &Rgba([40, 50, 60, 255]));
        assert_eq!(stitch.image.get_pixel(20, 680), &Rgba([200, 210, 220, 255]));
    }

    #[test]
    fn localized_video_updates_do_not_block_stationary_page_or_scroll() {
        let content = page(800, 2400);
        let frame = |offset: u32, tick: u32| {
            RgbaImage::from_fn(800, 800, |x, y| {
                let py = y + offset;
                if (100..650).contains(&x) && (80..350).contains(&py) {
                    let n = x.wrapping_mul(19349663)
                        ^ py.wrapping_mul(73856093)
                        ^ tick.wrapping_mul(83492791);
                    Rgba([
                        (n % 255) as u8,
                        ((n >> 8) % 255) as u8,
                        ((n >> 16) % 255) as u8,
                        255,
                    ])
                } else {
                    *content.get_pixel(x, py)
                }
            })
        };
        assert!(settled_frame(&frame(0, 0), &frame(0, 1)));
        let mut stitch = Stitcher::new(frame(0, 0)).unwrap();
        assert_eq!(stitch.push(frame(0, 1)), Step::Unchanged);
        assert_eq!(stitch.push(frame(100, 2)), Step::Appended(100));
        assert_eq!(stitch.push(frame(200, 3)), Step::Appended(100));
        let mut temporal = Stitcher::new(frame(0, 0)).unwrap();
        assert_eq!(
            temporal.push_settled(frame(100, 21), &frame(100, 20)),
            Step::Appended(100)
        );
        for y in 800..1000 {
            for x in 0..800 {
                assert_eq!(stitch.image.get_pixel(x, y), content.get_pixel(x, y));
            }
        }
    }

    #[test]
    fn local_update_fallback_rejects_competing_reflow_and_horizontal_motion() {
        let content = page(900, 2400);
        let first = image::imageops::crop_imm(&content, 0, 0, 800, 800).to_image();
        let split = RgbaImage::from_fn(800, 800, |x, y| {
            *content.get_pixel(x, y + if y < 400 { 100 } else { 220 })
        });
        let sideways = RgbaImage::from_fn(800, 800, |x, y| *content.get_pixel(x + 30, y + 100));
        for next in [split, sideways] {
            let mut stitch = Stitcher::new(first.clone()).unwrap();
            assert_eq!(stitch.push(next), Step::Uncertain);
            assert_eq!(stitch.image, first);
        }
    }
}
