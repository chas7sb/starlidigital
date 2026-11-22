"""
Transitions Engine
==================
Blends and composes scene transitions: crossfade, dip to black, slides, wipes, zoom, light flash, glitch.
"""

from __future__ import annotations

import math
from typing import Tuple
import numpy as np
from PIL import Image, ImageOps


def blend_transition(
    frame_a: Image.Image,
    frame_b: Image.Image,
    progress: float,
    transition_type: str = "crossfade",
) -> Image.Image:
    """Blends frame_a and frame_b according to transition_type and progress (0.0 to 1.0)."""
    p = max(0.0, min(1.0, progress))
    if p <= 0.001:
        return frame_a
    if p >= 0.999:
        return frame_b

    w, h = frame_a.size

    if transition_type in ("fade", "crossfade"):
        # Smooth alpha blend
        return Image.blend(frame_a, frame_b, p)

    elif transition_type == "dip_to_black":
        # First half dips to black, second half rises from black
        if p < 0.5:
            factor = 1.0 - (p * 2.0)
            black = Image.new("RGBA", (w, h), (8, 12, 18, 255))
            return Image.blend(black, frame_a, factor)
        else:
            factor = (p - 0.5) * 2.0
            black = Image.new("RGBA", (w, h), (8, 12, 18, 255))
            return Image.blend(black, frame_b, factor)

    elif transition_type == "slide_left":
        # Frame A moves left, Frame B enters from right
        res = Image.new("RGBA", (w, h))
        shift_x = int(w * p)
        res.paste(frame_a, (-shift_x, 0))
        res.paste(frame_b, (w - shift_x, 0))
        return res

    elif transition_type == "slide_right":
        # Frame A moves right, Frame B enters from left
        res = Image.new("RGBA", (w, h))
        shift_x = int(w * p)
        res.paste(frame_a, (shift_x, 0))
        res.paste(frame_b, (-w + shift_x, 0))
        return res

    elif transition_type == "slide_up":
        # Frame A moves up, Frame B enters from bottom
        res = Image.new("RGBA", (w, h))
        shift_y = int(h * p)
        res.paste(frame_a, (0, -shift_y))
        res.paste(frame_b, (0, h - shift_y))
        return res

    elif transition_type == "zoom":
        # Frame A zooms in and fades out, Frame B zooms in from slight scale
        scale_a = 1.0 + 0.3 * p
        wa, ha = int(w * scale_a), int(h * scale_a)
        fa_zoomed = frame_a.resize((wa, ha), Image.Resampling.BILINEAR)
        crop_x = (wa - w) // 2
        crop_y = (ha - h) // 2
        fa_cropped = fa_zoomed.crop((crop_x, crop_y, crop_x + w, crop_y + h))
        return Image.blend(fa_cropped, frame_b, p)

    elif transition_type == "wipe_left":
        # Horizontal linear wipe
        split_x = int(w * p)
        res = frame_a.copy()
        crop_b = frame_b.crop((0, 0, split_x, h))
        res.paste(crop_b, (0, 0))
        return res

    elif transition_type == "wipe_right":
        split_x = int(w * (1.0 - p))
        res = frame_a.copy()
        crop_b = frame_b.crop((split_x, 0, w, h))
        res.paste(crop_b, (split_x, 0))
        return res

    elif transition_type == "light_flash":
        # White flash peak around mid-transition
        flash_intensity = math.sin(p * math.pi)
        blended = Image.blend(frame_a, frame_b, p)
        white = Image.new("RGBA", (w, h), (244, 246, 250, 255))
        return Image.blend(blended, white, flash_intensity * 0.75)

    elif transition_type == "glitch":
        # Digital channel split glitch
        blended = Image.blend(frame_a, frame_b, p)
        arr = np.array(blended)
        offset = int(math.sin(p * math.pi * 3.0) * 18.0)
        if offset != 0:
            arr[:, :, 0] = np.roll(arr[:, :, 0], offset, axis=1)
            arr[:, :, 2] = np.roll(arr[:, :, 2], -offset, axis=1)
        return Image.fromarray(arr, mode="RGBA")

    # Default fallback
    return Image.blend(frame_a, frame_b, p)
