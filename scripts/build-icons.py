"""Build the vector dialogue mark and its transparent PNG sizes from one geometry."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'icons'
outer = [(2, 2), (22, 2), (22, 18), (11, 18), (4, 23), (4, 18), (2, 18)]
inner = [(4, 4), (20, 4), (20, 16), (10.4, 16), (6, 19.1), (6, 16), (4, 16)]
lines = [(7, 7, 17, 9), (7, 11, 14, 13)]
def path(points):
    return 'M' + 'L'.join(f'{x},{y}' for x, y in points) + 'Z'
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n'
svg += f'  <path fill="#111" fill-rule="evenodd" d="{path(outer)}{path(inner)}"/>\n'
for x, y, right, bottom in lines:
    svg += f'  <rect x="{x}" y="{y}" width="{right-x}" height="{bottom-y}" fill="#111"/>\n'
svg += '</svg>\n'
(root / 'dialogue.svg').write_text(svg, encoding='utf-8')
for light in (False, True):
    for size in ((16, 32) if light else (16, 32, 48, 96)):
        factor = size * 8 / 24
        canvas = Image.new('RGBA', (size * 8, size * 8))
        draw = ImageDraw.Draw(canvas)
        color = (255, 255, 255, 255) if light else (17, 17, 17, 255)
        scale = lambda points: [(round(x*factor), round(y*factor)) for x, y in points]
        draw.polygon(scale(outer), fill=color)
        draw.polygon(scale(inner), fill=(0, 0, 0, 0))
        for x, y, right, bottom in lines:
            draw.rectangle([round(x*factor), round(y*factor), round(right*factor)-1, round(bottom*factor)-1], fill=color)
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(root / f'icon-{"light-" if light else ""}{size}.png')
print('Built dialogue.svg and 6 monochrome PNG icons.')
