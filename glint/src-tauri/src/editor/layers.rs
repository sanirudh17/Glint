use base64::Engine;
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct LayerImage {data_url:String,width:u32,height:u32,name:String}
#[tauri::command]
pub async fn editor_read_layer(path:String)->Result<LayerImage,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let path=std::path::Path::new(&path);let length=std::fs::metadata(path).map_err(|e|e.to_string())?.len();
        if length>15*1024*1024{return Err("Choose an image smaller than 15 MB".into());}
        let mut reader=image::ImageReader::open(path).map_err(|e|e.to_string())?.with_guessed_format().map_err(|e|e.to_string())?;
        if !matches!(reader.format(),Some(image::ImageFormat::Png|image::ImageFormat::Jpeg|image::ImageFormat::WebP)){return Err("Choose a PNG, JPEG or WebP image".into());}
        let mut limits=image::Limits::default();limits.max_image_width=Some(8192);limits.max_image_height=Some(8192);reader.limits(limits);
        let image=reader.decode().map_err(|e|e.to_string())?;let (width,height)=(image.width(),image.height());let mut png=std::io::Cursor::new(vec![]);image.write_to(&mut png,image::ImageFormat::Png).map_err(|e|e.to_string())?;
        Ok(LayerImage{data_url:format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png.into_inner())),width,height,name:path.file_name().unwrap_or_default().to_string_lossy().into_owned()})
    }).await.map_err(|e|e.to_string())?
}
