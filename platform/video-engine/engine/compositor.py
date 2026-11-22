"""
Frame Compositor
================
Coordinates layer instantiation, background generation, and alpha-compositing for each frame.
"""

from __future__ import annotations

from typing import Callable, Dict, List, Optional
from PIL import Image, ImageDraw

from engine.effects import CosmicBackgroundAnimator, parse_color
from engine.layers import (
    BaseLayer,
    ImageLayer,
    OverlayLayer,
    ParticleLayer,
    ShapeLayer,
    TextLayer,
    UILayer,
)
from engine.schema import SceneSpec, VideoProjectSpec
from engine.timeline import ActiveSceneState, TimelineManager
from engine.transitions import blend_transition


class SceneCompositor:
    """Manages layer renderers and background for a single scene."""

    def __init__(self, scene: SceneSpec, spec: VideoProjectSpec, asset_resolver: Optional[Callable[[str], Optional[str]]] = None):
        self.scene = scene
        self.spec = spec
        self.asset_resolver = asset_resolver
        self.width = spec.canvas.width
        self.height = spec.canvas.height
        self.brand = spec.brand

        # Initialize background animator if image background
        self._bg_animator: Optional[CosmicBackgroundAnimator] = None
        if scene.background.type == "image":
            path = scene.background.assetPath
            if not path and asset_resolver and scene.background.assetId:
                path = asset_resolver(scene.background.assetId)
            if path:
                cam_mode = scene.background.effect or "zoom_in"
                self._bg_animator = CosmicBackgroundAnimator(
                    path, width=self.width, height=self.height, cam_mode=cam_mode
                )

        # Instantiate layer renderers
        self.layers: List[BaseLayer] = []
        for l in scene.layers:
            if l.type == "image":
                self.layers.append(ImageLayer(l, asset_resolver=asset_resolver))
            elif l.type == "text":
                self.layers.append(TextLayer(l))
            elif l.type == "shape":
                self.layers.append(ShapeLayer(l))
            elif l.type == "ui":
                self.layers.append(UILayer(l))
            elif l.type == "particles":
                self.layers.append(ParticleLayer(l, width=self.width, height=self.height))
            elif l.type == "overlay":
                self.layers.append(OverlayLayer(l, width=self.width, height=self.height))

    def render_frame(self, scene_time: float) -> Image.Image:
        # 1. Base canvas / background
        bg = self.scene.background
        if bg.type == "image" and self._bg_animator is not None:
            canvas = self._bg_animator.render_frame(scene_time, self.scene.duration)
        else:
            bg_col = parse_color(bg.color or self.spec.canvas.backgroundColor or "#080C12")
            canvas = Image.new("RGBA", (self.width, self.height), bg_col)

        # 2. Render layers in order
        for layer in self.layers:
            layer.render(
                canvas=canvas,
                scene_time=scene_time,
                canvas_w=self.width,
                canvas_h=self.height,
                brand=self.brand,
            )

        return canvas


class ProjectCompositor:
    """Orchestrates multi-scene composition, global timeline, and transitions."""

    def __init__(self, spec: VideoProjectSpec, asset_resolver: Optional[Callable[[str], Optional[str]]] = None):
        self.spec = spec
        self.asset_resolver = asset_resolver
        self.timeline = TimelineManager(spec)
        self.scene_compositors: Dict[int, SceneCompositor] = {}

        for idx, s in enumerate(spec.scenes):
            self.scene_compositors[idx] = SceneCompositor(
                scene=s,
                spec=spec,
                asset_resolver=asset_resolver,
            )

    def render_frame_at(self, global_t: float) -> Image.Image:
        state: ActiveSceneState = self.timeline.get_state_at(global_t)

        primary_comp = self.scene_compositors[state.primary_scene.index]
        primary_frame = primary_comp.render_frame(state.scene_time)

        # Handle transition if active
        if state.transition_scene is not None and state.transition_progress > 0.0:
            next_comp = self.scene_compositors[state.transition_scene.index]
            # Next scene rendered at entrance (e.g. initial transition time)
            trans_dur = state.transition_scene.transition.duration
            next_t = state.transition_progress * trans_dur
            next_frame = next_comp.render_frame(next_t)

            return blend_transition(
                frame_a=primary_frame,
                frame_b=next_frame,
                progress=state.transition_progress,
                transition_type=state.transition_type,
            )

        return primary_frame
