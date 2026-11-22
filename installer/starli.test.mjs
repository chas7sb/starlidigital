import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('./starli.mjs', import.meta.url));
function invoke(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
}
test('default install plans native dependency installation and build without Docker', () => {
  const r = invoke('install', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const plans = r.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(plans.every(p => p.command !== 'docker'));
  assert.ok(plans.some(p => p.args.includes('install') && p.args.includes('all')));
  assert.ok(plans.some(p => p.args.includes('build') && p.args.includes('all')));
});
for (const action of ['setup', 'start']) test(`default ${action} invokes trusted onboarding`, () => {
  const r = invoke(action, '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.ok(p.args[0].endsWith('onboarding/first_run.py') || p.args[0].endsWith('onboarding\\first_run.py'));
  assert.equal(p.args[1], action);
});
test('default doctor routes to native diagnostics', () => {
  const r = invoke('doctor', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).args.slice(1), ['doctor', 'all']);
});
test('Docker requires explicit mode and preserves Compose plan', () => {
  const r = invoke('status', '--docker', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).command, 'docker');
  assert.deepEqual(JSON.parse(r.stdout).args.slice(-2), ['ps', '--all']);
});
test('conflicting modes fail before invoking either runtime', () => {
  const r = invoke('install', '--native', '--docker', '--dry-run');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /conflicting/);
});
test('standard help describes native default and foreground stop', () => {
  const r = invoke('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /native mode by default/);
  assert.match(r.stdout, /Ctrl\+C stops foreground services/);
  assert.match(r.stdout, /Docker deployment requires --docker/);
});
