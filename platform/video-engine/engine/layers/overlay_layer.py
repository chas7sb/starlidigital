"""
Overlay Layer Renderer
======================
Renders vignettes, editorial gradient shading, and film grain.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class OverlayLayer(BaseLayer):
    """Renders atmospheric overlays and color grading."""

    def __init__(self, spec: LayerSpec, width: int = 1080, height: int = 1920):
        super().__init__(spec)
        self.width = width
        self.height = height
        self._vignette_mask = None
        self._init_mask()

    def _init_mask(self) -> None:
        yy, xx = np.mgrid[0:self.height, 0:self.width]
        y_norm = yy / float(self.height)
        x_norm = xx / float(self.width)
        # Vignette mask
        dist = ((x_norm - 0.5) ** 2 + (y_norm - 0.5) ** 2) * 1.5
        vignette = np.clip(dist, 0.0, 1.0)
        self._vignette_alpha = (vignette * 255).astype(np.uint8)

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
        opacity = transform["opacity"] * self.spec.overlayIntensity
        if opacity <= 0.005:
            return

        overlay = Image.new("RGBA", (canvas_w, canvas_h), (8, 12, 18, 0))
        if self._vignette_alpha is not None:
            alpha = (self._vignette_alpha * opacity).astype(np.uint8)
            alpha_img = Image.fromarray(alpha, mode="L")
            black = Image.new("RGBA", (canvas_w, canvas_h), (8, 12, 18, 255))
            black.putalpha(alpha_img)
            canvas.alpha_composite(black)
