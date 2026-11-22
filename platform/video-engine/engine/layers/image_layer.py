"""
Image Layer Renderer
====================
Renders static and generated images with animated position, Ken Burns motion,
scale, rotation, fit modes, corner radius, and opacity.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Optional, Tuple, Union

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

from engine.effects import CosmicBackgroundAnimator, parse_color
from engine.layers.base import BaseLayer
from engine.schema import BrandSpec, LayerSpec


class ImageLayer(BaseLayer):
    """Renders image assets with Ken Burns, fitting, transforms, and opacity."""

    def __init__(self, spec: LayerSpec, asset_resolver=None):
        super().__init__(spec)
        self.asset_resolver = asset_resolver
        self._raw_image: Optional[Image.Image] = None
        self._bg_animator: Optional[CosmicBackgroundAnimator] = None
        self._load_image()

    def _load_image(self) -> None:
        path = self.spec.assetPath
        if not path and self.asset_resolver and self.spec.assetId:
            path = self.asset_resolver(self.spec.assetId)

        if path and Path(path).exists():
            try:
                self._raw_image = Image.open(path).convert("RGBA")
            except Exception as e:
                print(f"[!] Warning: failed to load image at {path}: {e}")
                self._raw_image = None

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

        if self._raw_image is None:
            # Fallback placeholder card if asset is missing
            self._render_placeholder(canvas, transform, canvas_w, canvas_h)
            return

        # Check if Ken Burns / camera effect is requested
        effect = self.spec.imageEffect
        if effect in ("ken_burns", "slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right", "orbital_drift"):
            if self._bg_animator is None:
                self._bg_animator = CosmicBackgroundAnimator(
                    self._raw_image, width=canvas_w, height=canvas_h, cam_mode=effect
                )
            frame_bg = self._bg_animator.render_frame(scene_time, self.spec.duration or 4.0)
            if opacity < 0.999:
                r, g, b, a = frame_bg.split()
                a = a.point(lambda v: int(v * opacity))
                frame_bg.putalpha(a)
            canvas.alpha_composite(frame_bg)
            return

        # Standard layer placement and transform
        src_w, src_h = self._raw_image.size
        dest_w = int(transform["width"]) if transform["width"] > 0 else src_w
        dest_h = int(transform["height"]) if transform["height"] > 0 else src_h

        # Fit calculation
        fit_mode = self.spec.fit
        img_to_place = self._raw_image

        if fit_mode == "cover":
            scale = max(dest_w / src_w, dest_h / src_h)
            nw, nh = int(src_w * scale), int(src_h * scale)
            resized = img_to_place.resize((nw, nh), Image.Resampling.LANCZOS)
            x_off = (nw - dest_w) // 2
            y_off = (nh - dest_h) // 2
            img_to_place = resized.crop((x_off, y_off, x_off + dest_w, y_off + dest_h))
        elif fit_mode == "contain":
            scale = min(dest_w / src_w, dest_h / src_h)
            nw, nh = int(src_w * scale), int(src_h * scale)
            img_to_place = img_to_place.resize((nw, nh), Image.Resampling.LANCZOS)
        elif fit_mode == "stretch":
            img_to_place = img_to_place.resize((dest_w, dest_h), Image.Resampling.LANCZOS)

        # Scale transform
        s = transform["scale"]
        sx = transform["scaleX"] * s
        sy = transform["scaleY"] * s
        if abs(sx - 1.0) > 0.005 or abs(sy - 1.0) > 0.005:
            cur_w, cur_h = img_to_place.size
            nw = max(1, int(cur_w * sx))
            nh = max(1, int(cur_h * sy))
            img_to_place = img_to_place.resize((nw, nh), Image.Resampling.BILINEAR)

        # Rotation transform
        rot = transform["rotation"]
        if abs(rot) > 0.1:
            img_to_place = img_to_place.rotate(-rot, resample=Image.Resampling.BICUBIC, expand=True)

        # Opacity adjustment
        if opacity < 0.999:
            r, g, b, a = img_to_place.split()
            a = a.point(lambda v: int(v * opacity))
            img_to_place.putalpha(a)

        # Anchor positioning
        w_cur, h_cur = img_to_place.size
        x = transform["x"]
        y = transform["y"]
        anchor = self.spec.anchor
        if anchor == "center":
            pos = (int(x - w_cur / 2), int(y - h_cur / 2))
        elif anchor == "top_center":
            pos = (int(x - w_cur / 2), int(y))
        elif anchor == "bottom_center":
            pos = (int(x - w_cur / 2), int(y - h_cur))
        elif anchor == "top_right":
            pos = (int(x - w_cur), int(y))
        elif anchor == "bottom_right":
            pos = (int(x - w_cur), int(y - h_cur))
        else:  # top_left
            pos = (int(x), int(y))

        canvas.alpha_composite(img_to_place, dest=pos)

    def _render_placeholder(self, canvas: Image.Image, transform: Dict[str, float], cw: int, ch: int) -> None:
        draw = ImageDraw.Draw(canvas)
        x = int(transform["x"])
        y = int(transform["y"])
        w = int(transform["width"]) if transform["width"] > 0 else 400
        h = int(transform["height"]) if transform["height"] > 0 else 300
        draw.rectangle([x, y, x + w, y + h], fill=(20, 26, 36, int(150 * transform["opacity"])), outline=(198, 219, 240, 100))
