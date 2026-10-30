"""Create the separate, reproducible OCR download asset, never an installer resource."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--notices', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
files = {'tesseract.exe': args.source / 'tesseract.exe',
         'tessdata/eng.traineddata': args.source / 'tessdata/eng.traineddata'}
files.update({p.name: p for p in args.source.glob('*.dll')})
files.update({f'licenses/{p.name}': p for p in args.notices.iterdir() if p.is_file()})
assert files['tesseract.exe'].is_file() and files['tessdata/eng.traineddata'].is_file()
assert 'licenses/LICENSE' in files
args.output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.output, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name, path in sorted(files.items()):
        entry = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, path.read_bytes())
    source_entry = ZipInfo('SOURCES.txt', (2026, 1, 1, 0, 0, 0))
    source_entry.compress_type = ZIP_DEFLATED
    archive.writestr(source_entry,
        'Tesseract 5.4.0.20240606 Windows runtime, repackaged from UB Mannheim.\n'
        'https://github.com/UB-Mannheim/tesseract/wiki\n'
        'https://github.com/tesseract-ocr/tesseract/tree/5.4.0\n'
        'https://github.com/tesseract-ocr/tessdata\n'
        'Only the English recognition data is included. No system installation is changed.\n')
metadata = {'name': args.output.name, 'bytes': args.output.stat().st_size,
            'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}
args.output.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata))
