"""
Animation & Easing Engine
=========================
Pure mathematical interpolators and easing functions for property transitions.
"""

from __future__ import annotations

import math
from typing import Callable, Dict, List, Optional, Tuple
from engine.schema import AnimationSpec


def clamp(val: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, val))


def linear(t: float) -> float:
    return clamp(t)


def ease_in_quad(t: float) -> float:
    t = clamp(t)
    return t * t


def ease_out_quad(t: float) -> float:
    t = clamp(t)
    return 1.0 - (1.0 - t) * (1.0 - t)


def ease_in_cubic(t: float) -> float:
    t = clamp(t)
    return t * t * t


def ease_out_cubic(t: float) -> float:
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 3


def ease_in_out_cubic(t: float) -> float:
    t = clamp(t)
    return 4.0 * t * t * t if t < 0.5 else 1.0 - (-2.0 * t + 2.0) ** 3 / 2.0


def ease_out_quart(t: float) -> float:
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 4


def ease_in_out_quart(t: float) -> float:
    t = clamp(t)
    return 8.0 * t * t * t * t if t < 0.5 else 1.0 - (-2.0 * t + 2.0) ** 4 / 2.0


def ease_out_back(t: float, overshoot: float = 1.35) -> float:
    t = clamp(t)
    c1 = overshoot
    c3 = c1 + 1.0
    return 1.0 + c3 * ((t - 1.0) ** 3) + c1 * ((t - 1.0) ** 2)


EASING_MAP: Dict[str, Callable[[float], float]] = {
    "linear": linear,
    "easeIn": ease_in_cubic,
    "easeOut": ease_out_cubic,
    "easeInOut": ease_in_out_cubic,
    "easeOutCubic": ease_out_cubic,
    "easeOutQuart": ease_out_quart,
    "easeInOutCubic": ease_in_out_cubic,
    "easeOutBack": ease_out_back,
}


def evaluate_easing(easing_name: str, progress_val: float) -> float:
    fn = EASING_MAP.get(easing_name, ease_in_out_cubic)
    return fn(clamp(progress_val))


def interpolate(from_val: float, to_val: float, factor: float) -> float:
    return from_val + (to_val - from_val) * factor


class PropertyTimeline:
    """Computes animated numeric properties for a layer given scene-local time."""

    def __init__(self, base_values: Dict[str, float], animations: List[AnimationSpec]):
        self.base_values = dict(base_values)
        self.animations = animations

    def get_value(self, prop: str, scene_time: float) -> float:
        # Start with default base value
        val = self.base_values.get(prop, 0.0)

        # Look for animations affecting this property
        relevant = [a for a in self.animations if a.property == prop]
        if not relevant:
            return val

        # Evaluate animations in order
        for anim in relevant:
            if scene_time < anim.start:
                # Before animation starts, maintain starting value if it is the first or primary animation
                val = anim.fromValue
            elif scene_time >= anim.start + anim.duration:
                # After animation ends, hold ending value
                val = anim.toValue
            else:
                # In between
                raw_progress = (scene_time - anim.start) / max(0.0001, anim.duration)
                eased = evaluate_easing(anim.easing, raw_progress)
                val = interpolate(anim.fromValue, anim.toValue, eased)

        return val
