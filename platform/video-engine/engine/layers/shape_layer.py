"""
Shape Layer Renderer
====================
Renders geometric primitives and brand vector graphics:
rectangle, rounded_rectangle, circle, line, starli_star, and arrow.
"""

from __future__ import annotations

import math
from typing import Dict, Tuple
from PIL import Image, ImageDraw

from engine.effects import draw_starli_symbol, draw_up_right_arrow, parse_color
from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class ShapeLayer(BaseLayer):
    """Renders vector shapes and brand symbols."""

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

        shape = self.spec.shape
        x = transform["x"]
        y = transform["y"]
        w = transform["width"] if transform["width"] > 0 else 100.0
        h = transform["height"] if transform["height"] > 0 else 100.0

        fill_color = parse_color(self.spec.fill, int(255 * opacity)) if self.spec.fill else None
        stroke_color = parse_color(self.spec.stroke, int(255 * opacity)) if self.spec.stroke else None
        stroke_w = self.spec.strokeWidth

        # Starli star vector symbol
        if shape == "starli_star":
            radius = w / 2.0 if w > 0 else 32.0
            accent_rgb = parse_color(brand.accentColor)[:3]
            draw_starli_symbol(
                canvas,
                cx=x,
                cy=y,
                radius=radius * transform["scale"],
                alpha=opacity,
                glow_strength=0.8,
                pulse=scene_time * 3.0,
                accent_rgb=accent_rgb,
            )
            return

        # Vector arrow
        if shape == "arrow":
            layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)
            arr_col = stroke_color or fill_color or (198, 219, 240, int(255 * opacity))
            draw_up_right_arrow(draw, x, y, size=self.spec.arrowSize * transform["scale"], color=arr_col, width=stroke_w)
            canvas.alpha_composite(layer)
            return

        # Regular geometric shapes
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)

        # Anchor
        anchor = self.spec.anchor
        x0, y0 = x, y
        if anchor == "center":
            x0 -= w / 2.0
            y0 -= h / 2.0
        elif anchor == "top_center":
            x0 -= w / 2.0
        elif anchor == "bottom_center":
            x0 -= w / 2.0
            y0 -= h

        x1 = x0 + w
        y1 = y0 + h

        if shape == "circle":
            draw.ellipse([x0, y0, x1, y1], fill=fill_color, outline=stroke_color, width=stroke_w)
        elif shape == "rounded_rectangle":
            draw.rounded_rectangle([x0, y0, x1, y1], radius=self.spec.radius, fill=fill_color, outline=stroke_color, width=stroke_w)
        elif shape == "line":
            draw.line([(x0, y0), (x1, y1)], fill=stroke_color or fill_color, width=stroke_w)
        else:  # rectangle
            draw.rectangle([x0, y0, x1, y1], fill=fill_color, outline=stroke_color, width=stroke_w)

        canvas.alpha_composite(layer)
