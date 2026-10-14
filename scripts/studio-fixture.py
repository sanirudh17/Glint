"""Generate local-only acceptance media with synchronized flash/beep markers."""
import json, pathlib, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
work = pathlib.Path(tempfile.mkdtemp(prefix='glint-studio-acceptance-'))
folder = work/'Demo.glint-studio'; folder.mkdir()
ff = root/'glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe'
video = "testsrc2=size=1920x1080:rate=60,drawbox=x=900:y=480:w=80:h=80:color=white:t=fill:enable='lt(mod(t,10),0.1)'"
audio = "aevalsrc=if(lt(mod(t\\,10)\\,0.1)\\,0.8*sin(2*PI*1000*t)\\,0):s=48000"
subprocess.run([str(ff),'-y','-v','error','-f','lavfi','-i',video,'-f','lavfi','-i',audio,'-t','60','-c:v','libx264','-preset','ultrafast','-crf','21','-c:a','aac',str(folder/'video.mp4')],check=True)
project = {'version':1,'look':{'enabled':True,'background':{'type':'gradient','gradientId':'dusk'},'padding':40,'radius':12,'shadow':35,'aspect':'16:9','chrome':{'style':'none','theme':'light','buttons':'mac','title':'','url':''}},'cursor':{'visible':True,'smoothing':.5,'size':32,'style':'arrow','hideIdle':True,'idleSeconds':2,'clicks':True,'clickSize':36,'keystrokes':False},'crop':None,'clips':[{'id':1,'start':0,'end':60,'speed':1,'kept':True,'order':0}],'fadeIn':0,'fadeOut':0,'cam':None,'zoomSegments':[],'masks':[]}
(folder/'project.json').write_text(json.dumps(project,indent=2))
events=[]
for i in range(7201):
 t=i/120
 # Coordinates are global physical pixels on a negative-origin, scaled monitor.
 events.append({'t':t,'kind':'cursor','x':-1920+300+(i%1200)*.75,'y':100+300+(i%240)*.4})
for t in range(1,60,5): events.append({'t':t,'kind':'click','x':-1920+500,'y':100+500,'button':'left'})
for t in range(2,60,10): events.append({'t':t,'kind':'key','text':'A','isModifier':False,'down':True,'modifiers':['Ctrl']})
events.sort(key=lambda e:e['t'])
(folder/'events.json').write_text(json.dumps({'version':1,'geometry':{'x':-1920,'y':100,'width':1920,'height':1080,'monitorX':-1920,'monitorY':0,'monitorWidth':1920,'monitorHeight':1080,'dpiScale':1.5},'events':events}))
from PIL import Image, ImageDraw
image=Image.new('RGB',(800,450),'#eeeeee');draw=ImageDraw.Draw(image);draw.rectangle((100,100,700,350),fill='#40516c');draw.text((140,150),'Glint screenshot compatibility fixture',fill='white');image.save(work/'screenshot.png')
(work/'fixture.json').write_text(json.dumps({'source':str(folder/'video.mp4'),'root':str(work)},indent=2))
print(json.dumps({'source':str(folder/'video.mp4'),'root':str(work)}),flush=True)
