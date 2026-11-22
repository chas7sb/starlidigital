"""
Particle Layer Renderer
=======================
Renders drifting 3D cosmic starfield particles and atmospheric dust.
"""

from __future__ import annotations

from PIL import Image

from engine.effects import ParallaxParticleSystem
from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class ParticleLayer(BaseLayer):
    """Renders depth-separated floating particles with twinkle."""

    def __init__(self, spec: LayerSpec, width: int = 1080, height: int = 1920):
        super().__init__(spec)
        self.system = ParallaxParticleSystem(
            count=spec.particleCount or 65,
            width=width,
            height=height,
            seed=42,
        )

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

        self.system.render_onto(canvas, scene_time, opacity=opacity)
