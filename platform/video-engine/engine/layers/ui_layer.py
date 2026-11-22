"""
UI Motion Graphics Components
=============================
Renders interactive UI components: glass cards, status pills, chat bubbles,
progress bars, browser windows, metric cards, CTA buttons, and brand headers/footers.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Tuple
from PIL import Image, ImageDraw

from engine.effects import (
    draw_glass_card,
    draw_starli_symbol,
    draw_tracked_text,
    draw_up_right_arrow,
    get_font,
    parse_color,
)
from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class UILayer(BaseLayer):
    """Renders programmatic UI components for product ads, AI agent demos, and web walkthroughs."""

    def __init__(self, spec: LayerSpec):
        super().__init__(spec)

    def render(
        self,
        canvas: Image.Image,
        scene_time: float,
        canvas_w: int,
        canvas_h: int,
        brand: BrandSpec,
    ) -> None:
        if not self.is_visible(scene_time):
            return

        transform = self.get_animated_transform(scene_time)
        opacity = transform["opacity"]
        if opacity <= 0.005:
            return

        comp = self.spec.component
        props = self.spec.componentProps
        x = transform["x"]
        y = transform["y"]
        w = transform["width"] if transform["width"] > 0 else 400.0
        h = transform["height"] if transform["height"] > 0 else 200.0

        accent_rgb = parse_color(brand.accentColor)[:3]
        surface_rgb = parse_color(brand.secondaryColor)[:3]
        online_rgb = parse_color(brand.onlineColor)[:3]
        white_rgb = parse_color(brand.textColor)[:3]
        silver_rgb = parse_color(brand.silverColor)[:3]

        if comp == "glass_card":
            box = (x, y, x + w, y + h)
            draw_glass_card(
                canvas,
                box,
                radius=int(props.get("radius", 24)),
                fill_alpha=int(200 * opacity),
                border_alpha=int(90 * opacity),
                ice_tint=bool(props.get("iceTint", False)),
                bg_rgb=surface_rgb,
                border_rgb=accent_rgb,
            )

        elif comp == "status_pill":
            label = str(props.get("label", "STARLI AI · ONLINE"))
            font = get_font("semibold", int(props.get("fontSize", 18)))
            pill_h = int(h if h != 200 else 44)
            dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
            text_w = sum(dummy.textbbox((0, 0), ch, font=font)[2] for ch in label) + 2.0 * max(0, len(label) - 1)
            pill_w = int(w if w != 400 else (text_w + 64))

            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)
            # Background pill
            draw.rounded_rectangle(
                [x, y, x + pill_w, y + pill_h],
                radius=pill_h // 2,
                fill=(*surface_rgb, int(210 * opacity)),
                outline=(*accent_rgb, int(85 * opacity)),
                width=1,
            )
            # Pulsing green status dot
            dot_pulse = 0.7 + 0.3 * math.sin(scene_time * 5.0)
            dot_x = x + 22
            dot_y = y + pill_h / 2.0
            draw.ellipse(
                [dot_x - 7, dot_y - 7, dot_x + 7, dot_y + 7],
                fill=(*online_rgb, int(85 * opacity * dot_pulse)),
            )
            draw.ellipse(
                [dot_x - 4, dot_y - 4, dot_x + 4, dot_y + 4],
                fill=(*online_rgb, int(255 * opacity)),
            )
            # Tracked text
            draw_tracked_text(
                draw,
                (dot_x + 16, y + (pill_h - font.size) / 2.0 - 2),
                label,
                font,
                (*accent_rgb, int(240 * opacity)),
                tracking=1.8,
                align="left",
            )
            canvas.alpha_composite(layer)

        elif comp == "chat_bubble":
            sender = str(props.get("sender", "Starli AI"))
            message = str(props.get("message", "Bună! Cum te pot ajuta astăzi?"))
            is_ai = bool(props.get("isAi", True))

            box = (x, y, x + w, y + h)
            draw_glass_card(
                canvas,
                box,
                radius=20,
                fill_alpha=int(215 * opacity),
                border_alpha=int(100 * opacity),
                ice_tint=is_ai,
                bg_rgb=surface_rgb,
                border_rgb=accent_rgb,
            )

            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            # Avatar & sender name
            if is_ai:
                draw_starli_symbol(canvas, x + 36, y + 36, radius=16, alpha=opacity, glow_strength=0.5, pulse=scene_time * 2.5)
            else:
                draw.ellipse([x + 22, y + 22, x + 50, y + 50], fill=(*silver_rgb, int(180 * opacity)))

            font_sender = get_font("semibold", 20)
            sender_col = accent_rgb if is_ai else white_rgb
            draw.text((x + 64, y + 24), sender, font=font_sender, fill=(*sender_col, int(255 * opacity)))

            # Message content
            font_msg = get_font("regular", 22)
            # Word-wrapped lines inside card
            words = message.split(" ")
            lines = []
            curr_line = words[0] if words else ""
            for word in words[1:]:
                test = f"{curr_line} {word}"
                tb = draw.textbbox((0, 0), test, font=font_msg)
                if (tb[2] - tb[0]) < (w - 60):
                    curr_line = test
                else:
                    lines.append(curr_line)
                    curr_line = word
            lines.append(curr_line)

            msg_y = y + 68
            for l in lines:
                draw.text((x + 30, msg_y), l, font=font_msg, fill=(*white_rgb, int(240 * opacity)))
                msg_y += 32

            canvas.alpha_composite(layer)

        elif comp == "progress_bar":
            prog = max(0.0, min(1.0, transform["progress"] if "progress" in transform else float(props.get("progress", 0.5))))
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)
            # Track
            draw.line([(x, y), (x + w, y)], fill=(255, 255, 255, int(35 * opacity)), width=4)
            # Fill
            fill_x = x + w * prog
            draw.line([(x, y), (fill_x, y)], fill=(*accent_rgb, int(240 * opacity)), width=5)
            # Glowing head
            draw.ellipse([fill_x - 6, y - 6, fill_x + 6, y + 6], fill=(*white_rgb, int(255 * opacity)))
            canvas.alpha_composite(layer)

        elif comp == "browser_frame":
            url_text = str(props.get("url", brand.website))
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            # Chrome header
            chrome_h = 56
            draw.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=(*surface_rgb, int(220 * opacity)), outline=(*accent_rgb, int(75 * opacity)), width=1)
            draw.line([(x, y + chrome_h), (x + w, y + chrome_h)], fill=(255, 255, 255, int(30 * opacity)), width=1)

            # 3 traffic light dots
            draw.ellipse([x + 20, y + 23, x + 30, y + 33], fill=(240, 90, 80, int(220 * opacity)))
            draw.ellipse([x + 36, y + 23, x + 46, y + 33], fill=(240, 190, 60, int(220 * opacity)))
            draw.ellipse([x + 52, y + 23, x + 62, y + 33], fill=(90, 200, 100, int(220 * opacity)))

            # URL address bar
            bar_x0 = x + 76
            bar_x1 = x + w - 24
            draw.rounded_rectangle([bar_x0, y + 14, bar_x1, y + 42], radius=14, fill=(8, 12, 18, int(180 * opacity)), outline=(255, 255, 255, int(35 * opacity)), width=1)
            font_url = get_font("regular", 16)
            draw.text((bar_x0 + 16, y + 20), f"https://{url_text}", font=font_url, fill=(*accent_rgb, int(220 * opacity)))
            canvas.alpha_composite(layer)

        elif comp == "metric_card":
            value = str(props.get("value", "99.8%"))
            label = str(props.get("label", "ACCURACY"))
            trend = str(props.get("trend", "↗"))

            box = (x, y, x + w, y + h)
            draw_glass_card(canvas, box, radius=20, fill_alpha=int(210 * opacity), border_alpha=int(80 * opacity), bg_rgb=surface_rgb, border_rgb=accent_rgb)

            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            font_val = get_font("bold", 54)
            draw.text((x + 24, y + 24), value, font=font_val, fill=(*white_rgb, int(255 * opacity)))

            font_lbl = get_font("semibold", 18)
            draw_tracked_text(draw, (x + 26, y + 92), label, font_lbl, (*silver_rgb, int(210 * opacity)), tracking=2.0)

            if trend:
                font_tr = get_font("semibold", 28)
                draw.text((x + w - 50, y + 24), trend, font=font_tr, fill=(*online_rgb, int(240 * opacity)))

            canvas.alpha_composite(layer)

        elif comp == "cta_button":
            text = str(props.get("text", brand.ctaText))
            font = get_font("semibold", 24)
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            btn_box = [x, y, x + w, y + h]
            draw.rounded_rectangle(btn_box, radius=int(h / 2.0), fill=(*accent_rgb, int(230 * opacity)))

            # Button text centered with arrow
            tb = draw.textbbox((0, 0), text, font=font)
            tw = tb[2] - tb[0]
            cx = x + (w - tw) / 2.0 - 12
            cy = y + (h - font.size) / 2.0 - 2
            draw.text((cx, cy), text, font=font, fill=(8, 12, 18, int(255 * opacity)))
            draw_up_right_arrow(draw, cx + tw + 20, cy + font.size / 2.0, size=18, color=(8, 12, 18, int(255 * opacity)), width=3)
            canvas.alpha_composite(layer)

        elif comp == "header_bar":
            episode = str(props.get("badge", "01"))
            tag = str(props.get("tag", brand.businessName.upper()))
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            # Top symbol
            draw_starli_symbol(canvas, 92, y + 20, radius=24, alpha=opacity, glow_strength=0.6, pulse=scene_time * 3.0, accent_rgb=accent_rgb)

            # Wordmark
            font_brand = get_font("semibold", 24)
            draw_tracked_text(
                draw,
                (132, y + 4),
                brand.businessName.upper(),
                font_brand,
                (*white_rgb, int(245 * opacity)),
                tracking=6.5,
                align="left",
            )

            # Status tag pill on right
            font_tag = get_font("semibold", 18)
            label_str = f"{episode} · {tag}"
            text_w = sum(draw.textbbox((0, 0), ch, font=font_tag)[2] for ch in label_str) + 2.0 * max(0, len(label_str) - 1)
            pill_w = int(text_w + 68)
            pill_h = 44
            px0 = canvas_w - 68 - pill_w
            py0 = y - 2
            draw.rounded_rectangle(
                [px0, py0, px0 + pill_w, py0 + pill_h],
                radius=22,
                fill=(*surface_rgb, int(205 * opacity)),
                outline=(*accent_rgb, int(80 * opacity)),
                width=1,
            )
            dot_pulse = 0.7 + 0.3 * math.sin(scene_time * 5.0)
            dot_x = px0 + 24
            dot_y = py0 + pill_h // 2
            draw.ellipse([dot_x - 7, dot_y - 7, dot_x + 7, dot_y + 7], fill=(*online_rgb, int(85 * opacity * dot_pulse)))
            draw.ellipse([dot_x - 4, dot_y - 4, dot_x + 4, dot_y + 4], fill=(*online_rgb, int(255 * opacity)))
            draw_tracked_text(draw, (dot_x + 18, py0 + 10), label_str, font_tag, (*accent_rgb, int(235 * opacity)), tracking=2.0, align="left")
            canvas.alpha_composite(layer)

        elif comp == "footer_cta":
            cta_url = str(props.get("url", brand.website))
            agency_text = str(props.get("tagline", brand.tagline.upper()))
            duration = float(props.get("totalDuration", 15.0))
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)

            font_sub = get_font("semibold", 19)
            draw_tracked_text(draw, (68, y), agency_text, font_sub, (*silver_rgb, int(195 * opacity)), tracking=2.5, align="left")

            font_url = get_font("semibold", 22)
            draw_tracked_text(draw, (canvas_w - 68, y - 3), cta_url, font_url, (*accent_rgb, int(245 * opacity)), tracking=1.5, align="right")

            # Progress bar
            bar_y = y + 51
            draw.line([(68, bar_y), (canvas_w - 68, bar_y)], fill=(255, 255, 255, int(35 * opacity)), width=3)
            prog_x = int(68 + (canvas_w - 136) * max(0.0, min(1.0, scene_time / max(0.1, duration))))
            draw.line([(68, bar_y), (prog_x, bar_y)], fill=(*accent_rgb, int(230 * opacity)), width=4)
            draw.ellipse([prog_x - 6, bar_y - 6, prog_x + 6, bar_y + 6], fill=(*white_rgb, int(255 * opacity)))
            canvas.alpha_composite(layer)
