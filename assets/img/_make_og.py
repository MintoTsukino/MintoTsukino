# -*- coding: utf-8 -*-
"""みんと食堂 OGP画像ジェネレータ (1200x630)"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
OUT = os.path.join(os.path.dirname(__file__), "og.png")

INK = (20, 17, 15)
INK_2 = (31, 26, 23)
PAPER = (245, 236, 216)
VERMILION = (193, 67, 42)
VERMILION_SOFT = (226, 107, 77)
MINT = (127, 223, 202)
GOLD = (212, 166, 87)

YUMIN = "C:/Windows/Fonts/YuMin.ttf"
YUGOTH = "C:/Windows/Fonts/YuGothM.ttc"
SEGOE = "C:/Windows/Fonts/segoeui.ttf"

img = Image.new("RGB", (W, H), INK)
draw = ImageDraw.Draw(img, "RGBA")

# Background: vertical gradient from ink -> ink_2
for y in range(H):
    t = y / H
    r = int(INK[0] * (1 - t) + INK_2[0] * t)
    g = int(INK[1] * (1 - t) + INK_2[1] * t)
    b = int(INK[2] * (1 - t) + INK_2[2] * t)
    draw.line([(0, y), (W, y)], fill=(r, g, b))

# Top noren band (vermilion)
noren_h = 80
draw.rectangle([(0, 0), (W, noren_h)], fill=VERMILION)
# noren scalloped bottom edge
scallop_r = 18
for cx in range(scallop_r, W + scallop_r, scallop_r * 2):
    draw.ellipse([(cx - scallop_r, noren_h - scallop_r),
                  (cx + scallop_r, noren_h + scallop_r)], fill=VERMILION)

# Faint giant kanji "食" on the right
try:
    f_kanji = ImageFont.truetype(YUMIN, 520)
    draw.text((W - 480, H - 540), "食", font=f_kanji, fill=(193, 67, 42, 38))
except Exception as e:
    print("kanji font fail:", e)

# Moon circle top-right
moon_cx, moon_cy, moon_r = 1040, 230, 90
for i in range(moon_r, 0, -2):
    alpha = int(20 * (i / moon_r))
    draw.ellipse([(moon_cx - i, moon_cy - i),
                  (moon_cx + i, moon_cy + i)],
                 fill=(245, 236, 216, alpha))
draw.ellipse([(moon_cx - 60, moon_cy - 60),
              (moon_cx + 60, moon_cy + 60)],
             fill=(245, 236, 216, 40))

# Vermilion accent bar (left)
bar_x = 80
draw.rectangle([(bar_x, 200), (bar_x + 6, 460)], fill=VERMILION)

# Main title: みんと食堂
try:
    f_title = ImageFont.truetype(YUMIN, 140)
    draw.text((110, 175), "みんと食堂", font=f_title, fill=PAPER)
except Exception as e:
    print("title font fail:", e)

# Subtitle eyebrow (mint)
try:
    f_sub_en = ImageFont.truetype(SEGOE, 22)
    draw.text((114, 150), "MINTO  TSUKINO  ·  VST  PLUGINS",
              font=f_sub_en, fill=MINT)
except Exception as e:
    print("sub_en font fail:", e)

# Tagline
try:
    f_tag = ImageFont.truetype(YUMIN, 38)
    draw.text((114, 350),
              "食べる音、弾ける音。",
              font=f_tag, fill=PAPER)

    f_tag2 = ImageFont.truetype(YUGOTH, 22) if os.path.exists(YUGOTH) else f_tag
    draw.text((114, 412),
              "食べ物の食感を、音の食感へ翻訳する VST シリーズ。",
              font=f_tag2, fill=(245, 236, 216, 200))
except Exception as e:
    print("tagline font fail:", e)

# Bottom info bar
bottom_y = 540
draw.rectangle([(0, bottom_y), (W, H)], fill=INK_2)
draw.rectangle([(0, bottom_y), (W, bottom_y + 3)], fill=VERMILION)

# URL
try:
    f_url = ImageFont.truetype(SEGOE, 20)
    draw.text((114, bottom_y + 32),
              "mintotsukino.github.io / MintoTsukino",
              font=f_url, fill=MINT)
except Exception as e:
    print("url font fail:", e)

# Series count badge
try:
    f_badge = ImageFont.truetype(SEGOE, 18)
    badge_text = "NOW SERVING  ·  🍿"
    badge_text_safe = "NOW  SERVING  /  Series 02"
    draw.text((760, bottom_y + 32),
              badge_text_safe,
              font=f_badge, fill=(245, 236, 216, 170))
except Exception as e:
    print("badge font fail:", e)

img.save(OUT, "PNG", optimize=True)
print(f"saved: {OUT} ({os.path.getsize(OUT)} bytes)")
