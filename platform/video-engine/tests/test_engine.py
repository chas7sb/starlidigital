"""
Video Engine Test Suite
=======================
Unit and integration tests for schema validation, animation easings,
timeline mapping, layers, and audio synthesis.
"""

import unittest
from pathlib import Path
from engine.animation import PropertyTimeline, ease_in_out_cubic, ease_out_back, ease_out_cubic
from engine.audio import synthesize_cosmic_pad
from engine.compositor import ProjectCompositor
from engine.schema import (
    AnimationSpec,
    CanvasSpec,
    LayerSpec,
    SceneSpec,
    VideoProjectSpec,
    parse_video_spec,
)
from engine.timeline import TimelineManager


class TestVideoSchema(unittest.TestCase):
    def test_default_schema_valid(self):
        spec = VideoProjectSpec(
            scenes=[
                SceneSpec(
                    duration=4.0,
                    layers=[LayerSpec(type="text", text="Salut Starli")],
                )
            ]
        )
        errors = spec.validate()
        self.assertEqual(len(errors), 0)
        self.assertEqual(spec.total_duration, 4.0)

    def test_bounds_validation(self):
        # Invalid width & height & fps
        spec = VideoProjectSpec(
            canvas=CanvasSpec(width=100, height=5000, fps=120),
            scenes=[],
        )
        errors = spec.validate()
        err_codes = [e.code for e in errors]
        self.assertIn("INVALID_DIMENSION", err_codes)
        self.assertIn("INVALID_FPS", err_codes)
        self.assertIn("EMPTY_SCENES", err_codes)

    def test_invalid_opacity_and_transition(self):
        spec = VideoProjectSpec(
            scenes=[
                SceneSpec(
                    duration=3.0,
                    layers=[LayerSpec(type="text", text="Test", opacity=1.5)],
                )
            ]
        )
        spec.scenes[0].transition.type = "unsupported_transition"
        errors = spec.validate()
        codes = [e.code for e in errors]
        self.assertIn("INVALID_OPACITY", codes)
        self.assertIn("INVALID_TRANSITION", codes)

    def test_parse_json_dict(self):
        raw = {
            "canvas": {"width": 1080, "height": 1920, "fps": 30},
            "scenes": [
                {
                    "duration": 5.0,
                    "background": {"type": "color", "color": "#080C12"},
                    "layers": [
                        {
                            "type": "text",
                            "text": "Compania Ta\nÎn Viitor",
                            "fontSize": 52,
                            "align": "center",
                        }
                    ],
                }
            ],
        }
        spec = parse_video_spec(raw)
        self.assertEqual(spec.canvas.width, 1080)
        self.assertEqual(spec.scenes[0].duration, 5.0)
        self.assertEqual(len(spec.validate()), 0)


class TestAnimation(unittest.TestCase):
    def test_easings(self):
        self.assertAlmostEqual(ease_out_cubic(0.0), 0.0)
        self.assertAlmostEqual(ease_out_cubic(1.0), 1.0)
        self.assertGreater(ease_out_cubic(0.5), 0.5)

        self.assertAlmostEqual(ease_in_out_cubic(0.0), 0.0)
        self.assertAlmostEqual(ease_in_out_cubic(0.5), 0.5)
        self.assertAlmostEqual(ease_in_out_cubic(1.0), 1.0)

        # Overshoot of easeOutBack
        self.assertGreater(ease_out_back(0.7), 1.0)
        self.assertAlmostEqual(ease_out_back(1.0), 1.0)

    def test_property_timeline(self):
        anims = [
            AnimationSpec(
                property="scale",
                fromValue=1.0,
                toValue=1.2,
                start=1.0,
                duration=2.0,
                easing="linear",
            )
        ]
        tl = PropertyTimeline({"scale": 1.0}, anims)
        self.assertAlmostEqual(tl.get_value("scale", 0.5), 1.0)
        self.assertAlmostEqual(tl.get_value("scale", 2.0), 1.1)
        self.assertAlmostEqual(tl.get_value("scale", 3.0), 1.2)
        self.assertAlmostEqual(tl.get_value("scale", 4.0), 1.2)


