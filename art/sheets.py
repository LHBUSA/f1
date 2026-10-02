"""Contact sheets: for each page × width, the four directions side by side (labelled)."""
import sys, os, glob
from PIL import Image, ImageDraw

src = sys.argv[1]
dirs = sys.argv[2:] or ['A', 'B', 'C', 'D']
os.makedirs(os.path.join(src, 'sheets'), exist_ok=True)
keys = sorted({os.path.basename(f)[2:] for f in glob.glob(os.path.join(src, 'A_*.png'))})
for k in keys:
    ims = [Image.open(os.path.join(src, f'{d}_{k}')) for d in dirs if os.path.exists(os.path.join(src, f'{d}_{k}'))]
    if len(ims) != len(dirs):
        continue
    w, h = ims[0].size
    scale = min(1.0, 900 / w) if w > 500 else 1.0
    tw, th = int(w * scale), int(h * scale)
    cols = 4 if w <= 500 else 2
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw + (cols - 1) * 8, rows * (th + 28)), (20, 20, 24))
    dr = ImageDraw.Draw(sheet)
    for i, (d, im) in enumerate(zip(dirs, ims)):
        x, y = (i % cols) * (tw + 8), (i // cols) * (th + 28)
        sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 28))
        dr.text((x + 6, y + 6), f'Direction {d}', fill=(255, 255, 255))
    sheet.save(os.path.join(src, 'sheets', k))
print('sheets:', len(keys))
