"""Bounded application JPEG relay. No capture, VNC, forwarding or control."""
from .relay import Relay, RelayError, EnrolledPublisher, sanitize_jpeg
from .routes import install
