#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cache = join(here, '.runtime');
const [action = 'help', target = 'all', ...extra] = process.argv.slice(2);
const win = process.platform === 'win32';
const children = [];
function run(bin, args, cwd = root, env = process.env) {
  console.log(`Running ${bin} ${args.join(' ')} in ${cwd}`);
  const r = spawnSync(bin, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || `Command exited ${r.status}`);
}
function npm(node) {
  const candidates = win ? [join(dirname(node), 'node_modules/npm/bin/npm-cli.js')] : [resolve(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'), resolve(dirname(node), '../share/nodejs/npm/bin/npm-cli.js')];
  const result = candidates.find(existsSync);
  if (!result) throw new Error(`npm-cli.js missing beside ${node}. Install an official Node distribution.`);
  return result;
}
function node24() {
  const node = process.env.STARLI_NODE24 || process.execPath;
  const r = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || Number(r.stdout?.trim().split('.')[0]) < 24) throw new Error('Set STARLI_NODE24 to a Node 24+ executable.');
  return node;
}
function node22() {
  const p = process.env.STARLI_NODE22 || join(cache, 'node22', win ? 'node.exe' : 'bin/node');
  const r = spawnSync(p, ['-p', 'process.versions.node'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || Number(r.stdout?.trim().split('.')[0]) !== 22) throw new Error('Run bootstrap-node22 or set STARLI_NODE22 to a Node 22 executable.');
  return p;
}
function envFor(node) { return { ...process.env, PATH: dirname(node) + delimiter + process.env.PATH }; }
function python() { return join(cache, 'python', win ? 'Scripts/python.exe' : 'bin/python'); }
function videoPython() { return join(cache, 'video-python', win ? 'Scripts/python.exe' : 'bin/python'); }
function backendLock() {
  const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
  const lock = join(root, 'packaging/locks', `dashboard-${os}-${process.arch}-py311.txt`);
  if (!existsSync(lock)) throw new Error('No reviewed Python3.11 hash lock for this host. Generate and review one with packaging/lock_backend.py before native installation.');
  const metadata = JSON.parse(readFileSync(lock.replace(/\.txt$/, '.json'), 'utf8'));
  const hash = p => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  if (metadata.python !== '3.11' || metadata.requirements_sha256 !== hash(join(root, 'dashboard/backend/requirements.txt')) || metadata.lock_sha256 !== hash(lock)) throw new Error('Backend hash lock is stale or damaged; regenerate and review it.');
  return lock;
}
function dashboardEnv() {
  const local = join(here, 'local.env');
  if (!existsSync(local)) writeFileSync(local, `WEBUI_SECRET_KEY=${randomBytes(48).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  const key = readFileSync(local, 'utf8').split(/\r?\n/).find(l => l.startsWith('WEBUI_SECRET_KEY='))?.slice(17);
  if (!key) throw new Error('installer/local.env lacks WEBUI_SECRET_KEY; restore the local configuration.');
  const data = resolve(root, process.env.DATA_DIR || join(cache, 'dashboard-data'));
  mkdirSync(data, { recursive: true });
  return { WEBUI_SECRET_KEY: key, WEBUI_AUTH: 'true', ENABLE_PERSISTENT_CONFIG: 'false',
    ENABLE_SIGNUP: 'false', ENABLE_OPENAI_API: 'false', ENABLE_OLLAMA_API: 'false',
    ENABLE_COMMUNITY_SHARING: 'false', ENABLE_VERSION_UPDATE_CHECK: 'false', OFFLINE_MODE: 'true', ANONYMIZED_TELEMETRY: 'false', STARLI_LOCAL_VM_ENABLED: '1',
    CORS_ALLOW_ORIGIN: `http://localhost:${process.env.STARLI_DASHBOARD_PORT || '8080'};http://127.0.0.1:${process.env.STARLI_DASHBOARD_PORT || '8080'}`,
    HF_HUB_OFFLINE: '1', STARLI_COMPANY_MESSAGING_ENABLED: '1',
    DATA_DIR: data, STARLI_NODE_BINARY: node24(), STARLI_NODE_BIN: node24(), STARLI_PYTHON_BIN: python(), STARLI_PLATFORM_ORIGIN: `http://127.0.0.1:${process.env.PORT || '4100'}`, STARLI_CONTROL_PLANE_ORIGIN: 'http://127.0.0.1:4120',
    STARLI_PUBLIC_ORIGIN: `http://localhost:${process.env.STARLI_DASHBOARD_PORT || '8080'}`, WEBUI_URL: `http://localhost:${process.env.STARLI_DASHBOARD_PORT || '8080'}`,
    STARLI_STATE_DIR: join(data, 'starli-state'), STARLI_TASK_HOME: join(data, 'tasks'),
    STARLI_SOURCE_DATABASE: join(root, 'platform/server/data/starli.sqlite'),
    STARLI_COMPANY_DATABASE: join(data, 'company.sqlite'), STARLI_COMPANY_BOT_DATABASE: join(data, 'company-bot.sqlite'),
    STARLI_MEMORY_ROOT: join(data, 'memory'), STARLI_RUNTIME_CODE_DIR: join(root, 'platform/extensions/starli-runtime'), STARLI_PLATFORM_SOURCE_ROOT: join(root, 'platform') };
}
function source(component) {
  const dir = join(root, component);
  for (const name of ['package.json', 'package-lock.json', ...(component === 'dashboard' ? ['backend/requirements.txt', 'backend/workspace_entry.py'] : ['server/src/index.ts'])]) {
    if (!existsSync(join(dir, name))) throw new Error(`Source incomplete: ${component}/${name}`);
  }
  return dir;
}
async function bootstrap() {
  const arch = process.arch;
  if (!['x64', 'arm64'].includes(arch) || !['win32', 'darwin', 'linux'].includes(process.platform)) throw new Error('Automatic Node bootstrap supports Windows/macOS/Linux x64/arm64 only.');
  if (existsSync(join(cache, 'node22'))) throw new Error('Node22 runtime directory exists; preserved. Use STARLI_NODE22 or inspect it manually.');
  const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`); return r; };
  const index = await (await get('https://nodejs.org/dist/index.json')).json();
  const release = index.find(r => r.version.startsWith('v22.') && r.lts);
  if (!release) throw new Error('No Node22 LTS found in official index.');
  const name = `node-${release.version}-${win ? 'win' : process.platform}-${arch}`;
  const file = name + (win ? '.zip' : '.tar.gz');
  const base = `https://nodejs.org/dist/${release.version}/`;
  const sums = await (await get(base + 'SHASUMS256.txt')).text();
  const checksum = sums.split(/\r?\n/).find(l => l.endsWith('  ' + file))?.split(/\s+/)[0];
  if (!checksum) throw new Error('Official checksum missing.');
  const bytes = Buffer.from(await (await get(base + file)).arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Node archive checksum mismatch.');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, file);
  writeFileSync(archive, bytes, { flag: 'wx' });
  if (win) run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:STARLI_ARCHIVE -DestinationPath $env:STARLI_DEST'], root, { ...process.env, STARLI_ARCHIVE: archive, STARLI_DEST: cache });
  else run('tar', ['-xzf', archive, '-C', cache]);
  const { renameSync } = await import('node:fs');
  renameSync(join(cache, name), join(cache, 'node22'));
  console.log(`Installed official ${release.version}; SHA256 ${checksum}`);
}
function stop() {
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (win) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-c.pid, 'SIGTERM'); } catch {} }
  }
}
try {
  if (extra.length || !['all', 'platform', 'dashboard'].includes(target)) throw new Error('Invalid target or extra argument.');
  if (action === 'help') console.log('Usage: node installer/native.mjs <bootstrap-node22|doctor|install|install-backend|install-frontend|build|start|health> [all|platform|dashboard]\nUses STARLI_NODE24, STARLI_NODE22 or local verified runtime; uv creates isolated Python 3.11.\ninstall-backend dashboard skips npm; install-frontend dashboard skips Python.\nstart runs foreground; Ctrl+C stops child process trees. No VM is created.');
  else if (action === 'bootstrap-node22') await bootstrap();
  else if (action === 'health') {
    for (const component of target === 'all' ? ['platform', 'dashboard'] : [target]) {
      const port = component === 'platform' ? (process.env.PORT || '4100') : (process.env.STARLI_DASHBOARD_PORT || '8080');
      if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Health port must be 1–65535.');
      const url = `http://127.0.0.1:${port}/health`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`${component} health HTTP ${response.status}`);
      console.log(`${component}: health HTTP ${response.status}`);
    }
  }
  else if (!['doctor', 'install', 'install-backend', 'install-frontend', 'build', 'start'].includes(action)) throw new Error('Unknown command.');
  else {
    const components = target === 'all' ? ['platform', 'dashboard'] : [target];
    const selected = components.map(component => ({ component, dir: source(component), node: component === 'platform' ? node24() : node22() }));
    for (const { component, dir, node } of selected) {
      const env = { ...(component === 'dashboard' ? { ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip', CYPRESS_INSTALL_BINARY: '0', NODE_OPTIONS: '--max-old-space-size=6144' } : {}), ...envFor(node) };
      if (action === 'doctor') {
        run(node, ['--version']); run(node, [npm(node), '--version']);
        const py = component === 'platform' ? videoPython() : python();
        if (!existsSync(py)) throw new Error(`${component} Python environment missing; run install ${component}.`);
        run(py, ['-c', component === 'platform' ? 'import PIL,numpy,cv2,edge_tts; print("Video Python dependencies import successfully")' : 'import fastapi,pyarrow,numpy; print("Dashboard Python dependencies import successfully")']);
        if (component === 'platform') {
          const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 10000, windowsHide: true });
          if (result.error || result.status !== 0) throw new Error('ffmpeg is unavailable; install it and add its executable directory to PATH.');
          console.log('ffmpeg: available');
        }
      }
      if (['install', 'install-backend', 'install-frontend'].includes(action)) {
        if (action !== 'install-backend') run(node, [npm(node), 'ci', '--include=dev'], dir, env);
        if (component === 'platform' && action === 'install') {
          const runtime = join(dir, 'extensions/starli-runtime');
          if (!existsSync(join(runtime, 'package-lock.json'))) throw new Error('Restored provider runtime lockfile is missing.');
          run(node, [npm(node), 'ci', '--include=dev'], runtime, env);
          if (!existsSync(videoPython())) run('uv', ['venv', '--python', '3.11', join(cache, 'video-python')]);
          run('uv', ['pip', 'install', '--python', videoPython(), '-r', join(dir, 'video-engine/requirements.txt')]);
        }
        if (component === 'dashboard' && action !== 'install-frontend') {
          if (!existsSync(python())) run('uv', ['venv', '--python', '3.11', join(cache, 'python')]);
          run('uv', ['pip', 'install', '--python', python(), '--require-hashes', '-r', backendLock()]);
        }
      }
      if (action === 'build') run(node, [npm(node), 'run', 'build'], dir, env);
      if (action === 'start') {
        const command = component === 'platform' ? node : python();
        const params = component === 'platform' ? [npm(node), 'run', 'start'] : ['-m', 'uvicorn', 'workspace_entry:app', '--host', '127.0.0.1', '--port', process.env.STARLI_DASHBOARD_PORT || '8080'];
        if (!existsSync(command)) throw new Error(`Runtime missing: ${command}. Run install.`);
        const childEnv = { ...(component === 'dashboard' ? dashboardEnv() : {}), ...env, HOST: '127.0.0.1' };
        if (component === 'platform') childEnv.PYTHON_BIN = process.env.STARLI_VIDEO_PYTHON || videoPython();
        if (component === 'dashboard') {
          childEnv.DATABASE_URL = process.env.STARLI_DASHBOARD_DATABASE_URL || 'sqlite:///' + join(process.env.DATA_DIR || join(cache, 'dashboard-data'), 'webui.db').replaceAll('\\', '/');
          childEnv.PYTHONUTF8 = '1';
          childEnv.PYTHONIOENCODING = 'utf-8';
        }
        const child = spawn(command, params, { cwd: component === 'platform' ? dir : join(dir, 'backend'), env: childEnv, stdio: 'inherit', windowsHide: true, detached: !win });
        children.push(child);
        child.on('error', e => { console.error(e.message); stop(); process.exitCode = 1; });
        child.on('exit', code => { stop(); process.exitCode = code || 1; });
      }
    }
    if (action === 'start') {
      console.log('Processes launched; readiness is not yet verified. Ctrl+C stops them.');
      process.on('SIGINT', () => { stop(); process.exitCode = 130; });
      process.on('SIGTERM', () => { stop(); process.exitCode = 143; });
    }
  }
} catch (e) { stop(); console.error(`StarliDigital native: ${e.message}`); process.exitCode = 1; }
