"""
Text Layer Renderer
===================
Renders rich typography with full Romanian diacritics, custom letter-spacing tracking,
word wrapping, glass backdrops, and animated reveal effects (typewriter, slide up, fade).
"""

from __future__ import annotations

import math
from typing import List, Tuple
from PIL import Image, ImageDraw, ImageFont

from engine.effects import draw_glass_card, draw_tracked_text, get_font, parse_color
from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class TextLayer(BaseLayer):
    """Renders animated typography with diacritics, tracking, wrapping, and effects."""

    def __init__(self, spec: LayerSpec):
        super().__init__(spec)

    def _wrap_text(self, text: str, font: ImageFont.FreeTypeFont, max_w: float) -> List[str]:
        if max_w <= 0:
            return text.split("\n")

        lines: List[str] = []
        dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

        for raw_line in text.split("\n"):
            words = raw_line.split(" ")
            if not words:
                lines.append("")
                continue

            current_line = words[0]
            for word in words[1:]:
                test_line = f"{current_line} {word}"
                bbox = dummy.textbbox((0, 0), test_line, font=font)
                w = bbox[2] - bbox[0]
                if w <= max_w:
                    current_line = test_line
                else:
                    lines.append(current_line)
                    current_line = word
            lines.append(current_line)

        return lines

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

        weight = self.spec.fontWeight or self.spec.font or "regular"
        font = get_font(weight, self.spec.fontSize)

        # Word wrap
        max_width = transform["width"] if transform["width"] > 0 else 0
        raw_lines = self._wrap_text(self.spec.text, font, max_width)

        # Apply text effects (typewriter / word reveal / slide up)
        effect = self.spec.textEffect
        lines_to_render = raw_lines
        y_offset = 0.0

        if effect == "slide_up":
            # Entrance slide up
            rel_t = scene_time - self.spec.start
            enter_factor = max(0.0, min(1.0, rel_t / 0.6))
            y_offset = (1.0 - (1.0 - (1.0 - enter_factor) ** 3)) * 35.0  # ease_out_cubic
        elif effect == "typewriter":
            # Typewriter character reveal
            rel_t = scene_time - self.spec.start
            char_rate = 22.0  # chars per second
            total_chars_allowed = int(rel_t * char_rate)
            chars_seen = 0
            revealed_lines: List[str] = []
            for line in raw_lines:
                if chars_seen >= total_chars_allowed:
                    break
                rem = total_chars_allowed - chars_seen
                if len(line) <= rem:
                    revealed_lines.append(line)
                    chars_seen += len(line)
                else:
                    revealed_lines.append(line[:rem])
                    chars_seen += rem
                    break
            lines_to_render = revealed_lines

        if not lines_to_render:
            return

        # Calculate bounding box for background card or alignment
        line_height = int(self.spec.fontSize * self.spec.lineHeight)
        dummy = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
        line_widths = []
        for line in lines_to_render:
            bbox = dummy.textbbox((0, 0), line, font=font)
            line_widths.append((bbox[2] - bbox[0]) + self.spec.tracking * max(0, len(line) - 1))

        max_content_w = max(line_widths) if line_widths else 0
        total_content_h = len(lines_to_render) * line_height

        x = transform["x"]
        y = transform["y"] + y_offset

        # Anchor adjustment
        anchor = self.spec.anchor
        if anchor == "center":
            x -= max_content_w / 2.0
            y -= total_content_h / 2.0
        elif anchor == "top_center":
            x -= max_content_w / 2.0
        elif anchor == "top_right":
            x -= max_content_w

        # Render background glass card if enabled
        if self.spec.backgroundCard:
            pad = self.spec.cardPadding
            box = (
                x - pad,
                y - pad,
                x + max_content_w + pad,
                y + total_content_h + pad,
            )
            card_alpha = int(255 * self.spec.cardAlpha * opacity)
            draw_glass_card(canvas, box, radius=self.spec.cardRadius, fill_alpha=card_alpha)

        # Render text lines
        layer_img = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer_img)
        fill_color = parse_color(self.spec.color, int(255 * opacity))

        curr_y = y
        for line, lw in zip(lines_to_render, line_widths):
            line_x = x
            if self.spec.align == "center":
                line_x = x + (max_content_w - lw) / 2.0
            elif self.spec.align == "right":
                line_x = x + (max_content_w - lw)

            draw_tracked_text(
                draw,
                (line_x, curr_y),
                line,
                font,
                fill_color,
                tracking=self.spec.tracking,
                align="left",
            )
            curr_y += line_height

        canvas.alpha_composite(layer_img)
