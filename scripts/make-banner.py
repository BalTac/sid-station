
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def create_banner():
    width = 1600
    height = 400

    # Base canvas with dark background (#08070f)
    base = Image.new("RGBA", (width, height), (8, 7, 15, 255))

    # Soft radial glow layer
    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)

    # Left violet glow (#5b3fd1)
    glow_draw.ellipse(
        (-180, -60, 480, 460),
        fill=(91, 63, 209, 120),
    )

    # Right cyan glow (#0e7490)
    glow_draw.ellipse(
        (1120, -60, 1780, 460),
        fill=(14, 116, 144, 115),
    )

    # Heavily blur the edge glows
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(radius=95))
    base = Image.alpha_composite(base, glow_layer)

    # Generate smooth sine-mixture waveform coordinates across full width
    points = []
    for x in range(width + 1):
        # A musical harmonic mixture reminiscent of SID audio output
        y = (
            332.0
            + 26.0 * math.sin(x * 0.013)
            + 12.0 * math.sin(x * 0.031 + 1.2)
            + 7.0 * math.cos(x * 0.007 + 2.5)
            + 3.0 * math.sin(x * 0.065)
        )
        points.append((x, y))

    # Oscilloscope glow underneath
    wave_glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    wave_glow_draw = ImageDraw.Draw(wave_glow)

    for i in range(len(points) - 1):
        t = i / float(width)
        # Gradient from #7c5cff (124, 92, 255) to #22d3ee (34, 211, 238)
        r = int(124 + (34 - 124) * t)
        g = int(92 + (211 - 92) * t)
        b = int(255 + (238 - 255) * t)
        wave_glow_draw.line(
            [points[i], points[i + 1]],
            fill=(r, g, b, 120),
            width=9,
        )

    wave_glow = wave_glow.filter(ImageFilter.GaussianBlur(radius=7))
    base = Image.alpha_composite(base, wave_glow)

    # Main 3 px wide gradient waveform line
    wave_main = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    wave_main_draw = ImageDraw.Draw(wave_main)

    for i in range(len(points) - 1):
        t = i / float(width)
        r = int(124 + (34 - 124) * t)
        g = int(92 + (211 - 92) * t)
        b = int(255 + (238 - 255) * t)
        wave_main_draw.line(
            [points[i], points[i + 1]],
            fill=(r, g, b, 235),
            width=3,
        )

    base = Image.alpha_composite(base, wave_main)

    # Typography & UI overlay
    ui_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ui_layer)

    def load_font(path, size):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
        return ImageFont.load_default()

    font_title = load_font("C:/Windows/Fonts/seguisb.ttf", 64)
    font_sub = load_font("C:/Windows/Fonts/segoeui.ttf", 20)
    font_pill = load_font("C:/Windows/Fonts/segoeui.ttf", 14)

    def get_char_width(char, font):
        if hasattr(font, "getlength"):
            return font.getlength(char)
        bbox = font.getbbox(char)
        return bbox[2] - bbox[0] if bbox else 30

    # Draw letter-spaced title "SID STATION"
    title_text = "SID STATION"
    title_x = 110
    title_y = 112
    letter_spacing = 7

    curr_x = title_x
    for char in title_text:
        draw.text((curr_x, title_y), char, font=font_title, fill=(255, 255, 255, 255))
        curr_x += get_char_width(char, font_title) + letter_spacing

    # Subtitle
    sub_text = "Commodore 64 SID player - HVSC browser"
    sub_x = 112
    sub_y = title_y + 80
    draw.text((sub_x, sub_y), sub_text, font=font_sub, fill=(185, 182, 207, 255))

    # Pill badges
    pills = ["HVSC", "PSID / RSID"]
    pill_x = 112
    pill_y = sub_y + 44
    pill_height = 26
    pill_radius = 13
    pill_gap = 12

    for label in pills:
        if hasattr(font_pill, "getlength"):
            text_w = font_pill.getlength(label)
        else:
            bbox = font_pill.getbbox(label)
            text_w = bbox[2] - bbox[0] if bbox else 50

        pad_x = 14
        pill_w = int(text_w + pad_x * 2)

        # Pill background and 1px violet outline (#5b3fd1)
        draw.rounded_rectangle(
            [pill_x, pill_y, pill_x + pill_w, pill_y + pill_height],
            radius=pill_radius,
            fill=(20, 18, 31, 230),
            outline=(91, 63, 209, 255),
            width=1,
        )

        # Centered label text (#d8d4ea)
        text_pos_x = pill_x + pad_x
        text_pos_y = pill_y + 4
        draw.text((text_pos_x, text_pos_y), label, font=font_pill, fill=(216, 212, 234, 255))

        pill_x += pill_w + pill_gap

    final_image = Image.alpha_composite(base, ui_layer).convert("RGB")

    # Output directory & file saving
    output_dir = "docs"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "banner.png")
    final_image.save(output_path, "PNG")

    print(f"Banner saved to {output_path} ({final_image.width}x{final_image.height})")


if __name__ == "__main__":
    create_banner()
