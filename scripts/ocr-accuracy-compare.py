"""Compare exact character and fake-identifier accuracy on owned screenshots."""
import os,json,re,time,subprocess,argparse
from pathlib import Path
from PIL import Image,ImageOps
from rapidocr import RapidOCR,OCRVersion,ModelType
root=Path(os.environ['LOCALAPPDATA'])/'GlintValidation/OcrUpgrade'
parser=argparse.ArgumentParser();parser.add_argument('--upscale',type=int,default=1);scale=parser.parse_args().upscale
report='accuracy-comparison.json' if scale==1 else f'accuracy-comparison-{scale}x.json'
cases=json.loads((root/'accuracy-fixtures.json').read_text())
def norm(s):return re.sub(r'\s+',' ',s).strip()
def distance(a,b):
 p=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  n=[i]
  for j,y in enumerate(b,1):n.append(min(n[-1]+1,p[j]+1,p[j-1]+(x!=y)))
  p=n
 return p[-1]
results=[]
def record(engine,c,text,start):
 text=norm(text);results.append({'engine':engine,'file':c['file'],'cer':distance(c['expected'],text)/len(c['expected']),'key_exact':c['key'] in text,'token_exact':c['token'] in text,'ms':round((time.perf_counter()-start)*1000),'text':text});print(json.dumps({k:v for k,v in results[-1].items() if k!='text'}),flush=True)
 (root/report).write_text(json.dumps(results,indent=2))
for tier in [ModelType.SMALL,ModelType.MEDIUM]:
 engine=RapidOCR(params={'Global.model_root_dir':str(root/'models'),'Global.use_cls':False,'EngineConfig.onnxruntime.intra_op_num_threads':4,'EngineConfig.onnxruntime.inter_op_num_threads':1,'Det.ocr_version':OCRVersion.PPOCRV6,'Rec.ocr_version':OCRVersion.PPOCRV6,'Det.model_type':tier,'Rec.model_type':tier})
 for c in cases:
  path=root/c['file']
  if scale!=1:
   image=Image.open(path);image=image.resize((image.width*scale,image.height*scale),Image.Resampling.BICUBIC);path=root/f'up{scale}-{c["file"]}';image.save(path)
  start=time.perf_counter();out=engine(str(path));record(tier.value,c,'\n'.join(out.txts or []),start)
tess=Path(__file__).resolve().parents[1]/'glint/src-tauri/binaries/tesseract/tesseract.exe'
for c in (cases if scale==1 else []):
 image=Image.open(root/c['file']).convert('L');image=ImageOps.invert(image) if 'dark' in c['file'] else image
 image=image.resize((image.width*3,image.height*3),Image.Resampling.BICUBIC);path=root/('tess-'+c['file']);image.save(path)
 start=time.perf_counter();out=subprocess.run([str(tess),str(path),'stdout','-l','eng','--oem','1','--psm','6','--tessdata-dir',str(tess.parent/'tessdata')],capture_output=True,text=True,encoding='utf-8',timeout=45,env={**os.environ,'OMP_THREAD_LIMIT':'2'},creationflags=subprocess.CREATE_NO_WINDOW);out.check_returncode();record('tesseract',c,out.stdout,start)
