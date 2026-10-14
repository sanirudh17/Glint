"""Reproducible 60-second 1080p60 compositor comparison; artifacts stay in temp."""
import json, pathlib, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
ff = root / 'glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe'
work = pathlib.Path(tempfile.mkdtemp(prefix='glint-studio-spike-'))
def run(args, timeout=None):
    start=time.perf_counter()
    subprocess.run([str(ff),'-y','-v','error',*args],check=True,timeout=timeout)
    return round(time.perf_counter()-start,3)
print(f'Artifacts: {work}',flush=True)
source=work/'source.mp4'
run(['-f','lavfi','-i','testsrc2=size=1920x1080:rate=60','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','60','-c:v','libx264','-preset','ultrafast','-crf','21','-c:a','aac',str(source)])
graph="[0:v]scale=1600:900,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(max(abs(X-800)-746,0),max(abs(Y-450)-396,0)),54),255,0)',split[card][s];[s]lutrgb=r=0:g=0:b=0,gblur=sigma=12[shadow];color=c=0x354469:s=1920x1080:r=60[bg];[bg][shadow]overlay=160:104[b];[b][card]overlay=160:90[out]"
try:
    graph_secs=run(['-i',str(source),'-filter_complex_threads','4','-filter_complex',graph,'-map','[out]','-map','0:a','-t','60','-c:v','libx264','-preset','ultrafast','-crf','21','-pix_fmt','yuv420p','-c:a','aac',str(work/'graph.mp4')],120)
except subprocess.TimeoutExpired:
    graph_secs='exceeded 120-second timebox'
print(f'FFmpeg graph: {graph_secs}s',flush=True)
probe=work/'probe.exe'
subprocess.run(['rustc','-O',str(root/'spike/studio_compositor_probe.rs'),'-o',str(probe)],check=True)
start=time.perf_counter();subprocess.run([str(probe),str(ff),str(source),str(work/'rust.mp4')],check=True)
cpu_secs=round(time.perf_counter()-start,3)
result={'duration':60,'fps':60,'source':'1920x1080','content':'1600x900','output':'1920x1080','graph_seconds':graph_secs,'rust_seconds':cpu_secs,'artifacts':str(work),'note':'CPU prototype uses a cached background and row spans; graph recomputes RGBA corner mask and shadow. Final pipeline must add cached soft shadow and layers.'}
(root/'docs/STUDIO_COMPOSITOR_SPIKE.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
