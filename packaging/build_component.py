"""Run manifest-defined npm build using each component's supported Node major."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def build(component, test=False):
    directory = ROOT / component
    package = json.loads((directory / 'package.json').read_text(encoding='utf-8-sig'))
    if not (directory / 'package-lock.json').is_file():
        raise ValueError(f'{component}: package-lock.json required for npm ci')
    expected = {'platform': 24, 'dashboard': 22}[component]
    major = int(subprocess.check_output(['node', '--version'], text=True).strip().lstrip('v').split('.')[0])
    if major != expected:
        raise ValueError(f'{component} requires Node {expected} in this build contract, found {major}')
    for workspace in package.get('workspaces', []):
        if '*' in workspace or not (directory / workspace / 'package.json').is_file():
            raise ValueError(f'{component}: unresolved workspace {workspace}')
    if not package.get('scripts', {}).get('build'):
        raise ValueError(f'{component}: build script missing')
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    if not npm:
        raise ValueError('npm unavailable')
    subprocess.run([npm, 'ci', '--no-audit', '--no-fund'], cwd=directory, check=True)
    subprocess.run([npm, 'run', 'build'], cwd=directory, check=True)
    if test:
        if not package.get('scripts', {}).get('test'):
            raise ValueError(f'{component}: test script missing')
        subprocess.run([npm, 'test'], cwd=directory, check=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('component', choices=['platform', 'dashboard'])
    parser.add_argument('--test', action='store_true')
    args = parser.parse_args()
    build(args.component, args.test)
