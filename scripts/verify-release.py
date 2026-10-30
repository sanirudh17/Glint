"""Read-only Windows release/package checks. Reports contain no captures or credentials."""
import argparse
import hashlib
import json
import re
import subprocess
import tomllib
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--target-dir', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--assets-dir', type=Path)
parser.add_argument('--seven-zip', type=Path, default=Path('C:/Program Files/7-Zip/7z.exe'))
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
package = json.loads((repo/'glint/package.json').read_text(encoding='utf-8'))
lock = json.loads((repo/'glint/package-lock.json').read_text(encoding='utf-8'))
config = json.loads((repo/'glint/src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
cargo = tomllib.loads((repo/'glint/src-tauri/Cargo.toml').read_text(encoding='utf-8'))
cargo_lock = tomllib.loads((repo/'glint/src-tauri/Cargo.lock').read_text(encoding='utf-8'))
version = package['version']
checks = []
def check(name, condition):
    assert condition, name
    checks.append(name)
check('Version manifests and locks agree', all(v == version for v in [lock['version'], lock['packages']['']['version'], config['version'], cargo['package']['version'], next(p['version'] for p in cargo_lock['package'] if p['name']=='glint')]))
check('Production application identifier', config['identifier']=='com.glint.app')
check('No OCR or caption resources configured', not re.search(r'tesseract|onnx|traineddata|ggml|whisper', json.dumps(config['bundle'].get('resources', {})), re.I))
check('Recording sidecars configured', set(config['bundle']['externalBin'])=={'binaries/ffmpeg','binaries/ffprobe'})
binary=args.target_dir/'release/glint.exe'
setup=args.target_dir/f'release/bundle/nsis/Glint_{version}_x64-setup.exe'
msi=args.target_dir/f'release/bundle/msi/Glint_{version}_x64_en-US.msi'
for path in [binary,setup,msi]: check(f'Built {path.name}',path.is_file() and path.stat().st_size>1_000_000)
quoted=str(binary).replace("'", "''")
result=subprocess.run(['powershell.exe','-NoProfile','-Command',f"(Get-Item -LiteralPath '{quoted}').VersionInfo | Select-Object ProductVersion,FileVersion,ProductName | ConvertTo-Json -Compress"],capture_output=True,text=True,check=True)
pe=json.loads(result.stdout)
check('Executable product version matches',pe['ProductVersion']==version or pe['ProductVersion'].startswith(version+'.'))
check('Executable product name matches',pe['ProductName']=='Glint')
listing=subprocess.run([str(args.seven_zip),'l','-slt','-sccUTF-8',str(setup)],capture_output=True,encoding='utf-8',check=True).stdout
paths=re.findall(r'^Path = (.+)$',listing,re.M)
check('Setup contains application',any(p.replace('\\','/').endswith('glint.exe') for p in paths))
for name in ['ffmpeg.exe','ffprobe.exe']:check(f'Setup contains {name}',any(p.replace('\\','/').endswith(name) for p in paths))
check('Setup contains no OCR/caption runtime or weights',not any(re.search(r'tesseract|onnxruntime|\.onnx$|\.traineddata$|ggml|whisper',p,re.I) for p in paths))
msi_quoted=str(msi).replace("'", "''")
command=f"$i=New-Object -ComObject WindowsInstaller.Installer; $d=$i.OpenDatabase('{msi_quoted}',0); $v=$d.OpenView('SELECT FileName FROM File'); $v.Execute(); $files=@(); while($r=$v.Fetch()){{$files+=$r.StringData(1)}}; $files | ConvertTo-Json -Compress; $v.Close()"
result=subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,text=True,check=True)
msi_files=json.loads(result.stdout)
check('MSI contains only the app and recording sidecars',set(msi_files)=={'glint.exe','ffmpeg.exe','ffprobe.exe'})
if args.assets_dir:
    portable=args.assets_dir/f'Glint_{version}_x64.zip'
    with zipfile.ZipFile(portable) as archive:
        names=archive.namelist()
        check('ZIP distribution contains application and recording sidecars',{'glint.exe','ffmpeg.exe','ffprobe.exe'}.issubset(names))
        check('ZIP distribution contains no OCR/caption files',not any(re.search(r'tesseract|onnxruntime|\.onnx$|\.traineddata$|ggml|whisper',p,re.I) for p in names))
    lines=(args.assets_dir/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
    for line in lines:
        digest,name=line.split('  ',1)
        check(f'Checksum matches {name}',hashlib.sha256((args.assets_dir/name).read_bytes()).hexdigest()==digest)
    managed=(repo/'glint/src-tauri/src/ocr/managed.rs').read_text(encoding='utf-8')
    model_hash=re.search(r'const TESS_HASH: &str =\s*"([0-9a-f]{64})"',managed).group(1)
    check('Optional Tesseract asset matches application pin',hashlib.sha256((args.assets_dir/'Glint-OCR-Tesseract-5.4.0-x64.zip').read_bytes()).hexdigest()==model_hash)
assets=[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [binary,setup,msi]]
report={'passed':True,'version':version,'checks':checks,'pe':pe,'assets':assets,'installerFiles':paths,'msiFiles':msi_files}
args.report.parent.mkdir(parents=True,exist_ok=True)
args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':True,'version':version,'checks':len(checks),'assets':assets},indent=2))
