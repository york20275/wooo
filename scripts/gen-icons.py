# 用網站 LOGO 產生 App 圖示與分享預覽圖：python3 scripts/gen-icons.py <logo.png>
# 需要 Pillow。LOGO 為透明背景 PNG（左邊黑色方塊「窩」＋右邊「Woo!」）。
import sys, os
from PIL import Image, ImageDraw, ImageFilter
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'logo.png')
out = os.path.join(os.path.dirname(__file__), '..', 'public')
logo = Image.open(src).convert('RGBA')
logo = logo.crop(logo.split()[3].getbbox())
logo.save(os.path.join(out, 'logo.png'), optimize=True)

# 切出左邊的黑色方塊（只看下半部判斷寬度，避開右上角的橘色線條）
a = logo.split()[3].load(); w, h = logo.size
cnt = [sum(1 for y in range(int(h*0.4), int(h*0.85)) if a[x, y] > 128) for x in range(w)]
x0 = next(x for x in range(w) if cnt[x] > 0); x1 = x0
while x1 < w and cnt[x1] > 0: x1 += 1
sq = logo.crop((x0, 0, x1, h))
px = sq.load()
for y in range(sq.size[1]):
    for x in range(sq.size[0]):
        r, g, b, al = px[x, y]
        if al and r > 180 and 80 < g < 200 and b < 90: px[x, y] = (0, 0, 0, 0)   # 去掉橘色裝飾線
# 只用「深色且不透明」的像素決定方塊範圍
mask = Image.new('L', sq.size, 0); mp = mask.load()
for y in range(sq.size[1]):
    for x in range(sq.size[0]):
        r, g, b, al = px[x, y]
        if al > 128 and r < 90 and g < 90 and b < 90: mp[x, y] = 255
box = mask.getbbox()
sq = sq.crop(box)
sp = sq.load()
for y in range(sq.size[1]):
    for x in range(sq.size[0]):
        r, g, b, al = sp[x, y]
        if al and r > 150 and g < 200 and b < 120 and r - b > 80: sp[x, y] = (0, 0, 0, 0)
side = max(sq.size)
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0)); canvas.paste(sq, ((side - sq.size[0]) // 2, (side - sq.size[1]) // 2), sq); sq = canvas

def save_icon(size, name, pad=0.0, bg=None):
    im = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    inner = int(size * (1 - pad * 2))
    s = sq.resize((inner, inner), Image.LANCZOS)
    im.paste(s, ((size - inner) // 2, (size - inner) // 2), s)
    if bg: im = im.convert('RGB')
    im.save(os.path.join(out, name), optimize=True)

BLACK = (17, 17, 18, 255)
save_icon(192, 'icon-192.png'); save_icon(512, 'icon-512.png'); save_icon(48, 'favicon.png')
save_icon(512, 'icon-maskable.png', pad=0.12, bg=BLACK)
save_icon(180, 'apple-touch-icon.png', pad=0.08, bg=BLACK)

# 分享預覽 1200x630：森林晴空背景＋LOGO
BG = (244, 248, 247)
og = Image.new('RGB', (1200, 630), BG); blob = Image.new('RGB', (1200, 630), BG); bd = ImageDraw.Draw(blob)
bd.ellipse([-200, -100, 500, 560], fill=(169, 204, 159)); bd.ellipse([780, 250, 1400, 850], fill=(168, 207, 242)); bd.ellipse([520, -150, 980, 280], fill=(211, 235, 224))
og = Image.blend(og, blob.filter(ImageFilter.GaussianBlur(110)), 0.85)
card = Image.new('RGBA', (900, 400), (0, 0, 0, 0)); ImageDraw.Draw(card).rounded_rectangle([0, 0, 899, 399], radius=44, fill=(255, 255, 255, 235))
og.paste(card, (150, 115), card)
lw = 700; lh = int(logo.size[1] * lw / logo.size[0])
lg = logo.resize((lw, lh), Image.LANCZOS)
og.paste(lg, ((1200 - lw) // 2, 115 + (400 - lh) // 2), lg)
og.save(os.path.join(out, 'og.png'), optimize=True)
print('ok', logo.size, sq.size)
