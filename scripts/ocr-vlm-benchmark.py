"""Accuracy-only research run. Owned fixtures; local GPU; no remote inference."""
import os,time,json,re,argparse
from pathlib import Path
root=Path(os.environ['LOCALAPPDATA'])/'GlintValidation/OcrUpgrade'
os.environ['HF_HUB_DISABLE_XET']='1'
os.environ['HF_HOME']=str(root/'hf-cache')
import torch
from PIL import Image
from transformers import AutoProcessor,AutoModelForImageTextToText
from huggingface_hub import hf_hub_download,HfApi
parser=argparse.ArgumentParser();parser.add_argument('--upscale',type=int,default=1);parser.add_argument('--pattern',default='fixture-*.png');args=parser.parse_args()
repo='ATH-MaaS/OvisOCR3'
revision=HfApi().model_info(repo).sha
print('Pinned',repo,revision,flush=True)
start=time.perf_counter()
processor=AutoProcessor.from_pretrained(repo,revision=revision,trust_remote_code=False)
prompt=Path(hf_hub_download(repo,'prompts/plain_ocr.txt',revision=revision)).read_text(encoding='utf-8').strip()
model=AutoModelForImageTextToText.from_pretrained(repo,revision=revision,trust_remote_code=False,torch_dtype=torch.bfloat16,attn_implementation='sdpa').to('cuda').eval()
print('Loaded in',round(time.perf_counter()-start,1),'s',flush=True)
expected=json.loads((root/'benchmark.json').read_text())['expected']
def distance(a,b):
 p=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  n=[i]
  for j,y in enumerate(b,1):n.append(min(n[-1]+1,p[j]+1,p[j-1]+(x!=y)))
  p=n
 return p[-1]
results=[]
for p in sorted(root.glob(args.pattern)):
 image=Image.open(p).convert('RGB')
 if args.upscale!=1:image=image.resize((image.width*args.upscale,image.height*args.upscale),Image.Resampling.BICUBIC)
 messages=[{'role':'user','content':[{'type':'image','image':image},{'type':'text','text':prompt}]}]
 start=time.perf_counter();inputs=processor.apply_chat_template(messages,add_generation_prompt=True,tokenize=True,return_dict=True,return_tensors='pt').to('cuda')
 with torch.inference_mode():out=model.generate(**inputs,max_new_tokens=1536,do_sample=False)
 text=processor.batch_decode(out[:,inputs['input_ids'].shape[1]:],skip_special_tokens=True)[0]
 result={'engine':repo,'revision':revision,'fixture':p.name,'ms':round((time.perf_counter()-start)*1000),'cer':distance(expected,re.sub(r'\s+',' ',text).strip())/len(expected),'text':text};results.append(result);print(json.dumps(result),flush=True)
 (root/f'ovis3-benchmark-{args.upscale}x.json').write_text(json.dumps(results,indent=2))
