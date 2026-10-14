// Standalone std-only CPU compositor probe. rustc -O; no shipped dependencies.
use std::io::{Read, Write};
use std::process::{Command, Stdio};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut decode = Command::new(&a[1]).args(["-v","error","-i",&a[2],"-an","-vf","scale=1600:900","-pix_fmt","rgb24","-f","rawvideo","pipe:1"])
        .stdout(Stdio::piped()).spawn().unwrap();
    let mut encode = Command::new(&a[1]).args(["-y","-v","error","-f","rawvideo","-pixel_format","rgb24","-video_size","1920x1080","-framerate","60","-i","pipe:0","-i",&a[2],"-map","0:v","-map","1:a","-c:v","libx264","-preset","ultrafast","-crf","21","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",&a[3]])
        .stdin(Stdio::piped()).spawn().unwrap();
    let mut input=decode.stdout.take().unwrap(); let mut output=encode.stdin.take().unwrap();
    let mut raw=vec![0u8;1600*900*3]; let mut frame=vec![0u8;1920*1080*3];
    for y in 0..1080 { for x in 0..1920 { let i=(y*1920+x)*3; let t=(x+y) as f32/3000.; frame[i]=(40.+50.*t) as u8; frame[i+1]=(55.+35.*t) as u8; frame[i+2]=(100.+60.*t) as u8; }}
    // Cache a soft offset shadow once; frame copies never recompute it.
    for y in 0..1080 { for x in 0..1920 { let dx=(x as f32-960.).abs()-800.; let dy=(y as f32-554.).abs()-450.; let dist=dx.max(0.).hypot(dy.max(0.)); let alpha=0.35*(-dist*dist/288.).exp(); let i=(y*1920+x)*3; for c in 0..3 {frame[i+c]=(frame[i+c] as f32*(1.-alpha)) as u8;} }}
    let mut ranges=Vec::new();
    for y in 0..900 { let edge=if y<54 {54-y} else if y>=846 {y-845} else {0}; let inset=if edge>0 {54-((54*54-edge*edge) as f64).sqrt() as usize} else {0}; ranges.push(inset); }
    while input.read_exact(&mut raw).is_ok() {
        for (y,inset) in ranges.iter().copied().enumerate() {let start=(y*1600+inset)*3; let end=(y*1600+1600-inset)*3; let dst=((y+90)*1920+160+inset)*3; frame[dst..dst+end-start].copy_from_slice(&raw[start..end]);}
        output.write_all(&frame).unwrap();
    }
    drop(output); assert!(decode.wait().unwrap().success()); assert!(encode.wait().unwrap().success());
}
