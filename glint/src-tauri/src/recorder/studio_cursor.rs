//! Pure event-layer math. Source time and physical screen geometry are kept
//! separate from output canvas coordinates, so edits never move the cursor.
use serde::Deserialize;
use super::studio::Events;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct CursorConfig {
    pub visible:bool,pub smoothing:f64,pub size:f64,pub style:String,
    #[serde(default)] pub spotlight:bool,
    #[serde(default="default_recorded_effects")] pub recorded_effects:bool,
    pub hide_idle:bool,pub idle_seconds:f64,pub clicks:bool,pub click_size:f64,pub keystrokes:bool,
}
fn default_recorded_effects()->bool {true}
pub fn recorded_config(base:&CursorConfig,events:&[super::studio::InputEvent],time:f64)->CursorConfig {
    let mut config=base.clone();
    if config.recorded_effects {if let Some(event)=events.get(..events.partition_point(|e|e.t<=time)).and_then(|e|e.last()) {
        config.clicks &= event.data["clicks"].as_bool().unwrap_or(true);
        config.keystrokes &= event.data["keystrokes"].as_bool().unwrap_or(true);
        config.spotlight &= event.data["spotlight"].as_bool().unwrap_or(true);
    }}config
}
impl CursorConfig {
    pub fn validate(&self)->Result<(),String> {
        if !(0.0..=1.0).contains(&self.smoothing) || !(12.0..=96.0).contains(&self.size) || !(12.0..=96.0).contains(&self.click_size) || !(0.1..=60.0).contains(&self.idle_seconds) || !matches!(self.style.as_str(),"arrow"|"dot") {return Err("Invalid cursor settings".into());} Ok(())
    }
}
#[derive(Clone,Copy,Debug)]
pub struct Point {pub t:f64,pub x:f64,pub y:f64,pub moved_at:f64}
pub fn smooth_path(events:&Events,intensity:f64)->Vec<Point> {
    let mut raw:Vec<Point>=events.events.iter().filter_map(|e| {
        (e.data["kind"]=="cursor").then(||Some(Point {t:e.t,x:e.data["x"].as_f64()?,y:e.data["y"].as_f64()?,moved_at:e.t})).flatten()
    }).collect();
    raw.sort_by(|a,b|a.t.total_cmp(&b.t));
    let mut out=Vec::with_capacity(raw.len());let mut moved=raw.first().map(|p|p.t).unwrap_or(0.0);
    let (mut x,mut y)=raw.first().map(|p|(p.x,p.y)).unwrap_or((0.0,0.0));
    for (i,p) in raw.iter().enumerate() {
        let prev=i.checked_sub(1).map(|i|raw[i]);
        if prev.is_some_and(|prev|(p.x-prev.x).abs()>0.75||(p.y-prev.y).abs()>0.75) {moved=p.t;}
        let dt=prev.map(|prev|(p.t-prev.t).max(0.0)).unwrap_or(0.0);
        let alpha=if intensity<=0.0||prev.is_none(){1.0}else{1.0-(-dt/(0.02+0.18*intensity)).exp()};
        x+=(p.x-x)*alpha;y+=(p.y-y)*alpha;out.push(Point{t:p.t,x,y,moved_at:moved});
    } out
}
pub fn point_at(path:&[Point],t:f64)->Option<Point> {
    if path.is_empty(){return None;}
    let idx=path.partition_point(|p|p.t<=t);let a=path[idx.saturating_sub(1)];let b=path[idx.min(path.len()-1)];
    let f=if b.t>a.t {((t-a.t)/(b.t-a.t)).clamp(0.0,1.0)}else{0.0};
    Some(Point{t,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,moved_at:a.moved_at})
}
#[derive(Clone,Copy)]
pub struct Mapping {pub source_w:f64,pub source_h:f64,pub crop_x:f64,pub crop_y:f64,pub x:f64,pub y:f64,pub w:f64,pub h:f64,pub scale:f64}
impl Mapping {
    pub fn point(&self,x:f64,y:f64,events:&Events)->(f64,f64) {
        let g=&events.geometry;
        (self.x+((x-g.x as f64)*self.source_w/g.width as f64-self.crop_x)*self.scale,
         self.y+((y-g.y as f64)*self.source_h/g.height as f64-self.crop_y)*self.scale)
    }
    pub fn inside(&self,x:f64,y:f64)->bool {x>=self.x&&y>=self.y&&x<self.x+self.w&&y<self.y+self.h}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn interpolation_and_idle_are_independent() {
        let path=vec![Point{t:0.,x:0.,y:0.,moved_at:0.},Point{t:1.,x:100.,y:50.,moved_at:0.}];
        let p=point_at(&path,0.5).unwrap();assert_eq!(p.x,50.);assert_eq!(p.y,25.);assert_eq!(p.moved_at,0.);
    }
    #[test] fn dpi_crop_and_negative_origin_align() {
        let events:Events=serde_json::from_value(serde_json::json!({"version":1,"geometry":{"x":-1500,"y":200,"width":1200,"height":800,"monitorX":-1920,"monitorY":0,"monitorWidth":1920,"monitorHeight":1080,"dpiScale":2.0},"events":[]})).unwrap();
        let m=Mapping{source_w:600.,source_h:400.,crop_x:100.,crop_y:50.,x:20.,y:30.,w:400.,h:300.,scale:0.5};
        assert_eq!(m.point(-900.,600.,&events),(120.,105.));
    }

    #[test] fn recording_toggles_obey_source_time_and_keep_editor_override() {
        let mut c:CursorConfig=serde_json::from_value(serde_json::json!({"visible":true,"smoothing":0.5,"size":32.,"style":"arrow","hideIdle":true,"idleSeconds":2.,"clicks":true,"clickSize":36.,"keystrokes":true,"spotlight":true})).unwrap();
        let events:Vec<super::super::studio::InputEvent>=serde_json::from_value(serde_json::json!([{"t":0.,"kind":"effects","clicks":false,"keystrokes":false,"spotlight":false},{"t":2.,"kind":"effects","clicks":true,"keystrokes":true,"spotlight":true}])).unwrap();
        assert!(!recorded_config(&c,&events,1.).clicks);assert!(recorded_config(&c,&events,2.).keystrokes);
        c.spotlight=false;assert!(!recorded_config(&c,&events,3.).spotlight);
        c.recorded_effects=false;assert!(recorded_config(&c,&events,0.).clicks);
    }
}
