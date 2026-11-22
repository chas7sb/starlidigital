#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const envFile = resolve(here, 'local.env');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const action = args.find(a => a !== '--dry-run') || 'help';
const allowed = ['help', 'doctor', 'init', 'install', 'start', 'stop', 'status', 'logs', 'config'];
function fail(message) { throw new Error(message); }
function run(command, params, capture = false) {
  const result = spawnSync(command, params, { cwd: root, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', windowsHide: true });
  if (result.error) fail(`Cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status ?? 'unknown'}${capture ? ': ' + (result.stderr || '').trim() : ''}`);
  return result.stdout?.trim();
}
function sourceProblems() {
  return ['platform/package.json', 'platform/package-lock.json', 'platform/server/src/index.ts',
    'dashboard/package.json', 'dashboard/package-lock.json', 'dashboard/backend/requirements.txt',
    'dashboard/backend/open_webui/main.py'].filter(p => !existsSync(resolve(root, p)));
}
function checkSources() {
  const missing = sourceProblems();
  if (missing.length) fail(`Extraction is incomplete. Missing: ${missing.join(', ')}. See docs/install.md.`);
  const platform = JSON.parse(readFileSync(resolve(root, 'platform/package.json'), 'utf8'));
  const dashboard = JSON.parse(readFileSync(resolve(root, 'dashboard/package.json'), 'utf8'));
  if (!platform.scripts?.build || !platform.scripts?.start || !dashboard.scripts?.build) fail('Extracted manifests do not satisfy the installer build/start contract.');
}
function compose(params) {
  const full = ['compose', '--project-directory', here, '--env-file', envFile, '-f', resolve(here, 'compose.yaml'), ...params];
  if (dry) { console.log(JSON.stringify({ command: 'docker', args: full })); return; }
  run('docker', full);
}
try {
  if (!allowed.includes(action) || args.some(a => a !== action && a !== '--dry-run')) fail('Unknown command or option. Use help.');
  if (action === 'help') {
    console.log('StarliDigital local app deployment\nUsage: node installer/starli.mjs <command> [--dry-run]\nCommands: doctor, init, install, start, stop, status, logs, config\ninstall: build images; start: start and wait for health; stop: preserve data\nNo command creates a computer-use VM or publishes the application.');
  } else if (action === 'init') {
    if (existsSync(envFile)) console.log('Local configuration already exists; preserved.');
    else if (dry) console.log('Would create installer/local.env with a new random dashboard session secret.');
    else {
      writeFileSync(envFile, `WEBUI_SECRET_KEY=${randomBytes(48).toString('hex')}\nSTARLI_PLATFORM_PORT=4100\nSTARLI_DASHBOARD_PORT=8080\n`, { flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') chmodSync(envFile, 0o600);
      console.log('Created installer/local.env. Keep it private and back it up with application data.');
    }
  } else if (action === 'doctor') {
    console.log(`Host: ${process.platform}/${process.arch}; launcher Node ${process.versions.node}`);
    const missing = sourceProblems();
    console.log(missing.length ? `Missing source: ${missing.join(', ')}` : 'Source contract: present');
    console.log(existsSync(envFile) ? 'Local configuration: present' : 'Local configuration: missing; run init');
    if (!dry) {
      console.log(`Compose: ${run('docker', ['compose', 'version', '--short'], true)}`);
      const os = run('docker', ['info', '--format', '{{.OSType}}'], true);
      if (os !== 'linux') fail('Docker must run Linux containers.');
      console.log('Docker engine: Linux containers available');
    }
    if (missing.length) process.exitCode = 1;
  } else {
    if (['install', 'start'].includes(action)) checkSources();
    if (!existsSync(envFile) && !dry) fail('Local configuration missing. Run init first.');
    const commands = { install: ['build'], start: ['up', '-d', '--wait', '--wait-timeout', '300'],
      stop: ['down'], status: ['ps', '--all'], logs: ['logs', '--tail', '150', '-f'], config: ['config', '--quiet'] };
    compose(commands[action]);
    if (action === 'start' && !dry) console.log('App containers passed Compose health checks. View configured loopback ports in installer/local.env. Feature parity and VM readiness require separate verification.');
  }
} catch (error) { console.error(`StarliDigital: ${error.message}`); process.exitCode = 1; }
