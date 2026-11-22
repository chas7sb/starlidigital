#!/usr/bin/env python3
"""Inventory lockfile license declarations without fetching or executing packages."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('lockfile', type=Path)
args = parser.parse_args()
raw = args.lockfile.read_bytes()
lock = json.loads(raw)
packages = lock.get('packages')
if not isinstance(packages, dict):
    parser.error('requires npm lockfile v2/v3 packages mapping')
print(json.dumps({'sha256': hashlib.sha256(raw).hexdigest(), 'packages': [
    {'path': path, 'version': item.get('version'), 'license_declaration': item.get('license'),
     'notice_review': 'required'} for path, item in sorted(packages.items()) if path
]}, indent=2))
