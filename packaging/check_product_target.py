"""Fail closed until the corrected product source and preview are confirmed."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
gate = json.loads(Path(__file__).with_name('release-gate.json').read_text(encoding='utf-8-sig'))
if gate.get('frontend_directory') != 'product' or gate.get('release_enabled') is not True or gate.get('preview_confirmed') is not True:
    raise SystemExit('Release disabled: corrected product preview and joined runtime are not confirmed; prior UI builds do not authorize release.')
if gate.get('fresh_git_install_confirmed') is not True or gate.get('actual_model_execution_confirmed') is not True:
    raise SystemExit('Release disabled: fresh-Git installation and actual model proof are incomplete.')
manifest=gate.get('frontend_manifest')
if not isinstance(manifest,str) or not manifest.startswith('product/') or not (root / manifest).is_file():
    raise SystemExit('Release disabled: actual product manifest is missing.')
if gate.get('runtime_contract_confirmed') is not True or not gate.get('joined_release_pins_sha256'):
    raise SystemExit('Release disabled: joined candidate pins and runtime contract are not confirmed.')
print('Corrected product target and preview gate confirmed; independent release checks still required.')
