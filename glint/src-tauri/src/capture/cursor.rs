//! Composite the live mouse cursor onto a frozen RGBA frame (opt-in "include cursor"). Pure
//! Win32/GDI; stays inside `capture/`. Never panics — any failure or a hidden cursor is a
//! logged no-op so the screenshot still succeeds.

#[cfg(windows)]
pub fn composite_cursor(rgba: &mut [u8], width: u32, height: u32, origin_x: i32, origin_y: i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON,
        ICONINFO,
    };

    const CURSOR_SIZE: i32 = 64; // large enough for any standard/large cursor

    unsafe {
        let mut ci = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_err() || (ci.flags.0 & CURSOR_SHOWING.0) == 0 {
            return;
        }
        let hcursor = HICON(ci.hCursor.0);

        let mut ii = ICONINFO::default();
        if GetIconInfo(hcursor, &mut ii).is_err() {
            return;
        }
        // Hotspot: where the click-point sits inside the cursor image.
        let hotspot = POINT { x: ii.xHotspot as i32, y: ii.yHotspot as i32 };
        if !ii.hbmMask.is_invalid() {
            let _ = DeleteObject(ii.hbmMask.into());
        }
        if !ii.hbmColor.is_invalid() {
            let _ = DeleteObject(ii.hbmColor.into());
        }

        // Draw the cursor into a 32bpp top-down DIB with a known-zero background, then read
        // its BGRA back. DrawIconEx writes color where the cursor is opaque.
        let hdc: HDC = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return;
        }
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: CURSOR_SIZE,
                biHeight: -CURSOR_SIZE, // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbmp = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0);
        let hbmp = match hbmp {
            Ok(h) if !h.is_invalid() && !bits.is_null() => h,
            _ => {
                let _ = DeleteDC(hdc);
                return;
            }
        };
        let old = SelectObject(hdc, hbmp.into());

        let drawn =
            DrawIconEx(hdc, 0, 0, hcursor, CURSOR_SIZE, CURSOR_SIZE, 0, None, DI_NORMAL).is_ok();

        if drawn {
            let buf =
                std::slice::from_raw_parts(bits as *const u8, (CURSOR_SIZE * CURSOR_SIZE * 4) as usize);
            // Destination top-left of the cursor image on the frozen frame.
            let dst_x = ci.ptScreenPos.x - origin_x - hotspot.x;
            let dst_y = ci.ptScreenPos.y - origin_y - hotspot.y;
            for cy in 0..CURSOR_SIZE {
                for cx in 0..CURSOR_SIZE {
                    let ci4 = ((cy * CURSOR_SIZE + cx) * 4) as usize;
                    let b = buf[ci4];
                    let g = buf[ci4 + 1];
                    let r = buf[ci4 + 2];
                    let a = buf[ci4 + 3];
                    // DrawIconEx on a zeroed DIB leaves transparent pixels at (0,0,0,0).
                    // Treat any non-zero pixel as cursor ink; alpha-blend when alpha present.
                    if b == 0 && g == 0 && r == 0 && a == 0 {
                        continue;
                    }
                    let px = dst_x + cx;
                    let py = dst_y + cy;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let di = ((py as u32 * width + px as u32) * 4) as usize;
                    if di + 3 >= rgba.len() {
                        continue;
                    }
                    let alpha = if a == 0 { 255u32 } else { a as u32 };
                    let inv = 255 - alpha;
                    // rgba buffer is RGBA; cursor DIB is BGRA.
                    rgba[di] = ((r as u32 * alpha + rgba[di] as u32 * inv) / 255) as u8;
                    rgba[di + 1] = ((g as u32 * alpha + rgba[di + 1] as u32 * inv) / 255) as u8;
                    rgba[di + 2] = ((b as u32 * alpha + rgba[di + 2] as u32 * inv) / 255) as u8;
                    rgba[di + 3] = 255;
                }
            }
        }

        SelectObject(hdc, old);
        let _ = DeleteObject(hbmp.into());
        let _ = DeleteDC(hdc);
    }
}

#[cfg(not(windows))]
pub fn composite_cursor(_rgba: &mut [u8], _width: u32, _height: u32, _origin_x: i32, _origin_y: i32) {}
