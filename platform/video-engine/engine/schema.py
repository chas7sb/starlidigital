"""
Universal Programmatic Video Engine - VideoSpec Declarative Schema
==================================================================
Defines typed data models and validation for declarative video projects.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union


VALID_EASINGS = {
    "linear",
    "easeIn",
    "easeOut",
    "easeInOut",
    "easeOutCubic",
    "easeOutQuart",
    "easeInOutCubic",
    "easeOutBack",
}

VALID_TRANSITIONS = {
    "none",
    "cut",
    "fade",
    "crossfade",
    "dip_to_black",
    "slide_left",
    "slide_right",
    "slide_up",
    "slide_down",
    "zoom",
    "wipe_left",
    "wipe_right",
    "light_flash",
    "glitch",
}

VALID_LAYER_TYPES = {"image", "text", "shape", "ui", "particles", "overlay"}

VALID_SHAPES = {"rectangle", "rounded_rectangle", "circle", "line", "starli_star", "arrow"}

VALID_UI_COMPONENTS = {
    "glass_card",
    "status_pill",
    "chat_bubble",
    "progress_bar",
    "browser_frame",
    "metric_card",
    "cta_button",
    "header_bar",
    "footer_cta",
}

VALID_EFFECTS = {
    "ken_burns",
    "slow_zoom_in",
    "slow_zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "orbital_drift",
    "pulse",
    "breathing_glow",
    "vignette",
    "light_rays",
    "particle_field",
    "film_grain",
}


@dataclass
class ValidationError:
    path: str
    code: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"path": self.path, "code": self.code, "message": self.message}


@dataclass
class CanvasSpec:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    duration: Optional[float] = None  # Auto-calculated from scenes if None
    backgroundColor: str = "#080C12"


@dataclass
class BrandSpec:
    businessName: str = "StarliDigital"
    logoUrl: Optional[str] = None
    logoAssetId: Optional[str] = None
    symbolAssetId: Optional[str] = None
    primaryColor: str = "#080C12"
    secondaryColor: str = "#10151D"
    lineColor: str = "#262D38"
    accentColor: str = "#C6DBF0"
    textColor: str = "#F4F6FA"
    silverColor: str = "#A8B0BD"
    mutedColor: str = "#8993A3"
    onlineColor: str = "#ACDBBF"
    fontRegular: str = "regular"
    fontBold: str = "bold"
    fontSemibold: str = "semibold"
    tagline: str = "Agenția Digitală Condusă de Starli AI"
    website: str = "starlidigital.ro"
    ctaText: str = "Construiește cu Starli"


@dataclass
class AnimationSpec:
    property: str  # x, y, scale, scaleX, scaleY, rotation, opacity, blur, width, height, progress
    fromValue: float
    toValue: float
    start: float = 0.0  # Relative to scene/layer start (seconds)
    duration: float = 1.0  # Duration of animation (seconds)
    easing: str = "easeInOutCubic"


@dataclass
class TransitionSpec:
    type: str = "crossfade"  # fade, crossfade, dip_to_black, slide_left, zoom, etc.
    duration: float = 0.5  # seconds


@dataclass
class BackgroundSpec:
    type: str = "color"  # color, image, gradient
    color: str = "#080C12"
    assetId: Optional[str] = None
    assetPath: Optional[str] = None
    effect: Optional[str] = None  # ken_burns, slow_zoom_in, orbital_drift, etc.
    effectParams: Dict[str, Any] = field(default_factory=dict)
    gradient: Optional[Dict[str, Any]] = None


@dataclass
class LayerSpec:
    id: str = ""
    type: str = "text"  # image, text, shape, ui, particles, overlay
    x: float = 0.0
    y: float = 0.0
    width: Optional[float] = None
    height: Optional[float] = None
    anchor: str = "top_left"  # top_left, center, top_center, bottom_center, etc.
    opacity: float = 1.0
    rotation: float = 0.0  # degrees
    start: float = 0.0  # seconds relative to scene start
    duration: Optional[float] = None  # seconds (None = scene duration)
    animations: List[AnimationSpec] = field(default_factory=list)

    # Image properties
    assetId: Optional[str] = None
    assetPath: Optional[str] = None
    fit: str = "cover"  # cover, contain, stretch, none
    crop: Optional[List[float]] = None  # [x, y, w, h] normalized 0..1
    imageEffect: Optional[str] = None
    imageEffectParams: Dict[str, Any] = field(default_factory=dict)

    # Text properties
    text: str = ""
    font: str = "regular"  # regular, light, semilight, semibold, bold, mono
    fontSize: int = 36
    fontWeight: str = "regular"
    color: str = "#F4F6FA"
    align: str = "left"  # left, center, right
    tracking: float = 0.0  # letter spacing
    lineHeight: float = 1.25
    textEffect: str = "none"  # none, fade, slide_up, typewriter, word_reveal, blur_in
    backgroundCard: bool = False
    cardPadding: int = 16
    cardRadius: int = 12
    cardColor: str = "#10151D"
    cardAlpha: float = 0.8

    # Shape properties
    shape: str = "rectangle"  # rectangle, rounded_rectangle, circle, line, starli_star, arrow
    radius: int = 16
    fill: Optional[str] = "#10151D"
    stroke: Optional[str] = "#C6DBF0"
    strokeWidth: int = 2
    arrowDirection: str = "up_right"
    arrowSize: float = 24.0

    # UI Component properties
    component: str = "glass_card"
    componentProps: Dict[str, Any] = field(default_factory=dict)
    theme: str = "obsidian"  # obsidian, ice, surface

    # Particles properties
    particleCount: int = 60
    particleStyle: str = "cosmic"  # cosmic, dust, sparkle
    particleSpeed: float = 1.0
    particleColor: str = "#C6DBF0"

    # Overlay properties
    overlayType: str = "vignette"  # vignette, gradient, film_grain
    overlayIntensity: float = 0.5


@dataclass
class SceneSpec:
    id: str = ""
    duration: float = 4.0  # seconds
    background: BackgroundSpec = field(default_factory=BackgroundSpec)
    transition: TransitionSpec = field(default_factory=lambda: TransitionSpec(type="none", duration=0.0))
    layers: List[LayerSpec] = field(default_factory=list)


@dataclass
class AudioTrackSpec:
    id: str = ""
    assetId: Optional[str] = None
    assetPath: Optional[str] = None
    syntheticType: Optional[str] = None  # cosmic_pad, ambient_drone, sub_bass, whoosh, chime
    start: float = 0.0  # timeline second
    duration: Optional[float] = None
    volume: float = 0.6  # 0.0 to 1.0
    fadeIn: float = 0.5
    fadeOut: float = 0.8
    loop: bool = True


@dataclass
class VoiceoverSpec:
    id: str = ""
    text: str = ""
    voice: str = "ro-RO-AlinaNeural"  # ro-RO-AlinaNeural, ro-RO-EmilNeural, en-US-JennyNeural, etc.
    language: str = "ro"
    start: float = 0.0
    assetId: Optional[str] = None
    assetPath: Optional[str] = None
    volume: float = 1.0
    ducking: bool = True
    duckVolume: float = 0.25  # Music level when voice is speaking


@dataclass
class OutputSettingsSpec:
    format: str = "mp4"
    codec: str = "h264"
    crf: int = 20
    preset: str = "fast"
    thumbnailTimestamp: Optional[float] = None  # Defaults to duration / 2


@dataclass
class VideoProjectSpec:
    version: str = "1.0"
    title: str = "Untitled Video"
    canvas: CanvasSpec = field(default_factory=CanvasSpec)
    brand: BrandSpec = field(default_factory=BrandSpec)
    assets: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    scenes: List[SceneSpec] = field(default_factory=list)
    audioTracks: List[AudioTrackSpec] = field(default_factory=list)
    voiceovers: List[VoiceoverSpec] = field(default_factory=list)
    output: OutputSettingsSpec = field(default_factory=OutputSettingsSpec)

    @property
    def total_duration(self) -> float:
        if self.canvas.duration is not None and self.canvas.duration > 0:
            return float(self.canvas.duration)
        if not self.scenes:
            return 0.0
        return sum(s.duration for s in self.scenes)

    def validate(self) -> List[ValidationError]:
        errors: List[ValidationError] = []
        limits = {"scenes": 60, "layers": 100, "animations": 100, "audioTracks": 20, "voiceovers": 20}
        def check(value, path="spec", depth=0):
            if depth > 25:
                errors.append(ValidationError(path, "LIMIT", "Maximum nesting exceeded")); return
            if isinstance(value, dict):
                for key, item in value.items():
                    location = f"{path}.{key}"
                    if key in limits and isinstance(item, list) and len(item) > limits[key]:
                        errors.append(ValidationError(location, "LIMIT", "Too many items")); continue
                    if key in ("width", "height", "fontSize") and isinstance(item, (int, float)) and not (0 <= item <= 7680):
                        errors.append(ValidationError(location, "LIMIT", "Dimension exceeds safe bounds"))
                    if key == "particleCount" and isinstance(item, (int, float)) and not (0 <= item <= 1000):
                        errors.append(ValidationError(location, "LIMIT", "Particle count exceeds safe bounds"))
                    if isinstance(item, str) and len(item) > (10000 if key == "text" else 20000):
                        errors.append(ValidationError(location, "LIMIT", "Text exceeds safe length"))
                    check(item, location, depth + 1)
            elif isinstance(value, list):
                for index, item in enumerate(value): check(item, f"{path}[{index}]", depth + 1)
            elif isinstance(value, (int, float)) and (not math.isfinite(value) or abs(value) > 1_000_000):
                errors.append(ValidationError(path, "INVALID_NUMBER", "Numeric value is not finite or exceeds safe bounds"))
        check(asdict(self))
        if errors: return errors

        if self.canvas.duration is not None and not (0 < self.canvas.duration <= 180):
            errors.append(ValidationError("canvas.duration", "INVALID_DURATION", "Canvas duration must be between 0 and 180 seconds"))
        # 1. Canvas bounds
        if self.canvas.width < 240 or self.canvas.width > 3840:
            errors.append(ValidationError("canvas.width", "INVALID_DIMENSION", f"Width {self.canvas.width} must be between 240 and 3840"))
        if self.canvas.height < 240 or self.canvas.height > 3840:
            errors.append(ValidationError("canvas.height", "INVALID_DIMENSION", f"Height {self.canvas.height} must be between 240 and 3840"))
        if self.canvas.fps < 10 or self.canvas.fps > 60:
            errors.append(ValidationError("canvas.fps", "INVALID_FPS", f"FPS {self.canvas.fps} must be between 10 and 60"))

        # 2. Scenes check
        if not self.scenes:
            errors.append(ValidationError("scenes", "EMPTY_SCENES", "Project must contain at least one scene"))

        total_dur = 0.0
        for s_idx, scene in enumerate(self.scenes):
            spath = f"scenes[{s_idx}]"
            if scene.duration <= 0.0:
                errors.append(ValidationError(f"{spath}.duration", "INVALID_DURATION", f"Scene duration must be positive, got {scene.duration}"))
            if scene.duration > 120.0:
                errors.append(ValidationError(f"{spath}.duration", "DURATION_EXCEEDED", f"Scene duration {scene.duration}s exceeds maximum 120s"))
            total_dur += max(0.0, scene.duration)

            if scene.transition.type not in VALID_TRANSITIONS:
                errors.append(ValidationError(f"{spath}.transition.type", "INVALID_TRANSITION", f"Unknown transition '{scene.transition.type}'"))

            if scene.background.type == "image":
                if not scene.background.assetId and not scene.background.assetPath:
                    errors.append(ValidationError(f"{spath}.background", "MISSING_ASSET_REF", "Image background requires assetId or assetPath"))

            for l_idx, layer in enumerate(scene.layers):
                lpath = f"{spath}.layers[{l_idx}]"
                if layer.type not in VALID_LAYER_TYPES:
                    errors.append(ValidationError(f"{lpath}.type", "INVALID_LAYER_TYPE", f"Unknown layer type '{layer.type}'"))

                if layer.opacity < 0.0 or layer.opacity > 1.0:
                    errors.append(ValidationError(f"{lpath}.opacity", "INVALID_OPACITY", f"Opacity {layer.opacity} must be between 0.0 and 1.0"))

                if layer.type == "image":
                    if not layer.assetId and not layer.assetPath:
                        errors.append(ValidationError(f"{lpath}", "MISSING_ASSET_REF", "Image layer requires assetId or assetPath"))

                if layer.type == "shape" and layer.shape not in VALID_SHAPES:
                    errors.append(ValidationError(f"{lpath}.shape", "INVALID_SHAPE", f"Shape '{layer.shape}' is not supported"))

                if layer.type == "ui" and layer.component not in VALID_UI_COMPONENTS:
                    errors.append(ValidationError(f"{lpath}.component", "INVALID_UI_COMPONENT", f"UI component '{layer.component}' is not supported"))

                for a_idx, anim in enumerate(layer.animations):
                    apath = f"{lpath}.animations[{a_idx}]"
                    if anim.easing not in VALID_EASINGS:
                        errors.append(ValidationError(f"{apath}.easing", "INVALID_EASING", f"Easing '{anim.easing}' is not supported"))
                    if anim.duration <= 0.0:
                        errors.append(ValidationError(f"{apath}.duration", "INVALID_ANIMATION_DURATION", "Animation duration must be > 0"))

        if total_dur > 180.0:
            errors.append(ValidationError("duration", "TOTAL_DURATION_EXCEEDED", f"Total project duration {total_dur:.1f}s exceeds maximum limit 180s"))

        # Audio tracks check
        for a_idx, track in enumerate(self.audioTracks):
            tpath = f"audioTracks[{a_idx}]"
            if not track.assetId and not track.assetPath and not track.syntheticType:
                errors.append(ValidationError(tpath, "MISSING_AUDIO_SOURCE", "Audio track requires assetId, assetPath, or syntheticType"))
            if track.volume < 0.0 or track.volume > 1.0:
                errors.append(ValidationError(f"{tpath}.volume", "INVALID_VOLUME", f"Volume {track.volume} must be between 0.0 and 1.0"))

        # Voiceover check
        for v_idx, vo in enumerate(self.voiceovers):
            vpath = f"voiceovers[{v_idx}]"
            if not vo.text and not vo.assetId and not vo.assetPath:
                errors.append(ValidationError(vpath, "MISSING_VOICEOVER_SOURCE", "Voiceover requires text or audio asset"))

        return errors


def parse_video_spec(data: Union[str, Dict[str, Any]]) -> VideoProjectSpec:
    """Parses a dictionary or JSON string into a validated VideoProjectSpec."""
    if isinstance(data, str):
        data = json.loads(data)

    canvas_raw = data.get("canvas", {})
    canvas = CanvasSpec(
        width=int(canvas_raw.get("width", 1080)),
        height=int(canvas_raw.get("height", 1920)),
        fps=int(canvas_raw.get("fps", 30)),
        duration=float(canvas_raw["duration"]) if "duration" in canvas_raw and canvas_raw["duration"] is not None else None,
        backgroundColor=str(canvas_raw.get("backgroundColor", "#080C12")),
    )

    brand_raw = data.get("brand", {})
    brand = BrandSpec(
        businessName=str(brand_raw.get("businessName", "StarliDigital")),
        logoUrl=brand_raw.get("logoUrl"),
        logoAssetId=brand_raw.get("logoAssetId"),
        symbolAssetId=brand_raw.get("symbolAssetId"),
        primaryColor=str(brand_raw.get("primaryColor", "#080C12")),
        secondaryColor=str(brand_raw.get("secondaryColor", "#10151D")),
        lineColor=str(brand_raw.get("lineColor", "#262D38")),
        accentColor=str(brand_raw.get("accentColor", "#C6DBF0")),
        textColor=str(brand_raw.get("textColor", "#F4F6FA")),
        silverColor=str(brand_raw.get("silverColor", "#A8B0BD")),
        mutedColor=str(brand_raw.get("mutedColor", "#8993A3")),
        onlineColor=str(brand_raw.get("onlineColor", "#ACDBBF")),
        fontRegular=str(brand_raw.get("fontRegular", "regular")),
        fontBold=str(brand_raw.get("fontBold", "bold")),
        fontSemibold=str(brand_raw.get("fontSemibold", "semibold")),
        tagline=str(brand_raw.get("tagline", "Agenția Digitală Condusă de Starli AI")),
        website=str(brand_raw.get("website", "starlidigital.ro")),
        ctaText=str(brand_raw.get("ctaText", "Construiește cu Starli")),
    )

    assets = dict(data.get("assets", {}))

    scenes: List[SceneSpec] = []
    for s_idx, s in enumerate(data.get("scenes", [])):
        bg_raw = s.get("background", {})
        bg = BackgroundSpec(
            type=str(bg_raw.get("type", "color")),
            color=str(bg_raw.get("color", "#080C12")),
            assetId=bg_raw.get("assetId"),
            assetPath=bg_raw.get("assetPath"),
            effect=bg_raw.get("effect"),
            effectParams=dict(bg_raw.get("effectParams", {})),
            gradient=bg_raw.get("gradient"),
        )

        tr_raw = s.get("transition", {})
        tr = TransitionSpec(
            type=str(tr_raw.get("type", "none")),
            duration=float(tr_raw.get("duration", 0.5 if tr_raw.get("type", "none") != "none" else 0.0)),
        )

        layers: List[LayerSpec] = []
        for l_idx, l in enumerate(s.get("layers", [])):
            animations: List[AnimationSpec] = []
            for a in l.get("animations", []):
                animations.append(
                    AnimationSpec(
                        property=str(a.get("property", "opacity")),
                        fromValue=float(a.get("fromValue", a.get("from", 0.0))),
                        toValue=float(a.get("toValue", a.get("to", 1.0))),
                        start=float(a.get("start", 0.0)),
                        duration=float(a.get("duration", 1.0)),
                        easing=str(a.get("easing", "easeInOutCubic")),
                    )
                )

            layer = LayerSpec(
                id=str(l.get("id", f"layer_{s_idx}_{l_idx}")),
                type=str(l.get("type", "text")),
                x=float(l.get("x", 0.0)),
                y=float(l.get("y", 0.0)),
                width=float(l["width"]) if "width" in l and l["width"] is not None else None,
                height=float(l["height"]) if "height" in l and l["height"] is not None else None,
                anchor=str(l.get("anchor", "top_left")),
                opacity=float(l.get("opacity", 1.0)),
                rotation=float(l.get("rotation", 0.0)),
                start=float(l.get("start", 0.0)),
                duration=float(l["duration"]) if "duration" in l and l["duration"] is not None else None,
                animations=animations,
                assetId=l.get("assetId"),
                assetPath=l.get("assetPath"),
                fit=str(l.get("fit", "cover")),
                crop=l.get("crop"),
                imageEffect=l.get("imageEffect") or l.get("effect"),
                imageEffectParams=dict(l.get("imageEffectParams", l.get("effectParams", {}))),
                text=str(l.get("text", "")),
                font=str(l.get("font", "regular")),
                fontSize=int(l.get("fontSize", 36)),
                fontWeight=str(l.get("fontWeight", "regular")),
                color=str(l.get("color", "#F4F6FA")),
                align=str(l.get("align", "left")),
                tracking=float(l.get("tracking", 0.0)),
                lineHeight=float(l.get("lineHeight", 1.25)),
                textEffect=str(l.get("textEffect", "none")),
                backgroundCard=bool(l.get("backgroundCard", False)),
                cardPadding=int(l.get("cardPadding", 16)),
                cardRadius=int(l.get("cardRadius", 12)),
                cardColor=str(l.get("cardColor", "#10151D")),
                cardAlpha=float(l.get("cardAlpha", 0.8)),
                shape=str(l.get("shape", "rectangle")),
                radius=int(l.get("radius", 16)),
                fill=l.get("fill", "#10151D"),
                stroke=l.get("stroke", "#C6DBF0"),
                strokeWidth=int(l.get("strokeWidth", 2)),
                arrowDirection=str(l.get("arrowDirection", "up_right")),
                arrowSize=float(l.get("arrowSize", 24.0)),
                component=str(l.get("component", "glass_card")),
                componentProps=dict(l.get("componentProps", l.get("props", {}))),
                theme=str(l.get("theme", "obsidian")),
                particleCount=int(l.get("particleCount", 60)),
                particleStyle=str(l.get("particleStyle", "cosmic")),
                particleSpeed=float(l.get("particleSpeed", 1.0)),
                particleColor=str(l.get("particleColor", "#C6DBF0")),
                overlayType=str(l.get("overlayType", "vignette")),
                overlayIntensity=float(l.get("overlayIntensity", 0.5)),
            )
            layers.append(layer)

        scenes.append(
            SceneSpec(
                id=str(s.get("id", f"scene_{s_idx}")),
                duration=float(s.get("duration", 4.0)),
                background=bg,
                transition=tr,
                layers=layers,
            )
        )

    audio_tracks: List[AudioTrackSpec] = []
    for a_idx, a in enumerate(data.get("audioTracks", [])):
        audio_tracks.append(
            AudioTrackSpec(
                id=str(a.get("id", f"audio_{a_idx}")),
                assetId=a.get("assetId"),
                assetPath=a.get("assetPath"),
                syntheticType=a.get("syntheticType"),
                start=float(a.get("start", 0.0)),
                duration=float(a["duration"]) if "duration" in a and a["duration"] is not None else None,
                volume=float(a.get("volume", 0.6)),
                fadeIn=float(a.get("fadeIn", 0.5)),
                fadeOut=float(a.get("fadeOut", 0.8)),
                loop=bool(a.get("loop", True)),
            )
        )

    voiceovers: List[VoiceoverSpec] = []
    for v_idx, v in enumerate(data.get("voiceovers", [])):
        voiceovers.append(
            VoiceoverSpec(
                id=str(v.get("id", f"vo_{v_idx}")),
                text=str(v.get("text", "")),
                voice=str(v.get("voice", "ro-RO-AlinaNeural")),
                language=str(v.get("language", "ro")),
                start=float(v.get("start", 0.0)),
                assetId=v.get("assetId"),
                assetPath=v.get("assetPath"),
                volume=float(v.get("volume", 1.0)),
                ducking=bool(v.get("ducking", True)),
                duckVolume=float(v.get("duckVolume", 0.25)),
            )
        )

    out_raw = data.get("output", {})
    output_settings = OutputSettingsSpec(
        format=str(out_raw.get("format", "mp4")),
        codec=str(out_raw.get("codec", "h264")),
        crf=int(out_raw.get("crf", 20)),
        preset=str(out_raw.get("preset", "fast")),
        thumbnailTimestamp=float(out_raw["thumbnailTimestamp"]) if "thumbnailTimestamp" in out_raw and out_raw["thumbnailTimestamp"] is not None else None,
    )

    return VideoProjectSpec(
        version=str(data.get("version", "1.0")),
        title=str(data.get("title", "Untitled Video")),
        canvas=canvas,
        brand=brand,
        assets=assets,
        scenes=scenes,
        audioTracks=audio_tracks,
        voiceovers=voiceovers,
        output=output_settings,
    )
