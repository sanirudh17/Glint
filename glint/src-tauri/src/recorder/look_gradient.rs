//! Procedural cached backdrops. Keep pixel math in sync with look/gradientRender.ts.
use image::{Rgb, RgbImage};
use serde::Deserialize;
use serde_json::Value;
use super::studio_render::color;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Preset { id:String, angle_deg:f64, stops:Vec<Stop> }
#[derive(Deserialize)]
struct Stop { offset:f64, color:String }
pub fn paint(bg:&Value, plate:&mut RgbImage)->Result<(),String> {
    let presets:Vec<Preset>=serde_json::from_str(include_str!("../../../src/look/gradients.json")).map_err(|e|e.to_string())?;
    let preset=presets.iter().find(|p|Some(p.id.as_str())==bg["gradientId"].as_str()).unwrap_or(&presets[0]);
    let custom:Option<Vec<Stop>>=bg.get("stops").map(|v|serde_json::from_value(v.clone()).map_err(|e|e.to_string())).transpose()?;
    let stops=custom.as_ref().unwrap_or(&preset.stops);
    if !(2..=3).contains(&stops.len()) || stops.first().unwrap().offset!=0. || stops.last().unwrap().offset!=1. || stops.windows(2).any(|s|!s[1].offset.is_finite() || s[1].offset<=s[0].offset) {return Err("Use two or three ordered gradient colors".into());}
    let stops:Vec<_>=stops.iter().map(|s|Ok((s.offset,color(&s.color)?))).collect::<Result<_,String>>()?;
    let angle=bg["angleDeg"].as_f64().unwrap_or(preset.angle_deg);
    let grain=bg["grain"].as_f64().unwrap_or(0.);
    let kind=bg["kind"].as_str().unwrap_or("linear");
    if !(0. ..=360.).contains(&angle)||!(0. ..=1.).contains(&grain)||!matches!(kind,"linear"|"radial"|"conic"|"mesh") {return Err("Invalid gradient settings".into());}
    let angle=angle.to_radians();let (dx,dy)=(angle.cos(),angle.sin());
    let (w,h)=(plate.width() as f64,plate.height() as f64);let len=dx.abs()*w+dy.abs()*h;
    for(x,y,p) in plate.enumerate_pixels_mut() {
        let (px,py)=(x as f64-w/2.,y as f64-h/2.);
        let t=match kind {"radial"=>px.hypot(py)/(w.hypot(h)/2.),"conic"=>((py.atan2(px)-angle)/std::f64::consts::TAU).rem_euclid(1.),_ => (px*dx+py*dy)/len+0.5}.clamp(0.,1.);
        let a=stops.iter().rev().find(|s|s.0<=t).unwrap_or(&stops[0]);let b=stops.iter().find(|s|s.0>=t).unwrap_or(stops.last().unwrap());
        let f=if b.0>a.0 {(t-a.0)/(b.0-a.0)}else{0.};let mut c=[0.,0.,0.];
        for i in 0..3 {c[i]=a.1[i] as f64+(b.1[i] as f64-a.1[i] as f64)*f;}
        if kind=="mesh" {
            c=stops[0].1.map(|v|v as f64);
            for(i,s) in stops.iter().enumerate(){let theta=angle+i as f64*std::f64::consts::TAU/stops.len() as f64;let (cx,cy)=(0.5+0.38*theta.cos(),0.5+0.38*theta.sin());let weight=(1.-(x as f64/w-cx).hypot(y as f64/h-cy)/0.9).max(0.)*0.85;for k in 0..3 {c[k]+=(s.1[k] as f64-c[k])*weight;}}
        }
        let gx=(x as f64/w*1024.).floor() as u32;let gy=(y as f64/h*1024.).floor() as u32;
        let mut n=(gx+1).wrapping_mul(374761393).wrapping_add((gy+1).wrapping_mul(668265263));n=(n^(n>>13)).wrapping_mul(1274126177);
        let noise=((n^(n>>16))%256) as f64/255.-0.5;
        *p=Rgb(c.map(|v|(v+noise*grain*80.).clamp(0.,255.).round() as u8));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn gradient_types_and_grain_reach_pixels(){
        let mut p=RgbImage::new(100,100);
        for kind in ["linear","radial","conic","mesh"] {
            let bg=serde_json::json!({"type":"gradient","gradientId":"dusk","kind":kind,"angleDeg":0,"stops":[{"offset":0,"color":"#000000"},{"offset":0.5,"color":"#ff0000"},{"offset":1,"color":"#ffffff"}]});
            paint(&bg,&mut p).unwrap();let flat=p.clone();let mut noisy=bg.clone();noisy["grain"]=serde_json::json!(0.5);paint(&noisy,&mut p).unwrap();assert_ne!(p,flat);assert_eq!(flat.get_pixel(50,50).0,match kind {"linear"=>[255,0,0],"radial"|"conic"=>[0,0,0],_=>[189,125,125]});
        }
    }
    #[test]fn invalid_stops_are_rejected(){let mut p=RgbImage::new(2,2);assert!(paint(&serde_json::json!({"stops":[]}),&mut p).is_err());}
}
