#!/usr/bin/env python3
"""
Generate the stylized horizontal repository banner for SID Station.

Specifications:
- Output: docs/banner.png
- Dimensions: exactly 1600 x 400 px (4:1 aspect ratio)
- Background: deep near-black (#08070f) with subtle violet (#7c5cff) glow on left
  and faint cyan (#22d3ee) glow on right
- Waveform: clean horizontal oscilloscope sine wave line with violet-to-cyan gradient
- Wordmark: "SID STATION" in bold geometric sans (Segoe UI Semibold: C:/Windows/Fonts/seguisb.ttf)
- Subtitle: "Commodore 64 SID player - HVSC browser" in Segoe UI (C:/Windows/Fonts/segoeui.ttf)
- Pill labels: "HVSC", "PSID / RSID", "6581 · 8580" in muted slate
- Technique: 2x supersampling (3200x800) downsampled via Lanczos for crisp anti-aliasing
"""

import math
import os
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


def find_font(preferred_path: str, fallback_names: list[str]) -> str:
    """Return an available font path, starting from preferred_path."""
    if os.path.exists(preferred_path):
        return preferred_path
    windir = os.environ.get("WINDIR", "C:\\Windows")
    fonts_dir = os.path.join(windir, "Fonts")
    for name in fallback_names:
        candidate = os.path.join(fonts_dir, name)
        if os.path.exists(candidate):
            return candidate
    return preferred_path


