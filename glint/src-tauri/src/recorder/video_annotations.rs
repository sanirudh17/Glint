//! Editable vector marks are rasterized by the shared preview painter before export.
//! Decode once, retain only painted pixels, and apply in source-time order.
use base64::Engine;
use image::{RgbImage, ImageReader};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String, pub kind: String, pub start: f64, pub end: f64,
    pub points: Vec<Point>, pub color: String, pub width: f64, pub size: f64, pub text: String,
    #[serde(default)] pub raster: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Point { pub x: f64, pub y: f64 }
pub fn validate(items: &[Annotation], duration: f64) -> Result<(), String> {
    let mut ids=std::collections::HashSet::new();
    if items.len()>64 || items.iter().any(|a|
        a.id.len()>128 || !ids.insert(&a.id) || !matches!(a.kind.as_str(),"pen"|"highlight"|"arrow"|"rectangle"|"ellipse"|"text")
        || !a.start.is_finite() || !a.end.is_finite() || a.start<0. || a.end<=a.start || a.end>duration+0.05
        || !a.width.is_finite() || !(0.001..=0.04).contains(&a.width) || !a.size.is_finite() || !(0.01..=0.2).contains(&a.size)
        || a.text.chars().count()>500 || a.color.len()!=7 || !a.color.starts_with('#') || !a.color[1..].bytes().all(|c|c.is_ascii_hexdigit())
        || a.points.is_empty() || a.points.len()>4096 || a.points.iter().any(|p|!p.x.is_finite()||!p.y.is_finite()||!(0.0..=1.0).contains(&p.x)||!(0.0..=1.0).contains(&p.y))) {
        return Err("The video annotations are invalid.".into());
    } Ok(())
}
pub struct Prepared { start:f64, end:f64, pixels:Vec<(u32,u32,[u8;3],f64)> }
pub fn prepare(items:&[Annotation],width:u32,height:u32)->Result<Vec<Prepared>,String> {
    let mut total=0usize;
    items.iter().map(|a| {
        let data=a.raster.as_deref().and_then(|s|s.strip_prefix("data:image/png;base64,")).ok_or("Prepare video annotations before exporting.")?;
        if data.len()>3_000_000 {return Err("An annotation image is too large.".into());}
        let bytes=base64::engine::general_purpose::STANDARD.decode(data).map_err(|_|"Invalid annotation image")?;
        let mut reader=ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;
        let mut limits=image::Limits::default();limits.max_image_width=Some(2048);limits.max_image_height=Some(2048);limits.max_alloc=Some(32*1024*1024);reader.limits(limits);
        let image=reader.decode().map_err(|e|format!("Invalid annotation image: {e}"))?.to_rgba8();
        let image=image::imageops::resize(&image,width,height,image::imageops::FilterType::Triangle);
        let mut pixels=vec![];
        for(x,y,p)in image.enumerate_pixels(){if p[3]>0 {total+=1;if total>8_000_000{return Err("Too much annotation ink in this export. Remove some marks or reduce the output size.".into());}pixels.push((x,y,[p[0],p[1],p[2]],p[3] as f64/255.));}}
        Ok(Prepared{start:a.start,end:a.end,pixels})
    }).collect()
}
pub fn paint(items:&[Prepared],time:f64,out:&mut RgbImage) {
    for a in items {if time>=a.start&&time<a.end {for(x,y,color,alpha)in &a.pixels {let pixel=out.get_pixel_mut(*x,*y);for k in 0..3{pixel[k]=(pixel[k] as f64*(1.-alpha)+color[k] as f64*alpha).round() as u8;}}}}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn exported_pixels_follow_annotation_time_and_alpha() {
        let layer=Prepared{start:1.,end:2.,pixels:vec![(1,1,[255,0,0],0.5)]};
        for(t,expected)in [(0.9,[0,0,0]),(1.,[128,0,0]),(1.9,[128,0,0]),(2.,[0,0,0])] {
            let mut image=RgbImage::new(3,3);paint(std::slice::from_ref(&layer),t,&mut image);assert_eq!(image.get_pixel(1,1).0,expected);
        }
    }
    #[test] fn rejects_invalid_saved_vectors() {
        let a:Annotation=serde_json::from_value(serde_json::json!({"id":"a","kind":"arrow","start":0.,"end":2.,"points":[{"x":0.2,"y":0.3}],"color":"#ffffff","width":0.006,"size":0.05,"text":""})).unwrap();
        assert!(validate(std::slice::from_ref(&a),2.).is_ok());let mut bad=a.clone();bad.points[0].x=2.;assert!(validate(&[bad],2.).is_err());assert!(prepare(&[a],20,20).is_err());
    }
}
