"""Synthetic privacy fixture. Values are fake test data; no user media is read."""
import json, pathlib, tempfile, base64
from PIL import Image, ImageDraw, ImageFont, ImageOps
root=pathlib.Path(tempfile.mkdtemp(prefix='glint-phase4-'))
image=Image.new('RGB',(1600,760),'white');draw=ImageDraw.Draw(image)
font=ImageFont.truetype(r'C:\Windows\Fonts\consola.ttf',32)
lines=['Phase four acceptance','otterfjordmineral','Email: mail@sample.test','Card: 4111 1111 1111 1111','Phone: +1 (415) 555-0172','Server: 192.0.2.10','Key: sk-proj-ABCDEFGHIJKLMNOP123456789','Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ABCDEFGHIJKLMNOP']
for i,line in enumerate(lines):
    face=font if i<7 else ImageFont.truetype(r'C:\Windows\Fonts\consola.ttf',22)
    draw.text((40,30+i*80),line,fill='black',font=face)
image.save(root/'source.png')
for scale in (1, .75, .5):
    small=image.resize((round(image.width*scale),round(image.height*scale)),Image.Resampling.BICUBIC)
    for theme in ('light','dark'):
        (ImageOps.invert(small) if theme=='dark' else small).save(root/f'tokens-{scale}-{theme}.png')
doc={'annotations':[],'crop':None,'frame':{'enabled':False,'background':{'type':'gradient','gradientId':'dusk'},'padding':40,'radius':12,'shadow':35,'aspect':'auto','chrome':{'style':'none','theme':'light','buttons':'mac','title':'','url':''}}}
project={'glint':1,'app':'0.1.14','image':{'mime':'image/png','width':1600,'height':760,'dataBase64':base64.b64encode((root/'source.png').read_bytes()).decode()},'doc':doc}
(root/'Privacy.glint').write_text(json.dumps(project),encoding='utf-8')
(root/'validation.conf.json').write_text(json.dumps({'identifier':'com.glint.validation.phase4','productName':'Glint Phase 4 Check'}),encoding='utf-8')
print(json.dumps({'root':str(root),'project':str(root/'Privacy.glint')}))
