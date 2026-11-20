# 產生 App 圖示與分享預覽圖：python3 scripts/gen-icons.py（需要 Pillow 與 Noto Sans CJK 字型）
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
TC = 3  # Noto Sans CJK TC
out = os.path.join(os.path.dirname(__file__), '..', 'public')
GREEN=(46,106,78); BLUE=(47,116,174); BG=(244,248,247)
F = lambda s: ImageFont.truetype(FONT, s, index=TC)
def icon(size, maskable=False, name=None):
    im = Image.new('RGBA',(size,size),(0,0,0,0)); d = ImageDraw.Draw(im)
    if maskable: d.rectangle([0,0,size,size], fill=GREEN)
    else: d.rounded_rectangle([0,0,size-1,size-1], radius=int(size*0.22), fill=GREEN)
    f = F(int(size*(0.52 if maskable else 0.64)))
    b = d.textbbox((0,0),'窩',font=f); w,h = b[2]-b[0], b[3]-b[1]
    d.text(((size-w)/2-b[0], (size-h)/2-b[1]-size*0.02),'窩',font=f,fill=(255,255,255))
    r=int(size*0.05); cx=int(size*(0.80 if maskable else 0.87)); cy=int(size*(0.80 if maskable else 0.87))
    d.ellipse([cx-r,cy-r,cx+r,cy+r], fill=(168,207,242))
    im.save(os.path.join(out, name))
icon(192, name='icon-192.png'); icon(512, name='icon-512.png'); icon(512, True, 'icon-maskable.png'); icon(48, name='favicon.png')
Image.open(os.path.join(out,'icon-maskable.png')).resize((180,180)).convert('RGB').save(os.path.join(out,'apple-touch-icon.png'))
og = Image.new('RGB',(1200,630),BG); blob = Image.new('RGB',(1200,630),BG); bd = ImageDraw.Draw(blob)
bd.ellipse([-200,-100,500,560], fill=(169,204,159)); bd.ellipse([780,250,1400,850], fill=(168,207,242)); bd.ellipse([520,-150,980,280], fill=(211,235,224))
og = Image.blend(og, blob.filter(ImageFilter.GaussianBlur(110)), 0.85); d = ImageDraw.Draw(og)
d.rounded_rectangle([170,150,1030,490], radius=40, fill=(255,255,255))
d.text((245,180),'窩',font=F(140),fill=GREEN); d.text((405,200),'Wooo！',font=F(112),fill=BLUE)
d.text((250,405),'慵懶窩著，隨意分享日常的社群',font=F(40),fill=(36,84,61))
og.save(os.path.join(out,'og.png'), optimize=True)
print('ok')
