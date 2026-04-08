"""Generate DTC Journal app icon using Pillow."""
from PIL import Image, ImageDraw, ImageFont
import math, os

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# --- Background: rounded rectangle with dark gradient ---
def rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)
    draw.pieslice([x0, y0, x0 + 2*radius, y0 + 2*radius], 180, 270, fill=fill)
    draw.pieslice([x1 - 2*radius, y0, x1, y0 + 2*radius], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2*radius, x0 + 2*radius, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2*radius, y1 - 2*radius, x1, y1], 0, 90, fill=fill)

# Main background
rounded_rect(draw, (0, 0, SIZE-1, SIZE-1), 220, (14, 14, 28, 255))

# Subtle gradient overlay (top lighter)
overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
odraw = ImageDraw.Draw(overlay)
for y in range(SIZE // 2):
    alpha = int(40 * (1 - y / (SIZE // 2)))
    odraw.line([(0, y), (SIZE, y)], fill=(124, 58, 237, alpha))
img = Image.alpha_composite(img, overlay)
draw = ImageDraw.Draw(img)

# --- Grid lines (very subtle) ---
for gy in [340, 460, 580, 700]:
    draw.line([(160, gy), (864, gy)], fill=(255, 255, 255, 10), width=2)

# --- Uptrend line ---
draw.line([(220, 700), (804, 320)], fill=(124, 58, 237, 50), width=5)

# --- Candlesticks ---
def draw_candle(draw, cx, wick_top, wick_bot, body_top, body_bot, bullish):
    green = (52, 211, 153)
    red = (248, 113, 113)
    color = green if bullish else red
    body_w = 76
    # Wick
    draw.line([(cx, wick_top), (cx, wick_bot)], fill=color, width=8)
    # Body with rounded corners
    bx0 = cx - body_w // 2
    bx1 = cx + body_w // 2
    rounded_rect(draw, (bx0, body_top, bx1, body_bot), 8, color)

# Candle 1 - Green (bullish)
draw_candle(draw, 270, 350, 720, 450, 630, True)
# Candle 2 - Red (bearish)
draw_candle(draw, 420, 300, 680, 360, 560, False)
# Candle 3 - Green (bullish, tallest)
draw_candle(draw, 570, 250, 650, 320, 540, True)
# Candle 4 - Red (small pullback)
draw_candle(draw, 720, 280, 580, 340, 480, False)

# --- "DTC" text ---
# Try to use a bold system font, fallback to default
font = None
font_paths = [
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/Arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/calibrib.ttf",
]
for fp in font_paths:
    if os.path.exists(fp):
        try:
            font = ImageFont.truetype(fp, 110)
            break
        except:
            pass
if font is None:
    font = ImageFont.load_default()

# Draw text with purple gradient color
text = "DTC"
bbox = draw.textbbox((0, 0), text, font=font)
tw = bbox[2] - bbox[0]
tx = (SIZE - tw) // 2
ty = 790
# Shadow
draw.text((tx + 2, ty + 2), text, fill=(0, 0, 0, 120), font=font)
# Main text
draw.text((tx, ty), text, fill=(167, 139, 250), font=font)

# --- Thin accent border ---
border_overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bdraw = ImageDraw.Draw(border_overlay)
# Draw border by drawing two rounded rects and subtracting
outer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
inner = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
odraw2 = ImageDraw.Draw(outer)
idraw2 = ImageDraw.Draw(inner)
rounded_rect(odraw2, (4, 4, SIZE-5, SIZE-5), 218, (124, 58, 237, 40))
rounded_rect(idraw2, (8, 8, SIZE-9, SIZE-9), 214, (124, 58, 237, 40))
# Just draw a simple border line instead
for offset in range(3):
    o = 6 + offset
    r = 218 - offset
    # Top-left arc to top-right arc
    # Simple approach: draw rounded rect outline via multiple passes
# Simplified: skip complex border, the design is clean enough

out_path = os.path.join(os.path.dirname(__file__), "app-icon.png")
img.save(out_path, "PNG")
print(f"Saved {out_path}")
print(f"Size: {img.size}")
