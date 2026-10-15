use std::{ops::Range,sync::{LazyLock,Mutex,Arc,atomic::{AtomicBool,Ordering}}};
use regex::Regex;
use tauri::Manager;
use base64::Engine;
use super::words::Word;

#[derive(Clone,Debug,serde::Serialize)]
pub struct Suggestion {pub kind:String,pub x:f64,pub y:f64,pub w:f64,pub h:f64}

pub fn luhn(text:&str)->bool{
    let digits:Vec<u32>=text.chars().filter_map(|c|c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len())||digits.iter().all(|d|*d==digits[0]){return false;}
    digits.iter().rev().enumerate().map(|(i,d)|{let v=if i%2==1{d*2}else{*d};if v>9{v-9}else{v}}).sum::<u32>()%10==0
}
pub fn ranges(text:&str)->Vec<(Range<usize>,&'static str)>{
    static PATTERNS:LazyLock<Vec<(&str,Regex)>>=LazyLock::new(||vec![
        ("Card number",Regex::new(r"\b(?:[0-9]{4}[ -]){3}[0-9]{1,7}\b|\b[0-9]{13,19}\b|\b[0-9]{4}[ -][0-9]{6}[ -][0-9]{5}\b").unwrap()),
        ("Email",Regex::new(r"(?i)\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\b").unwrap()),
        ("API key",Regex::new(r"\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})\b").unwrap()),
        ("JWT",Regex::new(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b").unwrap()),
        ("IP address",Regex::new(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b|\b(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}\b").unwrap()),
        ("Phone",Regex::new(r"(?:\+?[0-9]{1,3}[ .-]?)?(?:\([0-9]{2,4}\)|[0-9]{2,4})[ .-][0-9]{3,4}[ .-][0-9]{3,4}\b|\b[0-9]{10,15}\b").unwrap()),
    ]);
    let mut found:Vec<(Range<usize>,&str)>=vec![];
    for(kind,re)in PATTERNS.iter(){for m in re.find_iter(text){
        if *kind=="Card number"&&!luhn(m.as_str()){continue;}
        if *kind=="Phone"&&!(7..=15).contains(&m.as_str().bytes().filter(|c|c.is_ascii_digit()).count()){continue;}
        if *kind=="IP address"&&m.as_str().parse::<std::net::IpAddr>().is_err(){continue;}
        if found.iter().any(|(r,_)|r.start<m.end()&&m.start()<r.end){continue;}
        found.push((m.range(),kind));
    }}found.sort_by_key(|v|v.0.start);found
}
pub fn detect(words:&[Word],width:u32,height:u32)->Vec<Suggestion>{
    let mut out=vec![];let mut start=0;
    while start<words.len(){
        let mut end=start+1;while end<words.len()&&words[end].line==words[start].line{end+=1;}
        let mut text=String::new();let mut spans=vec![];
        for word in &words[start..end]{if !text.is_empty(){text.push(' ');}let begin=text.len();text.push_str(&word.text);spans.push((begin..text.len(),word));}
        for(range,kind)in ranges(&text){
            let matched:Vec<_>=spans.iter().filter(|(r,_)|r.start<range.end&&range.start<r.end).map(|(_,w)|*w).collect();
            if matched.is_empty(){continue;}
            let x=(matched.iter().map(|w|w.x).fold(f64::INFINITY,f64::min)-4.).max(0.);
            let y=(matched.iter().map(|w|w.y).fold(f64::INFINITY,f64::min)-4.).max(0.);
            let right=(matched.iter().map(|w|w.x+w.w).fold(0.,f64::max)+4.).min(width as f64);
            let bottom=(matched.iter().map(|w|w.y+w.h).fold(0.,f64::max)+4.).min(height as f64);
            if right>x&&bottom>y{out.push(Suggestion{kind:kind.into(),x,y,w:right-x,h:bottom-y});}
        }start=end;
    }out
}

#[derive(Default)]pub struct ScanState(pub Mutex<Option<(String,Arc<AtomicBool>)>>);
#[tauri::command]pub fn privacy_cancel(app:tauri::AppHandle,request_id:String){
    if let Some((id,cancel))=&*app.state::<ScanState>().0.lock().unwrap(){if *id==request_id{cancel.store(true,Ordering::Relaxed);}}
}
#[tauri::command(async)]pub fn privacy_scan(app:tauri::AppHandle,png_base64:String,request_id:String)->Result<Vec<Suggestion>,String>{
    let cancel=Arc::new(AtomicBool::new(false));
    {let state=app.state::<ScanState>();let mut job=state.0.lock().unwrap();if let Some((_,old))=job.take(){old.store(true,Ordering::Relaxed);}*job=Some((request_id.clone(),cancel.clone()));}
    let result=(||{
        if png_base64.len()>45_000_000{return Err("Choose a smaller screenshot".into());}
        let bytes=base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|_|"Couldn't read this screenshot")?;
        let mut reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|_|"Couldn't read this screenshot")?;
        let mut limits=image::Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(4096);reader.limits(limits);
        let image=reader.decode().map_err(|_|"Choose an image no larger than 4,096 pixels per side")?.to_rgba8();
        let words=super::words::recognize(&image,image.width(),image.height(),&cancel)?;
        if cancel.load(Ordering::Relaxed){return Err("Cancelled".into());}
        Ok(detect(&words,image.width(),image.height()))
    })();
    {let state=app.state::<ScanState>();let mut job=state.0.lock().unwrap();if job.as_ref().is_some_and(|j|j.0==request_id){*job=None;}}
    result
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn validates_cards_and_rejects_lookalikes(){assert!(luhn("4111 1111 1111 1111"));assert!(!luhn("4111 1111 1111 1112"));assert!(!luhn("0000000000000000"));}
    #[test]fn detects_every_required_kind_without_duplicate_card_phone(){
        let text="mail@sample.test 4111 1111 1111 1111 +1 (415) 555-0172 192.168.1.10 2001:db8::1 sk-proj-ABCDEFGHIJKLMNOP123456789 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ABCDEFGHIJKLMNOP";
        let found=ranges(text);for kind in ["Email","Card number","Phone","IP address","API key","JWT"]{assert!(found.iter().any(|v|v.1==kind),"{kind}");}assert_eq!(found.iter().filter(|v|v.1=="Card number").count(),1);
        assert!(!ranges("Version 999.400.3.500 and 4111111111111112").iter().any(|v|v.1=="IP address"||v.1=="Card number"));
    }
    #[test]fn maps_unicode_and_multiword_cards_to_padded_boxes(){
        let words=[("é",0.),("4111",20.),("1111",60.),("1111",100.),("1111",140.)].map(|(text,x)|Word{text:text.into(),line:"1".into(),x,y:10.,w:32.,h:16.});
        let s=detect(&words,200,100);assert_eq!(s.len(),1);assert_eq!(s[0].kind,"Card number");assert_eq!((s[0].x,s[0].y,s[0].w,s[0].h),(16.,6.,160.,24.));
    }
}
