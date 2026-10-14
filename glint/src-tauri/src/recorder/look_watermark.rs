//! A small rasterized text stamp preserves the exact chosen font across runtimes.
use serde_json::Value;
use base64::Engine;
pub fn pixels(wm:Option<&Value>,w:u32,h:u32)->Result<Vec<(u32,u32,[u8;3],f64)>,String>{
    let Some(wm)=wm else{return Ok(vec![])};
    let opacity=wm["opacity"].as_f64().unwrap_or(0.75);
    if !(0. ..=1.).contains(&opacity){return Err("Invalid watermark opacity".into());}
    let url=wm["dataUrl"].as_str().ok_or("Invalid watermark image")?;
    let bytes=base64::engine::general_purpose::STANDARD.decode(url.split_once(',').ok_or("Invalid watermark image")?.1).map_err(|e|e.to_string())?;
    if bytes.len()>1024*1024{return Err("Watermark image is too large".into());}
    let mut reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;
    let mut limits=image::Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(256);reader.limits(limits);
    let image=reader.decode().map_err(|e|e.to_string())?.to_rgba8();
    let margin=12f64.max(w.min(h) as f64*0.025);let height=12f64.max(w.min(h) as f64*0.035);
    let width=(w as f64-margin*2.).min(height*image.width() as f64/image.height() as f64).max(1.);
    let height=width*image.height() as f64/image.width() as f64;
    let left=if wm["position"].as_str()==Some("bottom-left"){margin}else{w as f64-margin-width};
    let top=h as f64-margin-height;
    let stamp=image::imageops::resize(&image,width.round().max(1.) as u32,height.round().max(1.) as u32,image::imageops::FilterType::Triangle);
    Ok(stamp.enumerate_pixels().filter_map(|(x,y,p)|{let (px,py)=(left.round() as i32+x as i32,top.round() as i32+y as i32);(p[3]>0&&px>=0&&py>=0&&px<(w as i32)&&py<(h as i32)).then_some((px as u32,py as u32,[p[0],p[1],p[2]],p[3] as f64/255.*opacity))}).collect())
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn decoded_stamp_preserves_alpha_and_position(){
        let stamp=image::RgbaImage::from_pixel(100,20,image::Rgba([255,0,0,128]));let mut bytes=std::io::Cursor::new(vec![]);stamp.write_to(&mut bytes,image::ImageFormat::Png).unwrap();
        let wm=serde_json::json!({"dataUrl":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())),"opacity":0.5,"position":"bottom-left"});
        let p=pixels(Some(&wm),1200,630).unwrap();assert_eq!((p[0].0,p[0].1),(16,592));assert_eq!(p[0].2,[255,0,0]);assert!((p[0].3-128./255.*0.5).abs()<1e-9);
    }
}
