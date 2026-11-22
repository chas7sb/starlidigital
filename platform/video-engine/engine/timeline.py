"""
Timeline Engine
===============
Handles global time mapping, scene sequencing, transition overlapping, and active layer scheduling.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple
from engine.schema import VideoProjectSpec, SceneSpec, LayerSpec, TransitionSpec


@dataclass
class SceneTiming:
    index: int
    scene: SceneSpec
    global_start: float
    duration: float
    global_end: float

    @property
    def transition(self) -> TransitionSpec:
        return self.scene.transition


@dataclass
class ActiveSceneState:
    primary_scene: SceneTiming
    scene_time: float
    transition_scene: Optional[SceneTiming] = None
    transition_progress: float = 0.0
    transition_type: str = "none"


class TimelineManager:
    """Manages scene timing and maps global time to scene frames."""

    def __init__(self, spec: VideoProjectSpec):
        self.spec = spec
        self.scene_timings: List[SceneTiming] = []
        curr_time = 0.0
        for idx, scene in enumerate(spec.scenes):
            end_time = curr_time + scene.duration
            self.scene_timings.append(
                SceneTiming(
                    index=idx,
                    scene=scene,
                    global_start=curr_time,
                    duration=scene.duration,
                    global_end=end_time,
                )
            )
            curr_time = end_time
        self.total_duration = curr_time if not spec.canvas.duration else spec.canvas.duration

    def get_state_at(self, global_t: float) -> ActiveSceneState:
        if not self.scene_timings:
            raise ValueError("No scenes available in timeline")

        # Clamp global_t
        global_t = max(0.0, min(self.total_duration, global_t))

        # Find current scene
        current_st = self.scene_timings[0]
        for st in self.scene_timings:
            if st.global_start <= global_t <= st.global_end:
                current_st = st
                break
            if global_t > st.global_end:
                current_st = st

        scene_local_t = global_t - current_st.global_start

        # Check for transition into the next scene
        next_idx = current_st.index + 1
        if next_idx < len(self.scene_timings):
            next_st = self.scene_timings[next_idx]
            trans = next_st.transition
            if trans and trans.type != "none" and trans.duration > 0.0:
                time_until_end = current_st.global_end - global_t
                if time_until_end <= trans.duration:
                    progress = 1.0 - (time_until_end / trans.duration)
                    return ActiveSceneState(
                        primary_scene=current_st,
                        scene_time=scene_local_t,
                        transition_scene=next_st,
                        transition_progress=max(0.0, min(1.0, progress)),
                        transition_type=trans.type,
                    )

        return ActiveSceneState(
            primary_scene=current_st,
            scene_time=scene_local_t,
            transition_scene=None,
            transition_progress=0.0,
            transition_type="none",
        )
