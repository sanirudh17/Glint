"""Owned screenshot corpus with a seeded fake key/token and exact references."""
import json,os,random,string
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(os.environ['LOCALAPPDATA'])/'GlintValidation/OcrUpgrade';root.mkdir(parents=True,exist_ok=True);rng=random.Random(20261022)
key='sk-proj-'+''.join(rng.choice(string.ascii_letters+string.digits) for _ in range(40))
token='eyJhbGciOiJIUzI1NiJ9.'+''.join(rng.choice(string.ascii_letters+string.digits+'_-') for _ in range(52))+'.'+''.join(rng.choice(string.ascii_letters+string.digits+'_-') for _ in range(32))
lines=['Email: user.name+demo@example.co.uk','API key: '+key,'Token: '+token,r'const path = "C:\Users\demo\file_01.ts";',r'if (value !== null && count >= 10) { return items[0]?.id ?? ""; }','const ids = ["O0Il1", "AbCdEf_9-0", "xX_01-lI"];','Invoice #AX-2048: $1,234.56 | 2026-10-22']
cases=[]
for name,fontfile in [('consolas','consola.ttf'),('segoe','segoeui.ttf')]:
 for size in [11,15]:
  font=ImageFont.truetype('C:/Windows/Fonts/'+fontfile,size)
  for theme in ['light','dark']:
   width=int(max(font.getlength(s) for s in lines)+40);image=Image.new('RGB',(width,(size+13)*len(lines)+32),'#101113' if theme=='dark' else 'white');draw=ImageDraw.Draw(image)
   for i,line in enumerate(lines):draw.text((16,12+i*(size+13)),line,font=font,fill='#e8e8ed' if theme=='dark' else '#111111')
   file=f'accuracy-{name}-{size}-{theme}.png';image.save(root/file);cases.append({'file':file,'expected':' '.join(lines),'key':key,'token':token})
(root/'accuracy-fixtures.json').write_text(json.dumps(cases,indent=2))
print(f'Generated {len(cases)} challenge fixtures')
