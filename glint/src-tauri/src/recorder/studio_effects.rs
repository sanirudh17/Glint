//! Source-space Studio effects shared by preview's mathematical contract.
use super::studio_render::Crop;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct Motion {
    pub enabled: bool,
    pub intensity: f64,
}
impl Default for Motion {
    fn default() -> Self {
        Self {
            enabled: false,
            intensity: 0.35,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Focus {
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zoom {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub scale: f64,
    pub mode: String,
    pub focus: Focus,
    pub follow_offset: Option<Focus>,
    pub ease: String,
    pub ease_in: f64,
    pub ease_out: f64,
    pub origin: String,
    pub edited: bool,
    pub transition_start: Option<f64>,
    pub transition_end: Option<f64>,
}
pub fn validate_zooms(segments: &[Zoom], duration: f64) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    if segments.len() > 512 {
        return Err("Too many zoom segments".into());
    }
    for s in segments {
        if !ids.insert(&s.id)
            || s.id.is_empty()
            || [
                s.start, s.end, s.scale, s.focus.x, s.focus.y, s.ease_in, s.ease_out,
            ]
            .iter()
            .any(|v| !v.is_finite())
            || s.start < 0.
            || s.end <= s.start
            || s.end > duration + 0.05
            || !(1.2..=3.).contains(&s.scale)
            || !(0.0..=1.).contains(&s.focus.x)
            || !(0.0..=1.).contains(&s.focus.y)
            || s.follow_offset.as_ref().is_some_and(|p|!p.x.is_finite()||!p.y.is_finite()||!(-1.0..=1.0).contains(&p.x)||!(-1.0..=1.0).contains(&p.y))
            || !(0.0..=2.).contains(&s.ease_in)
            || !(0.0..=2.).contains(&s.ease_out)
            || !matches!(s.mode.as_str(), "fixed" | "follow-cursor")
            || !matches!(s.ease.as_str(), "gentle" | "snappy" | "slow" | "linear" | "smooth" | "accelerate" | "decelerate" | "exponential")
            || !matches!(s.origin.as_str(), "manual" | "auto" | "marker")
            || s.transition_start
                .is_some_and(|v| !v.is_finite() || v > s.start)
            || s.transition_end
                .is_some_and(|v| !v.is_finite() || v < s.end)
        {
            return Err("Invalid zoom segment".into());
        }
    }
    Ok(())
}
pub fn ease(value: f64, preset: &str) -> f64 {
    let x = value.clamp(0., 1.);
    match preset {
        "linear" => x,
        "smooth" => x*x*x*(x*(x*6.-15.)+10.),
        "accelerate" => x*x,
        "decelerate" => 1.-(1.-x)*(1.-x),
        "exponential" => if x==1. {1.} else {1.-2f64.powf(-10.*x)},
        "snappy" => 1. - (1. - x).powi(3),
        "slow" => (1. - (std::f64::consts::PI * x).cos()) / 2.,
        _ => x * x * (3. - 2. * x),
    }
}
#[derive(Clone, Copy, Debug)]
pub struct View {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64,
}
#[derive(Clone, Copy)]
pub struct Follow {
    pub x: f64,
    pub y: f64,
    pub latest_x: f64,
    pub latest_y: f64,
}
pub fn zoom_at(
    segments: &[Zoom],
    t: f64,
    crop: Crop,
    source_w: f64,
    source_h: f64,
    cursor: Option<Follow>,
) -> View {
    let segment = segments
        .iter()
        .filter(|s| s.start <= t && t < s.end)
        .max_by(|a, b| {
            (a.origin == "manual" || a.edited)
                .cmp(&(b.origin == "manual" || b.edited))
                .then_with(|| a.start.total_cmp(&b.start))
        });
    let Some(s) = segment else {
        return View {
            x: crop.x,
            y: crop.y,
            w: crop.w,
            h: crop.h,
            scale: 1.,
        };
    };
    let into = if s.ease_in > 0. {
        ease(
            (t - s.transition_start.unwrap_or(s.start)) / s.ease_in,
            &s.ease,
        )
    } else {
        1.
    };
    let out = if s.ease_out > 0. {
        ease(
            (s.transition_end.unwrap_or(s.end) - t) / s.ease_out,
            &s.ease,
        )
    } else {
        1.
    };
    let scale = 1. + (s.scale - 1.) * into.min(out);
    let (w, h) = (crop.w / scale, crop.h / scale);
    let focus = if s.mode == "follow-cursor" {
        cursor
            .map(|p| (p.x+s.follow_offset.as_ref().map_or(0.,|o|o.x*source_w), p.y+s.follow_offset.as_ref().map_or(0.,|o|o.y*source_h)))
            .unwrap_or((s.focus.x * source_w, s.focus.y * source_h))
    } else {
        (s.focus.x * source_w, s.focus.y * source_h)
    };
    let mut view = View {
        x: (focus.0 - w / 2.).clamp(crop.x, crop.x + crop.w - w),
        y: (focus.1 - h / 2.).clamp(crop.y, crop.y + crop.h - h),
        w,
        h,
        scale,
    };
    if s.mode == "follow-cursor" {
        if let Some(p) = cursor {
            view.x = view
                .x
                .clamp(p.latest_x - w * 0.9, p.latest_x - w * 0.1)
                .clamp(crop.x, crop.x + crop.w - w);
            view.y = view
                .y
                .clamp(p.latest_y - h * 0.9, p.latest_y - h * 0.1)
                .clamp(crop.y, crop.y + crop.h - h);
        }
    }
    view
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_picked_follow_offset_moves_the_camera_without_losing_the_cursor() {
        let s:Zoom=serde_json::from_value(serde_json::json!({"id":"one","start":0.,"end":4.,"scale":2.,"mode":"follow-cursor","focus":{"x":0.6,"y":0.5},"followOffset":{"x":0.1,"y":0.},"ease":"gentle","easeIn":0.4,"easeOut":0.4,"origin":"manual","edited":true})).unwrap();
        validate_zooms(std::slice::from_ref(&s),12.).unwrap();
        let v=zoom_at(&[s],1.,Crop{x:0.,y:0.,w:640.,h:360.},640.,360.,Some(Follow{x:320.,y:180.,latest_x:320.,latest_y:180.}));
        assert!((v.x-224.).abs()<0.001);assert_eq!(v.y,90.);assert!(320.>v.x&&320.<v.x+v.w);
    }
    #[test]
    fn source_focus_is_clamped_through_zoom_easing() {
        let s:Zoom=serde_json::from_value(serde_json::json!({"id":"one","start":0.,"end":4.,"scale":2.,"mode":"fixed","focus":{"x":1.,"y":1.},"ease":"gentle","easeIn":0.4,"easeOut":0.4,"origin":"manual","edited":true})).unwrap();
        validate_zooms(std::slice::from_ref(&s), 10.).unwrap();
        let crop = Crop {
            x: 100.,
            y: 50.,
            w: 800.,
            h: 600.,
        };
        assert_eq!(
            zoom_at(std::slice::from_ref(&s), 0., crop, 1920., 1080., None).scale,
            1.
        );
        let v = zoom_at(&[s], 1., crop, 1920., 1080., None);
        assert_eq!(v.x, 500.);
        assert_eq!(v.y, 350.);
    }
}
