//! Pure selection geometry & RGBA crop. No platform or Tauri deps — unit-tested.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LogicalRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PixelRect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }

/// Map an overlay (logical/CSS px) rect to physical pixels via the monitor scale.
pub fn logical_to_physical(r: LogicalRect, scale: f64) -> PixelRect {
    PixelRect {
        x: (r.x * scale).round() as u32,
        y: (r.y * scale).round() as u32,
        w: (r.w * scale).round() as u32,
        h: (r.h * scale).round() as u32,
    }
}

/// Clamp to image bounds; return None for a zero-area result.
pub fn clamp_rect(r: PixelRect, img_w: u32, img_h: u32) -> Option<PixelRect> {
    if r.x >= img_w || r.y >= img_h { return None; }
    let x = r.x.min(img_w);
    let y = r.y.min(img_h);
    let w = r.w.min(img_w - x);
    let h = r.h.min(img_h - y);
    if w == 0 || h == 0 { return None; }
    Some(PixelRect { x, y, w, h })
}

/// Remove per-row padding (stride may exceed width*4) into a packed RGBA buffer.
pub fn depad(src: &[u8], width: u32, height: u32, stride_bytes: usize) -> Vec<u8> {
    let row_used = (width as usize) * 4;
    if stride_bytes == row_used {
        return src[..row_used * height as usize].to_vec();
    }
    let mut out = Vec::with_capacity(row_used * height as usize);
    for row in 0..height as usize {
        let start = row * stride_bytes;
        out.extend_from_slice(&src[start..start + row_used]);
    }
    out
}

/// Crop a packed RGBA buffer to `r` (assumes `r` already clamped within bounds).
pub fn crop_rgba(packed: &[u8], img_w: u32, _img_h: u32, r: PixelRect) -> Vec<u8> {
    let row_bytes = (img_w as usize) * 4;
    let out_row = (r.w as usize) * 4;
    let mut out = Vec::with_capacity(out_row * r.h as usize);
    for row in 0..r.h as usize {
        let src_y = r.y as usize + row;
        let start = src_y * row_bytes + (r.x as usize) * 4;
        out.extend_from_slice(&packed[start..start + out_row]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_to_physical_scales_and_rounds() {
        let p = logical_to_physical(LogicalRect { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }, 1.5);
        assert_eq!(p, PixelRect { x: 15, y: 30, w: 150, h: 75 });
    }

    #[test]
    fn logical_to_physical_identity_at_scale_one() {
        let p = logical_to_physical(LogicalRect { x: 3.0, y: 4.0, w: 5.0, h: 6.0 }, 1.0);
        assert_eq!(p, PixelRect { x: 3, y: 4, w: 5, h: 6 });
    }

    #[test]
    fn clamp_keeps_interior_rect() {
        let r = PixelRect { x: 10, y: 10, w: 20, h: 20 };
        assert_eq!(clamp_rect(r, 100, 100), Some(r));
    }

    #[test]
    fn clamp_trims_overflow() {
        let r = PixelRect { x: 90, y: 90, w: 50, h: 50 };
        assert_eq!(clamp_rect(r, 100, 100), Some(PixelRect { x: 90, y: 90, w: 10, h: 10 }));
    }

    #[test]
    fn clamp_rejects_zero_area() {
        assert_eq!(clamp_rect(PixelRect { x: 5, y: 5, w: 0, h: 10 }, 100, 100), None);
        assert_eq!(clamp_rect(PixelRect { x: 100, y: 0, w: 10, h: 10 }, 100, 100), None);
    }

    #[test]
    fn depad_removes_row_padding() {
        // 2x2 image, stride 12 bytes (8 used + 4 pad)
        let src = vec![
            1, 1, 1, 1, 2, 2, 2, 2, 9, 9, 9, 9,
            3, 3, 3, 3, 4, 4, 4, 4, 9, 9, 9, 9,
        ];
        let packed = depad(&src, 2, 2, 12);
        assert_eq!(packed, vec![1,1,1,1, 2,2,2,2, 3,3,3,3, 4,4,4,4]);
    }

    #[test]
    fn crop_extracts_subrect() {
        // 2x2 packed RGBA, crop bottom-right 1x1
        let packed = vec![1,1,1,1, 2,2,2,2, 3,3,3,3, 4,4,4,4];
        let out = crop_rgba(&packed, 2, 2, PixelRect { x: 1, y: 1, w: 1, h: 1 });
        assert_eq!(out, vec![4,4,4,4]);
    }
}
