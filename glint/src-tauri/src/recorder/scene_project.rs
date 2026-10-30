//! Versioned, source-preserving multi-scene projects. Existing Studio files are unchanged.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub path: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub has_audio: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transition {
    pub kind: String,
    pub duration: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub kind: String,
    pub media: Option<Media>,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub title: String,
    pub title_color: String,
    pub title_start: String,
    pub title_end: String,
    pub title_size: f64,
    pub raster: Option<String>,
    pub transition: Transition,
    #[serde(default)]
    pub entrance: Option<String>,
    #[serde(default)]
    pub annotations: Vec<super::video_annotations::Annotation>,
    #[serde(default)]
    pub shape: Option<String>,
}
impl Scene {
    pub fn seconds(&self) -> f64 {
        if self.kind == "video" {
            self.end - self.start
        } else {
            self.duration
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SceneProject {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub look: Value,
    pub scenes: Vec<Scene>,
}
impl SceneProject {
    pub fn validate(&self) -> Result<f64, String> {
        if self.version != 1 {
            return Err("This video project needs a newer Glint version.".into());
        }
        if !(16..=1920).contains(&self.width)
            || !(16..=1920).contains(&self.height)
            || self.width % 2 != 0
            || self.height % 2 != 0
        {
            return Err("Use even output dimensions between 16 and 1920 pixels.".into());
        }
        if self.scenes.is_empty() || self.scenes.len() > 32 {
            return Err("A project needs between 1 and 32 scenes.".into());
        }
        let mut ids = std::collections::HashSet::new();
        let mut total = 0.;
        for (i, s) in self.scenes.iter().enumerate() {
            if s.entrance.as_ref().is_some_and(|v|!matches!(v.as_str(),"none"|"fade"|"left"|"right"|"up"|"down"|"zoom-in"|"zoom-out"))||s.shape.as_ref().is_some_and(|v|!matches!(v.as_str(),"none"|"line"|"circle"|"rectangle")){return Err("Invalid title motion or shape.".into());}
            if s.id.is_empty()
                || !ids.insert(&s.id)
                || !matches!(s.kind.as_str(), "video" | "image" | "title")
            {
                return Err("Invalid or duplicate scene.".into());
            }
            super::video_annotations::validate(&s.annotations,if s.kind=="video" {s.media.as_ref().map_or(s.end,|m|m.duration)} else {s.duration})?;
            let seconds = s.seconds();
            if !seconds.is_finite()
                || !(0.25..=900.).contains(&seconds)
                || !s.start.is_finite()
                || !s.end.is_finite()
                || s.start < 0.
            {
                return Err("Scene duration must be between 0.25 seconds and 15 minutes.".into());
            }
            if s.kind != "title" {
                let m = s.media.as_ref().ok_or("Missing scene media.")?;
                if m.path.is_empty()
                    || m.kind != s.kind
                    || m.width < 2
                    || m.height < 2
                    || m.width as u64 * m.height as u64 > 24_000_000
                    || !m.duration.is_finite()
                    || s.kind == "video" && s.end > m.duration + 0.05
                {
                    return Err("Scene media or trim range is invalid.".into());
                }
            } else {
                if s.title.trim().is_empty()
                    || s.title.chars().count() > 300
                    || !s.title_size.is_finite()
                    || !(24.0..=160.).contains(&s.title_size)
                {
                    return Err("Use a title of 1–300 characters and a size of 24–160.".into());
                }
                for c in [&s.title_color, &s.title_start, &s.title_end] {
                    super::studio_render::color(c)?;
                }
                if s.raster.as_ref().is_some_and(|r| {
                    r.len() > 24_000_000 || !r.starts_with("data:image/png;base64,")
                }) {
                    return Err("Invalid title image.".into());
                }
            }
            if !matches!(s.transition.kind.as_str(), "cut" | "crossfade" | "slide")
                || !s.transition.duration.is_finite()
                || !(0.1..=2.).contains(&s.transition.duration)
            {
                return Err("Invalid scene transition.".into());
            }
            total += seconds - self.overlap(i);
        }
        if total > 1800. {
            return Err("A video project can be at most 30 minutes long.".into());
        }
        // Validate the actual shared compositor settings, not just the document envelope.
        let p = self.render_project(0., 1.)?;
        super::studio_render::layout(self.width, self.height, None, &p.look)?;
        Ok(total)
    }
    pub fn overlap(&self, index: usize) -> f64 {
        if index == 0 || self.scenes[index].transition.kind == "cut" {
            return 0.;
        }
        self.scenes[index]
            .transition
            .duration
            .min(self.scenes[index - 1].seconds() / 2.)
            .min(self.scenes[index].seconds() / 2.)
    }
    pub fn render_project(
        &self,
        start: f64,
        end: f64,
    ) -> Result<super::studio_render::Project, String> {
        let mut look = self.look.clone();
        if look["enabled"] != true {
            look = json!({"enabled":true,"background":{"type":"solid","color":"#000000"},"padding":0,"radius":0,"shadow":0,"aspect":"auto","chrome":{"style":"none"}});
        }
        look["outputSize"] = json!({"width":self.width,"height":self.height});
        serde_json::from_value(json!({"version":2,"look":look,"cursor":{"visible":false,"smoothing":0,"size":32,"style":"arrow","hideIdle":false,"idleSeconds":2,"clicks":false,"clickSize":36,"keystrokes":false},"crop":null,"clips":[{"start":start,"end":end,"speed":1,"kept":true,"order":0}],"fadeIn":0,"fadeOut":0,"cam":null,"zoomSegments":[],"masks":[]})).map_err(|e|e.to_string())
    }
    pub fn events(width: u32, height: u32) -> super::studio::Events {
        super::studio::Events {
            version: 1,
            geometry: super::studio::Geometry {
                x: 0,
                y: 0,
                width,
                height,
                monitor_x: 0,
                monitor_y: 0,
                monitor_width: width,
                monitor_height: height,
                dpi_scale: 1.,
            },
            events: vec![],
        }
    }
    /// Video and audio use the same overlap arithmetic, including mixed cuts.
    pub fn join_graph(&self) -> String {
        let mut g = String::new();
        for i in 0..self.scenes.len() {
            g.push_str(&format!("[{i}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v{i}];[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}];"));
        }
        let (mut v, mut a, mut elapsed) =
            ("v0".to_string(), "a0".to_string(), self.scenes[0].seconds());
        for i in 1..self.scenes.len() {
            let overlap = self.overlap(i);
            let (nv, na) = (format!("joinedv{i}"), format!("joineda{i}"));
            if overlap == 0. {
                g.push_str(&format!(
                    "[{v}][{a}][v{i}][a{i}]concat=n=2:v=1:a=1[{nv}][{na}];"
                ));
            } else {
                let transition = if self.scenes[i].transition.kind == "slide" {
                    "slideleft"
                } else {
                    "fade"
                };
                g.push_str(&format!("[{v}][v{i}]xfade=transition={transition}:duration={overlap:.6}:offset={:.6}[{nv}];[{a}][a{i}]acrossfade=d={overlap:.6}:c1=tri:c2=tri[{na}];",elapsed-overlap));
            }
            v = nv;
            a = na;
            elapsed += self.scenes[i].seconds() - overlap;
        }
        g.push_str(&format!("[{v}]null[outv];[{a}]anull[outa]"));
        g
    }
}
pub fn document_path(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() || !path.to_lowercase().ends_with(".glint-video") {
        return Err("Choose a .glint-video project file.".into());
    }
    Ok(p.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project() -> SceneProject {
        serde_json::from_value(json!({"version":1,"width":1280,"height":720,"look":{"enabled":false},"scenes":[{"id":"one","kind":"title","media":null,"start":0,"end":0,"duration":2,"title":"Hello","titleColor":"#ffffff","titleStart":"#223344","titleEnd":"#667788","titleSize":64,"raster":null,"transition":{"kind":"cut","duration":0.3}}]})).unwrap()
    }
    #[test]
    #[ignore="requires bundled FFmpeg; verifies real scene crossfade and audio/video duration"]
    fn mixed_scene_media_roundtrip() {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        let binary=PathBuf::from(std::env::var("GLINT_TEST_FFMPEG").unwrap());
        let root=PathBuf::from(std::env::var("GLINT_VIDEO_FIXTURES").unwrap());std::fs::create_dir_all(&root).unwrap();
        let mut p=project();p.scenes[0].duration=1.;let mut next=p.scenes[0].clone();next.id="second".into();next.transition.kind="crossfade".into();next.transition.duration=0.2;p.scenes.push(next);
        let duration=p.validate().unwrap();assert!((duration-1.8).abs()<0.001);
        let output=root.join("scene-crossfade.mp4");
        // Use muxed fixtures, as the actual exporter does.
        let mut inputs=Vec::new();
        for (i,color) in ["red","blue"].iter().enumerate() {
            let input=root.join(format!("scene-input-{i}.mp4"));
            let result=Command::new(&binary).args(["-y","-v","error","-f","lavfi","-i",&format!("color=c={color}:s=320x180:r=30:d=1"),"-f","lavfi","-i","anullsrc=r=48000:cl=stereo:d=1","-c:v","libx264","-c:a","aac","-shortest"]).arg(&input).creation_flags(0x08000000).output().unwrap();assert!(result.status.success());inputs.push(input);
        }
        let result=Command::new(&binary).args(["-y","-v","error","-i"]).arg(&inputs[0]).arg("-i").arg(&inputs[1])
            .args(["-filter_complex_threads","2","-filter_complex",&p.join_graph(),"-map","[outv]","-map","[outa]","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-t","1.8"]).arg(&output).creation_flags(0x08000000).output().unwrap();
        assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
        let probe=Command::new(binary.with_file_name("ffprobe.exe")).args(["-v","error","-show_entries","stream=codec_type:format=duration","-of","json"]).arg(&output).creation_flags(0x08000000).output().unwrap();assert!(probe.status.success());
        let info:serde_json::Value=serde_json::from_slice(&probe.stdout).unwrap();
        assert!(info["streams"].as_array().unwrap().iter().any(|s|s["codec_type"]=="audio"));
        assert!((info["format"]["duration"].as_str().unwrap().parse::<f64>().unwrap()-duration).abs()<0.1);
        for (t,red) in [("0.1",true),("1.5",false)] {
            let frame=Command::new(&binary).args(["-v","error","-ss",t,"-i"]).arg(&output).args(["-frames:v","1","-f","image2pipe","-vcodec","png","-"]).creation_flags(0x08000000).output().unwrap();assert!(frame.status.success());
            let image=image::load_from_memory(&frame.stdout).unwrap().to_rgb8();let rgb=image.get_pixel(160,90);assert_eq!(rgb[0]>200&&rgb[2]<50,red);
        }
    }
    #[test]
    fn schema_rejects_future_versions_duplicate_ids_and_invalid_ranges() {
        let mut p = project();
        assert_eq!(p.validate().unwrap(), 2.);
        p.version = 9;
        assert!(p.validate().is_err());
        p.version = 1;
        p.scenes.push(p.scenes[0].clone());
        assert!(p.validate().is_err());
        p.scenes[1].id = "two".into();
        p.scenes[1].duration = f64::NAN;
        assert!(p.validate().is_err());
        p.scenes[1].duration = 1.;
        p.width = 1279;
        assert!(p.validate().is_err());
    }
    #[test]
    fn mixed_transitions_share_duration_with_audio_graph() {
        let mut p = project();
        for (id, kind) in [("two", "crossfade"), ("three", "cut"), ("four", "slide")] {
            let mut s = p.scenes[0].clone();
            s.id = id.into();
            s.transition.kind = kind.into();
            s.transition.duration = 0.4;
            p.scenes.push(s);
        }
        assert!((p.validate().unwrap() - 7.2).abs() < 1e-9);
        let g = p.join_graph();
        assert!(g.contains("offset=1.600000"));
        assert!(g.contains("offset=5.200000"));
        assert_eq!(g.matches("acrossfade").count(), 2);
        assert!(g.contains("concat=n=2"));
    }
    #[test]
    fn overlap_cannot_consume_short_scenes() {
        let mut p = project();
        let mut s = p.scenes[0].clone();
        s.id = "two".into();
        s.duration = 0.25;
        s.transition = Transition {
            kind: "slide".into(),
            duration: 2.,
        };
        p.scenes.push(s);
        assert_eq!(p.overlap(1), 0.125);
        assert_eq!(p.validate().unwrap(), 2.125);
    }
    #[test]
    fn old_studio_documents_are_not_reinterpreted_as_scene_projects() {
        assert!(serde_json::from_value::<SceneProject>(json!({"version":2,"clips":[]})).is_err());
        let p = project();
        let roundtrip: SceneProject =
            serde_json::from_slice(&serde_json::to_vec(&p).unwrap()).unwrap();
        assert_eq!(roundtrip.scenes[0].title, "Hello");
    }
}
