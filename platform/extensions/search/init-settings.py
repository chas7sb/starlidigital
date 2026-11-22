"""Create private local SearXNG settings without reusing production configuration."""
import argparse
import json
import os
from pathlib import Path
import secrets


def initialize(destination: Path) -> None:
    if not destination.is_absolute():
        raise ValueError("Settings output must be an absolute path")
    os.umask(0o077)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    settings = (
        "use_default_settings: true\n"
        "general:\n  instance_name: StarliDigital local search\n  enable_metrics: false\n"
        "server:\n  secret_key: " + json.dumps(secrets.token_hex(32)) + "\n"
        "  bind_address: 127.0.0.1\n  port: 8888\n"
        "search:\n  formats:\n    - json\n"
        "engines:\n  - name: pexels\n    engine: pexels\n    disabled: true\n    api_key: ''\n"
    )
    # Exclusive creation prevents a rerun from silently invalidating existing sessions.
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(settings)
    print("Created fresh private search settings. Set SEARXNG_SETTINGS_PATH to this file before launch.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    initialize(parser.parse_args().output)
