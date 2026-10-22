"""Owned screenshot fixtures: compare text CER and CPU wall time, not vendor scores.
Run in the isolated RapidOCR/ONNX Python environment. No user images are uploaded.
"""
import json, os, re, subprocess, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
from rapidocr import RapidOCR, OCRVersion, ModelType

ROOT=Path(os.environ['LOCALAPPDATA'])/'GlintValidation/OcrUpgrade'
ROOT.mkdir(parents=True,exist_ok=True)
TESS=Path(r'C:/Users/sanir/Claude Code/glint/src-tauri/binaries/tesseract/tesseract.exe')
LINES=['Glint captures stay on this device.',
       'Email: hello@example.com',
       'API key: sk_test_51Q5aaBBccDDeeFF001122334455',
       'Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345',
       'const result = await capture({ width: 1920, height: 1080 });',
       'Invoice total: $1,234.56 | 2026-10-21',
       'IP address: 192.168.1.100',
       'Mixed symbols: O0 Il1 {json} [array] foo_bar/path.ts']
def norm(s):return re.sub(r'\s+',' ',s).strip()
def distance(a,b):
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=row
    return prev[-1]
fixtures=[]
for size in [11,14,18]:
    for dark in [False,True]:
        font=ImageFont.truetype('C:/Windows/Fonts/consola.ttf',size)
        width=max(720,int(max(font.getlength(s) for s in LINES)+40));height=40+(size+14)*len(LINES)
        image=Image.new('RGB',(width,height),'#101113' if dark else '#ffffff')
        draw=ImageDraw.Draw(image)
        for i,text in enumerate(LINES):draw.text((20,18+i*(size+14)),text,font=font,fill='#e8e8ed' if dark else '#111111')
        path=ROOT/f'fixture-{size}-{"dark" if dark else "light"}.png';image.save(path)
        fixtures.append((path,image,dark))
expected=norm('\n'.join(LINES))
results=[]
for version,tier in [(OCRVersion.PPOCRV6,ModelType.SMALL),(OCRVersion.PPOCRV6,ModelType.TINY),(OCRVersion.PPOCRV5,ModelType.MOBILE)]:
    name=f'{version.value}-{tier.value}'
    engine=RapidOCR(params={'Global.model_root_dir':str(ROOT/'models'),'Global.use_cls':False,'EngineConfig.onnxruntime.intra_op_num_threads':4,'EngineConfig.onnxruntime.inter_op_num_threads':1,'Det.ocr_version':version,'Rec.ocr_version':version,'Det.model_type':tier,'Rec.model_type':tier})
    for path,image,dark in fixtures:
        start=time.perf_counter();out=engine(str(path),return_word_box=True);elapsed=time.perf_counter()-start
        text=norm('\n'.join(out.txts or []));result={'engine':name,'fixture':path.name,'ms':round(elapsed*1000),'cer':round(distance(expected,text)/len(expected),4),'text':text,'lines':len(out.txts or []),'word_boxes':len(out.word_results or [])};results.append(result);print(json.dumps(result),flush=True)
for path,image,dark in fixtures:
    gray=image.convert('L');gray=ImageOps.invert(gray) if dark else gray
    factor=min(3,8000/max(image.size));gray=gray.resize(tuple(round(v*factor) for v in image.size),Image.Resampling.BICUBIC);prepared=ROOT/('tess-'+path.name);gray.save(prepared)
    start=time.perf_counter();p=subprocess.run([str(TESS),str(prepared),'stdout','-l','eng','--oem','1','--psm','6','--tessdata-dir',str(TESS.parent/'tessdata')],capture_output=True,text=True,encoding='utf-8',timeout=45,env={**os.environ,'OMP_THREAD_LIMIT':'2'},creationflags=subprocess.CREATE_NO_WINDOW);p.check_returncode();elapsed=time.perf_counter()-start
    text=norm(p.stdout);result={'engine':'bundled-tesseract','fixture':path.name,'ms':round(elapsed*1000),'cer':round(distance(expected,text)/len(expected),4),'text':text};results.append(result);print(json.dumps(result),flush=True)
(ROOT/'benchmark.json').write_text(json.dumps({'expected':expected,'results':results},indent=2),encoding='utf-8')
