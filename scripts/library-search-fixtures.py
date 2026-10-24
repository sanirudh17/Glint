"""Owned screenshot-like screens for testing OCR retrieval, never personal captures."""
import json, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(os.environ['LOCALAPPDATA']) / 'GlintValidation' / 'LibrarySearch'
root.mkdir(parents=True, exist_ok=True)
cases = []
for dark in (False, True):
    for style in ('document', 'terminal', 'dashboard'):
        bg, fg = ('#121315', '#eeeeee') if dark else ('#f6f7f9', '#20232a')
        image = Image.new('RGB', (1920, 1080), bg)
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf' if style == 'terminal' else 'C:/Windows/Fonts/segoeui.ttf', 16)
        draw.rectangle((0, 0, 1919, 72), fill='#282c34' if dark else '#e4e7ed')
        draw.text((40, 25), 'Glint search evaluation - owned screen', font=font, fill=fg)
        lines = {
            'document': ['Quarterly planning notes', 'Migration checklist and release preparation', 'Review customer feedback before shipping', 'Invoice reconciliation for October', 'Budget remaining: 1234 dollars'],
            'terminal': ['Deployment completed successfully', 'Running integration tests', 'Configuration loaded from local workspace', 'Build artifacts are ready', 'Connection established to localhost'],
            'dashboard': ['Project overview', 'Weekly revenue report', 'Customer retention analysis', 'Upload screenshots for review', 'Pending tasks and notifications'],
        }[style]
        for i in range(22):
            draw.text((110, 150+i*34), lines[i % len(lines)], font=font, fill=fg)
        if style == 'dashboard':
            for i in range(5):
                draw.rectangle((1200+i*110, 700-i*80, 1270+i*110, 950), fill='#2baaad')
        name = f'{style}-{"dark" if dark else "light"}.png'
        image.save(root / name)
        cases.append({'file': name, 'queries': {
            'document': ['quarterly planning', 'migration checklist', 'customer feedback', 'invoice reconciliation'],
            'terminal': ['deployment completed', 'integration tests', 'configuration loaded', 'build artifacts'],
            'dashboard': ['project overview', 'revenue report', 'customer retention', 'pending tasks'],
        }[style]})
for name, mode in [('blank.png', 'RGB'), ('blank-transparent.png', 'RGBA')]:
    Image.new(mode, (1920, 1080), (32, 32, 32) if mode == 'RGB' else (0, 0, 0, 0)).save(root/name)
    cases.append({'file': name, 'queries': []})
hard = Path(os.environ['LOCALAPPDATA']) / 'GlintValidation' / 'OcrUpgrade'
if (hard/'accuracy-fixtures.json').exists():
    for case in json.loads((hard/'accuracy-fixtures.json').read_text()):
        import shutil
        shutil.copyfile(hard/case['file'], root/case['file'])
        cases.append({'file': case['file'], 'queries': ['invoice', 'email', 'const']})
(root/'search-fixtures.json').write_text(json.dumps(cases, indent=2))
print(f'{len(cases)} owned cases in {root}')
