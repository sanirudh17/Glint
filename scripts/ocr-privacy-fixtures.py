"""Generate owned privacy fixtures. Validation-only Pillow dependency."""
import json,os
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(os.environ['LOCALAPPDATA'])/'GlintValidation/OcrUpgrade'
ROOT.mkdir(parents=True,exist_ok=True)
ITEMS=[('Email','Email: ','hello@example.com'),('Card number','Card: ','4111 1111 1111 1111'),('Phone','Phone: ','+1 415 555 0199'),('IP address','IP: ','192.168.1.100'),('API key','Key: ','sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'),('JWT','Token: ','eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345')]
cases=[]
def fixture(name,size,font_size,positions,theme,scale=1):
 im=Image.new('RGB',size,'#101113' if theme=='dark' else 'white');draw=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',font_size);bounds=[]
 for (kind,label,value),(x,y) in zip(ITEMS,positions):
  draw.text((x,y),label+value,font=font,fill='#e8e8ed' if theme=='dark' else '#111111')
  box=draw.textbbox((x+font.getlength(label),y),value,font=font)
  bounds.append({'kind':kind,'box':[v*scale for v in box]})
 if scale!=1:im=im.resize((round(im.width*scale),round(im.height*scale)),Image.Resampling.LANCZOS)
 im.save(ROOT/name);cases.append({'file':name,'bounds':bounds})
for theme in ['light','dark']:
 for scale in [1,.75,.5]:fixture(f'privacy-{scale}-{theme}.png',(1100,300),22,[(20,14+i*44) for i in range(6)],theme,scale)
 fixture(f'privacy-full-{theme}.png',(1920,1080),11,[(30,100+i*35) for i in range(6)],theme)
 fixture(f'privacy-tall-{theme}.png',(1900,2300),14,[(40,y) for y in [890,940,1000,1780,1830,1910]],theme)
(ROOT/'privacy-fixtures.json').write_text(json.dumps(cases,indent=2))
print(f'Generated {len(cases)} owned fixtures at {ROOT}')