def create_banner(output_path: Path) -> Path:
    # Target and 2x supersampled dimensions
    target_w, target_h = 1600, 400
    scale = 2
    w, h = target_w * scale, target_h * scale

    # 1. Base canvas: deep near-black #08070f
    base = Image.new("RGBA", (w, h), (8, 7, 15, 255))

    # 2. Subtle ambient glows
    # Left violet glow (#7c5cff = 124, 92, 255)
    glow_l = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_l = ImageDraw.Draw(glow_l)
    draw_l.ellipse(
        [
            int(0.12 * w - 600),
            int(0.48 * h - 360),
            int(0.12 * w + 600),
            int(0.48 * h + 360),
        ],
        fill=(124, 92, 255, 95),
    )
    glow_l = glow_l.filter(ImageFilter.GaussianBlur(radius=180))

    # Right cyan glow (#22d3ee = 34, 211, 238)
    glow_r = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_r = ImageDraw.Draw(glow_r)
    draw_r.ellipse(
        [
            int(0.88 * w - 600),
            int(0.52 * h - 360),
            int(0.88 * w + 600),
            int(0.52 * h + 360),
        ],
        fill=(34, 211, 238, 85),
    )
    glow_r = glow_r.filter(ImageFilter.GaussianBlur(radius=180))

    base.alpha_composite(glow_l)
    base.alpha_composite(glow_r)

    # 3. Clean horizontal oscilloscope sine waveform line
    k = 6.0  # 6 complete cycles across banner width
    amp = 65.0  # Amplitude in 2x scale (32.5 px in 1x scale)
    y_base = 0.77 * h  # Baseline in lower third
    num_pts = 3201
    pts = []
    for i in range(num_pts):
        x = (i / (num_pts - 1)) * w
        y = y_base + math.sin(2 * math.pi * k * (x / w)) * amp
        pts.append((x, y))

    # Horizontal gradient (#7c5cff to #22d3ee)
    grad_1d = Image.new("RGB", (w, 1))
    grad_pixels = []
    for i in range(w):
        t = i / (w - 1)
        r = int(124 * (1.0 - t) + 34 * t)
        g = int(92 * (1.0 - t) + 211 * t)
        b = int(255 * (1.0 - t) + 238 * t)
        grad_pixels.append((r, g, b))
    grad_1d.putdata(grad_pixels)
    grad_2d = grad_1d.resize((w, h), Image.Resampling.NEAREST).convert("RGBA")

    # Multi-pass phosphor luminescence
    # Pass A: Broad bloom
    mask_bloom = Image.new("L", (w, h), 0)
    draw_bloom = ImageDraw.Draw(mask_bloom)
    draw_bloom.line(pts, fill=60, width=28, joint="curve")
    mask_bloom = mask_bloom.filter(ImageFilter.GaussianBlur(radius=14))

    # Pass B: Mid phosphor glow
    mask_mid = Image.new("L", (w, h), 0)
    draw_mid = ImageDraw.Draw(mask_mid)
    draw_mid.line(pts, fill=135, width=12, joint="curve")
    mask_mid = mask_mid.filter(ImageFilter.GaussianBlur(radius=4))

    # Pass C: Crisp core beam
    mask_core = Image.new("L", (w, h), 0)
    draw_core = ImageDraw.Draw(mask_core)
    draw_core.line(pts, fill=255, width=5, joint="curve")

    # Composite alpha mask
    combined_mask = ImageChops.add(mask_bloom, mask_mid)
    combined_mask = ImageChops.add(combined_mask, mask_core)

    line_layer = grad_2d.copy()
    line_layer.putalpha(combined_mask)
    base.alpha_composite(line_layer)

    # Hot white center highlight
    mask_hot = Image.new("L", (w, h), 0)
    draw_hot = ImageDraw.Draw(mask_hot)
    draw_hot.line(pts, fill=210, width=2, joint="curve")
    white_core = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    white_core.putalpha(mask_hot)
    base.alpha_composite(white_core)

    # 4. Typography
    font_title_path = find_font("C:/Windows/Fonts/seguisb.ttf", ["seguisb.ttf", "segoeuib.ttf", "segoeui.ttf"])
    font_sub_path = find_font("C:/Windows/Fonts/segoeui.ttf", ["segoeui.ttf", "seguisb.ttf"])

    font_title = ImageFont.truetype(font_title_path, 110)
    font_sub = ImageFont.truetype(font_sub_path, 42)
    font_pill = ImageFont.truetype(font_title_path, 24)

    draw = ImageDraw.Draw(base)

    # Wordmark: "SID STATION" with geometric tracking
    title_text = "SID STATION"
    tracking = 20
    char_widths = [
        draw.textbbox((0, 0), ch, font=font_title)[2]
        - draw.textbbox((0, 0), ch, font=font_title)[0]
        for ch in title_text
    ]
    total_title_w = sum(char_widths) + tracking * (len(title_text) - 1)
    cur_x = (w - total_title_w) / 2
    title_y = 0.185 * h

    for i, ch in enumerate(title_text):
        bbox = draw.textbbox((0, 0), ch, font=font_title)
        draw.text((cur_x, title_y - bbox[1]), ch, font=font_title, fill=(255, 255, 255, 255))
        cur_x += char_widths[i] + tracking

    # Subtitle: "Commodore 64 SID player - HVSC browser"
    sub_text = "Commodore 64 SID player - HVSC browser"
    sub_bbox = draw.textbbox((0, 0), sub_text, font=font_sub)
    sub_w = sub_bbox[2] - sub_bbox[0]
    draw.text(
        ((w - sub_w) / 2, 0.365 * h),
        sub_text,
        font=font_sub,
        fill=(180, 190, 205, 240),
    )

    # 5. Pill labels in muted color
    def draw_pill(draw_ctx, x0, y0, pw, ph, text, font):
        r = ph // 2
        draw_ctx.rounded_rectangle(
            [x0, y0, x0 + pw, y0 + ph],
            radius=r,
            fill=(20, 18, 32, 210),
            outline=(124, 92, 255, 120),
            width=2,
        )
        bb = font.getbbox(text)
        tw = bb[2] - bb[0]
        th = bb[3] - bb[1]
        tx = x0 + (pw - tw) // 2 - bb[0]
        ty = y0 + (ph - th) // 2 - bb[1]
        draw_ctx.text((tx, ty), text, font=font, fill=(220, 216, 238, 235))

    pills = ["HVSC", "PSID / RSID", "6581 · 8580"]
    pad_x = 26
    pad_y = 10
    pill_dims = []
    for p in pills:
        bb = font_pill.getbbox(p)
        pill_dims.append((bb[2] - bb[0] + pad_x * 2, bb[3] - bb[1] + pad_y * 2))

    gap = 20
    tot_p_w = sum(pw for pw, _ in pill_dims) + gap * (len(pills) - 1)
    px = (w - tot_p_w) / 2
    py = int(0.515 * h)

    for i, p in enumerate(pills):
        pw, ph = pill_dims[i]
        draw_pill(draw, int(px), py, pw, ph, p, font_pill)
        px += pw + gap

    # 6. Downsample via Lanczos to exactly 1600 x 400
    banner = base.resize((target_w, target_h), Image.Resampling.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    banner.save(output_path, "PNG", optimize=True)

    return output_path


def main():
    repo_root = Path(__file__).resolve().parent.parent
    output_path = repo_root / "docs" / "banner.png"

    if len(sys.argv) > 1:
        output_path = Path(sys.argv[1]).resolve()

    saved_path = create_banner(output_path)

    # Verify output dimensions
    with Image.open(saved_path) as img:
        size = img.size
        mode = img.mode

    if size != (1600, 400):
        raise ValueError(f"Unexpected image size: {size}, expected (1600, 400)")

    print(f"Banner generated: {saved_path.resolve()}")
    print(f"Image size: {size[0]}x{size[1]} ({mode})")


if __name__ == "__main__":
    main()