class TestTimeline(unittest.TestCase):
    def test_scene_sequencing_and_transitions(self):
        spec = VideoProjectSpec(
            scenes=[
                SceneSpec(id="s1", duration=4.0),
                SceneSpec(id="s2", duration=4.0),
            ]
        )
        spec.scenes[1].transition.type = "crossfade"
        spec.scenes[1].transition.duration = 1.0

        tm = TimelineManager(spec)
        self.assertEqual(tm.total_duration, 8.0)

        # Mid scene 1
        st = tm.get_state_at(2.0)
        self.assertEqual(st.primary_scene.scene.id, "s1")
        self.assertAlmostEqual(st.scene_time, 2.0)
        self.assertIsNone(st.transition_scene)

        # Overlap in transition into scene 2 (between 3.0 and 4.0s)
        st_trans = tm.get_state_at(3.5)
        self.assertEqual(st_trans.primary_scene.scene.id, "s1")
        self.assertIsNotNone(st_trans.transition_scene)
        self.assertEqual(st_trans.transition_scene.scene.id, "s2")
        self.assertAlmostEqual(st_trans.transition_progress, 0.5)


class TestCompositor(unittest.TestCase):
    def test_render_frame_with_layers(self):
        spec = VideoProjectSpec(
            canvas=CanvasSpec(width=480, height=854, fps=30),
            scenes=[
                SceneSpec(
                    duration=3.0,
                    layers=[
                        LayerSpec(type="shape", shape="starli_star", x=240, y=100, width=50, height=50),
                        LayerSpec(type="text", text="Test Română: ă â î ș ț", fontSize=28, x=50, y=200),
                        LayerSpec(type="ui", component="status_pill", x=50, y=300, componentProps={"label": "ACTIV"}),
                        LayerSpec(type="ui", component="glass_card", x=50, y=400, width=380, height=120),
                        LayerSpec(type="particles", particleCount=20),
                        LayerSpec(type="overlay", overlayIntensity=0.4),
                    ],
                )
            ],
        )
        comp = ProjectCompositor(spec)
        frame = comp.render_frame_at(1.0)
        self.assertEqual(frame.size, (480, 854))
        self.assertEqual(frame.mode, "RGBA")


class TestAudio(unittest.TestCase):
    def test_synthesize_pad(self):
        pad = synthesize_cosmic_pad(duration=1.0)
        self.assertEqual(pad.shape, (44100, 2))
        self.assertGreater(abs(pad).max(), 0.1)


class TestResourceLimits(unittest.TestCase):
    def test_expensive_parameters_rejected(self):
        for layer in [LayerSpec(fontSize=10**9), LayerSpec(width=10**9), LayerSpec(particleCount=10**9), LayerSpec(text="x" * 10001), LayerSpec(opacity=float("nan"))]:
            spec = VideoProjectSpec(scenes=[SceneSpec(layers=[layer])])
            self.assertTrue(spec.validate())
        self.assertTrue(VideoProjectSpec(scenes=[SceneSpec()] * 61).validate())
        self.assertTrue(VideoProjectSpec(scenes=[SceneSpec(layers=[LayerSpec()] * 101)]).validate())

class TestActualEncoding(unittest.TestCase):
    def test_small_mp4_without_network(self):
        import tempfile
        from pathlib import Path
        from engine.renderer import VideoRenderer
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            spec = VideoProjectSpec(canvas=CanvasSpec(width=240, height=240, fps=10), scenes=[SceneSpec(duration=0.3, layers=[LayerSpec(type="text", text="Starli", fontSize=24)])])
            result = VideoRenderer(spec, root / "work").render_video(root / "result.mp4", root / "thumb.jpg")
            self.assertGreater(result.stat().st_size, 1000)
            self.assertTrue((root / "thumb.jpg").exists())

if __name__ == "__main__":
    unittest.main()
