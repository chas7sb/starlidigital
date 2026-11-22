"""
Base Layer Interface
====================
Provides common positioning, transform, and animation handling for all layer renderers.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, Optional, Tuple
from PIL import Image

from engine.animation import PropertyTimeline
from engine.schema import BrandSpec, LayerSpec


class BaseLayer(ABC):
    """Abstract base class for all renderable layers."""

    def __init__(self, spec: LayerSpec):
        self.spec = spec
        # Base property dictionary for animations
        base_vals = {
            "x": spec.x,
            "y": spec.y,
            "width": spec.width if spec.width is not None else 0.0,
            "height": spec.height if spec.height is not None else 0.0,
            "opacity": spec.opacity,
            "rotation": spec.rotation,
            "scale": 1.0,
            "scaleX": 1.0,
            "scaleY": 1.0,
            "blur": 0.0,
            "progress": 0.0,
        }
        self.timeline = PropertyTimeline(base_vals, spec.animations)

    def is_visible(self, scene_time: float) -> bool:
        if scene_time < self.spec.start:
            return False
        if self.spec.duration is not None and scene_time > (self.spec.start + self.spec.duration):
            return False
        opacity = self.timeline.get_value("opacity", scene_time)
        return opacity > 0.005

    def get_animated_transform(self, scene_time: float) -> Dict[str, float]:
        return {
            "x": self.timeline.get_value("x", scene_time),
            "y": self.timeline.get_value("y", scene_time),
            "width": self.timeline.get_value("width", scene_time),
            "height": self.timeline.get_value("height", scene_time),
            "opacity": max(0.0, min(1.0, self.timeline.get_value("opacity", scene_time))),
            "rotation": self.timeline.get_value("rotation", scene_time),
            "scale": self.timeline.get_value("scale", scene_time),
            "scaleX": self.timeline.get_value("scaleX", scene_time),
            "scaleY": self.timeline.get_value("scaleY", scene_time),
            "blur": self.timeline.get_value("blur", scene_time),
            "progress": self.timeline.get_value("progress", scene_time),
        }

    @abstractmethod
    def render(
        self,
        canvas: Image.Image,
        scene_time: float,
        canvas_w: int,
        canvas_h: int,
        brand: BrandSpec,
    ) -> None:
        """Renders the layer onto the canvas (RGBA PIL image)."""
        pass
