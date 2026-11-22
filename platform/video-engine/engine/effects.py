"""
Universal Visual Effects & UI Graphic Components
================================================
Implements high-fidelity motion graphics, Ken Burns 2.5D backgrounds,
Pillow & OpenCV drawing primitives, typography with Romanian diacritics, and brand UI.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


FONT_PATHS = {
    "regular": r"C:\Windows\Fonts\segoeui.ttf",
    "light": r"C:\Windows\Fonts\segoeuil.ttf",
    "semilight": r"C:\Windows\Fonts\segoeuisl.ttf",
    "semibold": r"C:\Windows\Fonts\seguisb.ttf",
    "bold": r"C:\Windows\Fonts\segoeuib.ttf",
    "mono": r"C:\Windows\Fonts\consola.ttf",
}

_FONT_CACHE: Dict[Tuple[str, int], ImageFont.FreeTypeFont] = {}


def get_font(weight: str = "regular", size: int = 36) -> ImageFont.FreeTypeFont:
    """Loads a font supporting full Romanian diacritics (ă â î ș ț)."""
    key = (weight, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]

    candidates = [
        FONT_PATHS.get(weight, ""),
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
    ]
    if weight in ("bold", "semibold"):
        candidates.insert(1, r"C:\Windows\Fonts\segoeuib.ttf")
        candidates.insert(2, r"C:\Windows\Fonts\arialbd.ttf")

    variant = "Bold" if weight in ("bold", "semibold") else "Regular"
    family = "DejaVuSansMono" if weight == "mono" else "DejaVuSans"
    candidates += [
        f"/usr/share/fonts/truetype/dejavu/{family}{'-Bold' if variant == 'Bold' else ''}.ttf",
        f"/usr/share/fonts/truetype/liberation2/LiberationSans-{variant}.ttf",
        f"/usr/share/fonts/truetype/liberation/LiberationSans-{variant}.ttf",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size=size)
                _FONT_CACHE[key] = font
                return font
            except Exception:
                continue

    font = ImageFont.load_default(size=size)
    _FONT_CACHE[key] = font
    return font


def parse_color(c: Union[str, Tuple[int, int, int], Tuple[int, int, int, int]], default_alpha: int = 255) -> Tuple[int, int, int, int]:
    """Converts hex strings or rgb tuples to (R, G, B, A)."""
    if isinstance(c, (tuple, list)):
        if len(c) == 3:
            return (int(c[0]), int(c[1]), int(c[2]), default_alpha)
        if len(c) >= 4:
            return (int(c[0]), int(c[1]), int(c[2]), int(c[3]))
        return (255, 255, 255, default_alpha)

    c_str = str(c).strip().lstrip("#")
    if len(c_str) == 6:
        r = int(c_str[0:2], 16)
        g = int(c_str[2:4], 16)
        b = int(c_str[4:6], 16)
        return (r, g, b, default_alpha)
    if len(c_str) == 8:
        r = int(c_str[0:2], 16)
        g = int(c_str[2:4], 16)
        b = int(c_str[4:6], 16)
        a = int(c_str[6:8], 16)
        return (r, g, b, a)
    if len(c_str) == 3:
        r = int(c_str[0] * 2, 16)
        g = int(c_str[1] * 2, 16)
        b = int(c_str[2] * 2, 16)
        return (r, g, b, default_alpha)

    return (255, 255, 255, default_alpha)


def draw_tracked_text(
    draw: ImageDraw.ImageDraw,
    pos: Tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: Tuple[int, int, int, int],
    tracking: float = 0.0,
    align: str = "left",
) -> float:
    """Renders text with letter-spacing tracking and Unicode / Romanian diacritics."""
    if tracking == 0.0:
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        x, y = pos
        if align == "center":
            x -= w / 2.0
        elif align == "right":
            x -= w
        draw.text((x, y), text, font=font, fill=fill)
        return w

    char_widths = []
    for ch in text:
        cb = draw.textbbox((0, 0), ch, font=font)
        char_widths.append(cb[2] - cb[0])
    total_w = sum(char_widths) + tracking * max(0, len(text) - 1)

    x, y = pos
    if align == "center":
        x -= total_w / 2.0
    elif align == "right":
        x -= total_w

    curr_x = x
    for ch, cw in zip(text, char_widths):
        draw.text((curr_x, y), ch, font=font, fill=fill)
        curr_x += cw + tracking
    return total_w


def compute_star_polygon(cx: float, cy: float, radius: float, pinch: float = 0.14, rotation_deg: float = 0.0) -> List[Tuple[float, float]]:
    """Calculates polygon points for the Starli 4-point star matching symbol.svg."""
    pts: List[Tuple[float, float]] = []
    angles = [-math.pi / 2, 0.0, math.pi / 2, math.pi]
    rot = math.radians(rotation_deg)

    steps_per_quadrant = 24
    for i in range(4):
        a0 = angles[i] + rot
        a1 = angles[(i + 1) % 4] + rot
        p0 = (cx + math.cos(a0) * radius, cy + math.sin(a0) * radius)
        p3 = (cx + math.cos(a1) * radius, cy + math.sin(a1) * radius)

        c1_r = radius * 0.22
        c_mid = radius * pinch
        p1 = (
            cx + math.cos(a0) * c1_r + math.cos(a1) * (c_mid * 0.65),
            cy + math.sin(a0) * c1_r + math.sin(a1) * (c_mid * 0.65),
        )
        p2 = (
            cx + math.cos(a1) * c1_r + math.cos(a0) * (c_mid * 0.65),
            cy + math.sin(a1) * c1_r + math.sin(a0) * (c_mid * 0.65),
        )

        for s in range(steps_per_quadrant):
            u = s / steps_per_quadrant
            iu = 1.0 - u
            bx = (iu ** 3) * p0[0] + 3 * (iu ** 2) * u * p1[0] + 3 * iu * (u ** 2) * p2[0] + (u ** 3) * p3[0]
            by = (iu ** 3) * p0[1] + 3 * (iu ** 2) * u * p1[1] + 3 * iu * (u ** 2) * p2[1] + (u ** 3) * p3[1]
            pts.append((bx, by))
    return pts


def draw_starli_symbol(
    canvas: Image.Image,
    cx: float,
    cy: float,
    radius: float,
    alpha: float = 1.0,
    glow_strength: float = 1.0,
    pulse: float = 0.0,
    accent_rgb: Tuple[int, int, int] = (198, 219, 240),
) -> None:
    """Renders the official Starli 4-point star with ice-blue inner core and bloom."""
    if alpha <= 0.01 or radius <= 1.0:
        return

    r_eff = radius * (1.0 + 0.05 * math.sin(pulse))
    pad = int(r_eff * 2.8) + 24
    w_box = pad * 2
    h_box = pad * 2

    # Outer glow bloom
    if glow_strength > 0.05:
        glow_patch = Image.new("RGBA", (w_box, h_box), (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(glow_patch)
        g_pts = compute_star_polygon(pad, pad, r_eff * 1.35, pinch=0.20)
        gdraw.polygon(g_pts, fill=(*accent_rgb, int(115 * alpha * glow_strength)))
        flare_w = r_eff * 2.4
        flare_h = max(2.0, r_eff * 0.08)
        gdraw.ellipse(
            [pad - flare_w, pad - flare_h, pad + flare_w, pad + flare_h],
            fill=(*accent_rgb, int(90 * alpha * glow_strength)),
        )
        gdraw.ellipse(
            [pad - flare_h, pad - flare_w * 0.85, pad + flare_h, pad + flare_w * 0.85],
            fill=(*accent_rgb, int(75 * alpha * glow_strength)),
        )
        glow_patch = glow_patch.filter(ImageFilter.GaussianBlur(radius=max(3, int(r_eff * 0.32))))
        canvas.alpha_composite(glow_patch, dest=(int(cx - pad), int(cy - pad)))

    patch = Image.new("RGBA", (w_box, h_box), (0, 0, 0, 0))
    draw = ImageDraw.Draw(patch)
    outer_pts = compute_star_polygon(pad, pad, r_eff, pinch=0.135)
    draw.polygon(outer_pts, fill=(244, 246, 250, int(255 * alpha)))

    inner_pts = compute_star_polygon(pad, pad, r_eff * 0.66, pinch=0.16)
    draw.polygon(inner_pts, fill=(*accent_rgb, int(155 * alpha)))

    canvas.alpha_composite(patch, dest=(int(cx - pad), int(cy - pad)))


def draw_glass_card(
    canvas: Image.Image,
    box: Tuple[float, float, float, float],
    radius: int = 24,
    fill_alpha: int = 195,
    border_alpha: int = 85,
    ice_tint: bool = False,
    highlight_top: bool = True,
    bg_rgb: Tuple[int, int, int] = (16, 21, 29),
    border_rgb: Tuple[int, int, int] = (198, 219, 240),
) -> None:
    """Renders a frosted obsidian dark glass card with drop shadow and highlight rim."""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    if x1 <= x0 or y1 <= y0 or fill_alpha <= 0:
        return

    w_card = x1 - x0
    h_card = y1 - y0
    pad = 32
    patch = Image.new("RGBA", (w_card + pad * 2, h_card + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(patch)

    # Multi-step drop shadow
    for s_i in range(3, 0, -1):
        spread = s_i * 4
        s_alpha = int((fill_alpha * 0.12) * (4 - s_i) / 3)
        draw.rounded_rectangle(
            [pad - spread // 2 + 2, pad + 6 + spread // 2, pad + w_card + spread // 2 + 2, pad + h_card + 8 + spread],
            radius=radius + spread // 2,
            fill=(0, 0, 0, s_alpha),
        )

    base_fill = (18, 26, 38, fill_alpha) if ice_tint else (*bg_rgb, fill_alpha)
    outline_col = (*border_rgb, border_alpha) if ice_tint else (255, 255, 255, border_alpha)

    draw.rounded_rectangle([pad, pad, pad + w_card, pad + h_card], radius=radius, fill=base_fill, outline=outline_col, width=2)

    if highlight_top and w_card > radius * 2:
        draw.line(
            [(pad + radius, pad + 1), (pad + w_card - radius, pad + 1)],
            fill=(*border_rgb, min(255, int(border_alpha * 1.5))),
            width=2,
        )

    canvas.alpha_composite(patch, dest=(x0 - pad, y0 - pad))


def draw_up_right_arrow(
    draw: ImageDraw.ImageDraw,
    cx: float,
    cy: float,
    size: float,
    color: Tuple[int, int, int, int],
    width: int = 3,
) -> None:
    """Draws a crisp diagonal up-right arrow (↗)."""
    half = size / 2.0
    x0, y0 = cx - half, cy + half
    x1, y1 = cx + half, cy - half
    draw.line([(x0, y0), (x1, y1)], fill=color, width=width)
    draw.line([(x1 - size * 0.65, y1), (x1, y1), (x1, y1 + size * 0.65)], fill=color, width=width)


class CosmicBackgroundAnimator:
    """Ken Burns 2.5D background animator with subpixel OpenCV warp, volumetric glow, and vignette."""

    def __init__(self, image: Union[Image.Image, Path, str], width: int = 1080, height: int = 1920, cam_mode: str = "zoom_in"):
        self.width = width
        self.height = height
        self.cam_mode = cam_mode

        if isinstance(image, (str, Path)):
            p = Path(image)
            if p.exists():
                raw = Image.open(p).convert("RGB")
            else:
                raw = Image.new("RGB", (width, height), (8, 12, 18))
        else:
            raw = image.convert("RGB")

        # 22% overscan for smooth subpixel camera pan/zoom
        self.overscan = 1.22
        target_w = int(width * self.overscan)
        target_h = int(height * self.overscan)

        src_w, src_h = raw.size
        scale = max(target_w / src_w, target_h / src_h)
        new_w, new_h = int(src_w * scale), int(src_h * scale)
        resized = raw.resize((new_w, new_h), Image.Resampling.LANCZOS)

        left = (new_w - target_w) // 2
        top = (new_h - target_h) // 2
        self.base_img = np.array(resized.crop((left, top, left + target_w, top + target_h)), dtype=np.float32)

        # Precompute vignette mask
        yy, xx = np.mgrid[0:height, 0:width]
        y_norm = yy / float(height)
        x_norm = xx / float(width)
        top_shade = np.clip((0.52 - y_norm) / 0.52, 0.0, 1.0) * 0.52
        bot_shade = np.clip((y_norm - 0.78) / 0.22, 0.0, 1.0) * 0.65
        edge_shade = np.clip(((x_norm - 0.5) ** 2 + (y_norm - 0.5) ** 2) * 0.65, 0.0, 0.35)
        self.vignette_keep = np.clip(1.0 - np.maximum(top_shade, bot_shade) - edge_shade * 0.4, 0.22, 1.0)[..., None]

    def render_frame(self, t: float, duration: float = 4.0) -> Image.Image:
        u = max(0.0, min(1.0, t / max(0.001, duration)))
        # ease in-out cubic
        u_smooth = 4 * u * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2

        h_src, w_src, _ = self.base_img.shape
        cx_base = w_src / 2.0
        cy_base = h_src / 2.0

        if self.cam_mode == "zoom_in":
            zoom = 1.0 + 0.14 * u_smooth
            pan_x = math.sin(u * math.pi) * 28.0
            pan_y = -25.0 * u_smooth
        elif self.cam_mode == "zoom_out":
            zoom = 1.15 - 0.13 * u_smooth
            pan_x = 25.0 * (1.0 - u_smooth)
            pan_y = -20.0 + 40.0 * u_smooth
        elif self.cam_mode == "pan_left":
            zoom = 1.08
            pan_x = 40.0 - 80.0 * u_smooth
            pan_y = 0.0
        elif self.cam_mode == "pan_right":
            zoom = 1.08
            pan_x = -40.0 + 80.0 * u_smooth
            pan_y = 0.0
        elif self.cam_mode == "orbital_drift":
            zoom = 1.05 + 0.09 * math.sin(u * math.pi)
            pan_x = -38.0 + 76.0 * u_smooth
            pan_y = -18.0 * math.cos(u * math.pi)
        else:
            zoom = 1.0 + 0.08 * u_smooth
            pan_x = 0.0
            pan_y = -15.0 * u_smooth

        M = np.float32([
            [zoom, 0.0, (self.width / 2.0) - zoom * (cx_base + pan_x)],
            [0.0, zoom, (self.height / 2.0) - zoom * (cy_base + pan_y)],
        ])
        warped = cv2.warpAffine(
            self.base_img,
            M,
            (self.width, self.height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )

        # Highlight breathing glow
        pulse = 0.5 + 0.5 * math.sin(t * 2.2)
        luma = (0.2126 * warped[:, :, 0] + 0.7152 * warped[:, :, 1] + 0.0722 * warped[:, :, 2]) / 255.0
        bright_mask = np.clip((luma - 0.55) / 0.45, 0.0, 1.0)[..., None]
        ice_boost = np.array([198, 219, 240], dtype=np.float32)[None, None, :]
        warped = warped + bright_mask * ice_boost * (0.09 * pulse)

        # Vignette
        obs = np.array([8, 12, 18], dtype=np.float32)[None, None, :]
        framed = warped * self.vignette_keep + obs * (1.0 - self.vignette_keep)
        framed_u8 = np.clip(framed, 0, 255).astype(np.uint8)

        return Image.fromarray(framed_u8, mode="RGB").convert("RGBA")


class ParallaxParticleSystem:
    """Precomputed multi-layer 3D parallax drifting starfield and dust particles."""

    def __init__(self, count: int = 70, width: int = 1080, height: int = 1920, seed: int = 42):
        self.count = count
        self.width = width
        self.height = height
        rng = np.random.default_rng(seed)
        self.px = rng.uniform(0, width, count)
        self.py = rng.uniform(0, height, count)
        self.pz = rng.uniform(0.3, 1.8, count)  # depth speed
        self.pr = rng.uniform(1.2, 3.8, count)  # radius
        self.p_phase = rng.uniform(0, math.tau, count)
        self.p_is_ice = rng.random(count) > 0.35

    def render_onto(self, canvas: Image.Image, t: float, opacity: float = 1.0) -> None:
        if opacity <= 0.01:
            return
        p_layer = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        p_draw = ImageDraw.Draw(p_layer)
        for i in range(self.count):
            px = (self.px[i] + t * 9.0 * self.pz[i]) % self.width
            py = (self.py[i] - t * 24.0 * self.pz[i]) % self.height
            twinkle = 0.35 + 0.65 * (0.5 + 0.5 * math.sin(t * 3.2 + self.p_phase[i]))
            alpha = int(160 * twinkle * min(1.0, self.pz[i] * 0.75) * opacity)
            col = (198, 219, 240, alpha) if self.p_is_ice[i] else (244, 246, 250, alpha)
            r = self.pr[i]
            p_draw.ellipse([px - r, py - r, px + r, py + r], fill=col)

        canvas.alpha_composite(p_layer)
