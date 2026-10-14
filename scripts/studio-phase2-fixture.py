"""Local synthetic privacy/zoom fixture. Contains no real credential or user media."""
import json, math, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
repo = Path(__file__).resolve().parent.parent
root = Path(tempfile.mkdtemp(prefix='glint-phase2-'))
folder = root / 'Privacy test.glint-studio'
folder.mkdir()
image = Image.new('RGB', (640, 360), '#ffffff')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype(r'C:\Windows\Fonts\consola.ttf', 24)
draw.text((60, 40), 'STUDIO PRIVACY FIXTURE', font=font, fill='#202020')
draw.text((60, 130), 'APIKEY DEMO-ONLY-123456', font=font, fill='#000000')
draw.rectangle((40, 240, 140, 300), fill='#2288cc')
draw.rectangle((180, 240, 280, 300), fill='#cc8833')
image.save(root / 'source.png')
ffmpeg = repo / 'glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe'
source = folder / 'video.mp4'
subprocess.run([str(ffmpeg), '-v', 'error', '-loop', '1', '-framerate', '15', '-i', str(root/'source.png'), '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', str(source)], check=True)
events = [{'kind':'cursor','t':i/120,'x':-1000+1.5*(320+220*math.sin(i/120*2)), 'y':100+1.5*(180+80*math.cos(i/120*3))} for i in range(1441)]
for t in [1, 1.25, 3.5, 3.75, 6, 6.25, 9, 9.25]:
    events.append({'kind':'click','t':t,'x':-520,'y':340,'button':'left'})
events.sort(key=lambda e:e['t'])
(folder/'events.json').write_text(json.dumps({'version':1,'geometry':{'x':-1000,'y':100,'width':960,'height':540,'monitorX':-1000,'monitorY':0,'monitorWidth':1920,'monitorHeight':1080,'dpiScale':1.5},'events':events}), encoding='utf-8')
project = {'version':2,'look':{'enabled':True,'background':{'type':'solid','color':'#101319'},'padding':20,'radius':12,'shadow':15,'aspect':'16:9','chrome':{'style':'none','theme':'light','buttons':'mac','title':'','url':''}},'cursor':{'visible':False,'smoothing':.5,'size':32,'style':'arrow','hideIdle':False,'idleSeconds':2,'clicks':False,'clickSize':36,'keystrokes':False},'crop':None,'clips':[{'id':1,'start':0,'end':3,'speed':1,'kept':True,'order':0}],'fadeIn':0,'fadeOut':0,'cam':None,'zoomSegments':[],'masks':[],'motionBlur':{'enabled':False,'intensity':.35},'importedMarkers':[]}
(folder/'project.json').write_text(json.dumps(project), encoding='utf-8')
(root/'fixture.json').write_text(json.dumps({'root':str(root),'source':str(source),'project':project}), encoding='utf-8')
print(json.dumps({'root':str(root),'source':str(source)}))
