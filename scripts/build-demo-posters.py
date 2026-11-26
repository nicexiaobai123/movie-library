"""Compose 2:3 posters from cached stills, burning the title into the artwork.

Real posters would contradict invented titles, and remote image services proved
unreliable here, so each poster is built locally from a cinematic still plus its
own title typography. Output is deterministic: rerunning reproduces the same art.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

CACHE = Path('.demo-assets')
MEDIA = CACHE / 'posters'

FONT_BOLD = r'C:\Windows\Fonts\msyhbd.ttc'
FONT_REGULAR = r'C:\Windows\Fonts\msyh.ttc'

# (still number, title, original title, year, accent hex) — order matches demo-content.mjs
FILMS = [
    (1, '云海之上', 'ABOVE THE CLOUD SEA', '2023', '#9fc4e8'),
    (2, '夜行货车', 'THE NIGHT FREIGHT', '2021', '#c2b3d9'),
    (3, '潮汐线', 'THE TIDE LINE', '2019', '#8fc9bb'),
    (4, '霓虹街区', 'NEON DISTRICT', '2024', '#f08fa8'),
    (5, '麦田里的钟', 'THE BELL IN THE WHEAT', '2017', '#d8c07a'),
    (6, '林间小径', 'THE FOREST PATH', '2022', '#a8c39a'),
    (7, '海雾', 'SEA FOG', '2020', '#93b6c9'),
    (8, '海岸线', 'COASTLINE', '2025', '#8fb6d6'),
    (13, '长夜将尽', 'BEFORE THE DAWN', '2019', '#e0b98a'),
    (10, '冬岸', 'THE WINTER SHORE', '2018', '#a9c7d9'),
    (11, '深空来信', 'LETTERS FROM DEEP SPACE', '2022', '#b7a9d9'),
    (12, '群山回响', 'ECHOES IN THE HILLS', '2016', '#c9b8a0'),
]

POSTER_W, POSTER_H = 600, 900
WIDE_W, WIDE_H = 1600, 900


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    """Crop to fill the target box without stretching."""
    scale = max(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def fits(font: ImageFont.FreeTypeFont, text: str, limit: int) -> bool:
    return font.getbbox(text)[2] <= limit


def wrap(text: str, font: ImageFont.FreeTypeFont, limit: int) -> list[str]:
    lines, current = [], ''
    for char in text:
        candidate = current + char
        if fits(font, candidate, limit) or not current:
            current = candidate
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def gradient(size: tuple[int, int], top_alpha: int, bottom_alpha: int) -> Image.Image:
    width, height = size
    layer = Image.new('L', (1, height))
    for y in range(height):
        ratio = y / max(1, height - 1)
        layer.putpixel((0, y), round(top_alpha + (bottom_alpha - top_alpha) * ratio))
    return layer.resize((width, height), Image.BILINEAR)


def build_poster(still: int, title: str, original: str, year: str, accent: str, position: int) -> Path:
    source = CACHE / f'still-{still}.jpg'
    if not source.exists():
        raise FileNotFoundError(source)
    art = cover(Image.open(source).convert('RGB'), POSTER_W, POSTER_H)

    # Darken the lower half so the title block always has contrast.
    scrim = Image.new('RGB', art.size, (8, 9, 11))
    art = Image.composite(scrim, art, gradient(art.size, 0, 240))

    draw = ImageDraw.Draw(art)
    margin = 44
    limit = POSTER_W - margin * 2

    # Title sits on the lower third at a readable size, like a real one-sheet.
    title_font = ImageFont.truetype(FONT_BOLD, 56)
    while not fits(title_font, title, limit) and title_font.size > 30:
        title_font = ImageFont.truetype(FONT_BOLD, title_font.size - 2)

    lines = wrap(title, title_font, limit)
    line_height = round(title_font.size * 1.22)
    original_font = ImageFont.truetype(FONT_REGULAR, 15)
    year_font = ImageFont.truetype(FONT_REGULAR, 16)

    block = len(lines) * line_height + 46
    baseline = POSTER_H - margin - block + line_height - 18

    accent_rgb = tuple(int(accent.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
    for offset, line in enumerate(lines):
        draw.text((margin, baseline + offset * line_height), line, font=title_font, fill='#f4f2ee')

    rule_y = baseline + len(lines) * line_height - 8
    draw.line([(margin, rule_y), (margin + 40, rule_y)], fill=accent_rgb, width=2)
    draw.text((margin, rule_y + 14), original, font=original_font, fill=accent)
    draw.text((POSTER_W - margin - year_font.getbbox(year)[2], rule_y + 13), year, font=year_font, fill='#9a9aa1')

    target = MEDIA / f'{position:02d}.jpg'
    target.parent.mkdir(parents=True, exist_ok=True)
    art.save(target, 'JPEG', quality=88, optimize=True)
    return target


def build_wide(still: int, position: int) -> Path:
    source = CACHE / f'still-{still}.jpg'
    if not source.exists():
        return None
    art = cover(Image.open(source).convert('RGB'), WIDE_W, WIDE_H)
    # Slight vignette keeps hero text readable over bright skies.
    art = art.filter(ImageFilter.GaussianBlur(0.4))
    target = MEDIA / f'{position:02d}-wide.jpg'
    target.parent.mkdir(parents=True, exist_ok=True)
    art.save(target, 'JPEG', quality=86, optimize=True)
    return target


def main() -> int:
    made = 0
    for position, (still, title, original, year, accent) in enumerate(FILMS, start=1):
        try:
            build_poster(still, title, original, year, accent, position)
            build_wide(still, position)
            made += 1
        except FileNotFoundError:
            print(f'skip {title}: no cached still')
    print(f'posters built: {made}/{len(FILMS)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
