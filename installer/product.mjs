#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { persistNewInstanceConfig, validateFirstRunStatus } from './product-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cache = join(here, '.runtime');
const instance = process.env.STARLI_PRODUCT_INSTANCE || '';
if (instance && !/^[a-z0-9_-]{1,40}$/.test(instance)) throw new Error('Product instance name must use1–40 lowercase letters/digits/_/-.');
const configFile = join(cache, instance ? `product-${instance}.json` : 'product.json');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const action = args.find(a => a !== '--dry-run') || 'help';
const win = process.platform === 'win32';
const py = join(cache, 'python', win ? 'Scripts/python.exe' : 'bin/python');
const node22 = process.env.STARLI_NODE22 || join(cache, 'node22', win ? 'node.exe' : 'bin/node');
const native = join(here, 'native.mjs');
const children = [];
let stopping = false;
function run(command, params, cwd = root, env = process.env) {
  if (dry) { console.log(JSON.stringify({ command, args: params, cwd })); return; }
  const r = spawnSync(command, params, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(r.error?.message || `Command exited ${r.status}`);
}
function source() {
  for (const p of ['product/package.json', 'product/package-lock.json', 'product/UPSTREAM-SOURCE-LOCK.json', 'product/src/routes/app/+page.svelte', 'product-backend/local_server.py', 'product-backend/runtime-contract.json']) {
    if (!existsSync(join(root, p))) throw new Error(`New product source is missing: ${p}. Legacy frontend will not be substituted.`);
  }
  const contract = JSON.parse(readFileSync(join(root, 'product-backend/runtime-contract.json'), 'utf8'));
  if (contract.schema !== 'starli.local-product-backend.v1' || contract.entrypoint !== 'product-backend/local_server.py') throw new Error('Unrecognized new product backend contract.');
}
function npm() {
  const cli = win ? join(dirname(node22), 'node_modules/npm/bin/npm-cli.js') : resolve(dirname(node22), '../lib/node_modules/npm/bin/npm-cli.js');
  if (!dry && (!existsSync(node22) || !existsSync(cli))) throw new Error('Node22/npm missing. Run install first or set STARLI_NODE22 to an official Node22 executable.');
  return cli;
}
function backendLock() {
  const host = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
  const lock = join(root, 'packaging/locks', `dashboard-${host}-${process.arch}-py311.txt`);
  if (!existsSync(lock)) throw new Error('No reviewed Python3.11 lock for this host.');
  const metadata = JSON.parse(readFileSync(lock.replace(/\.txt$/, '.json'), 'utf8'));
  const hash = p => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  if (metadata.python !== '3.11' || metadata.requirements_sha256 !== hash(join(root, 'dashboard/backend/requirements.txt')) || metadata.lock_sha256 !== hash(lock)) throw new Error('Product backend lock is stale or damaged.');
  return lock;
}
function env() {
  return { ...process.env, PATH: dirname(node22) + delimiter + process.env.PATH,
    ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip', CYPRESS_INSTALL_BINARY: '0', NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6144',
    VITE_PUBLIC_STARLI_BOSS_INTAKE_ENABLED: 'false', VITE_PUBLIC_STARLI_GROKBOT1_WIRE_ENABLED: 'false', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}
function settings(requireConfigured = false) {
  if (requireConfigured && !existsSync(configFile)) throw new Error('Instance not started yet. Run starlidigital start, then complete first-run administration in the browser.');
  const c = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {
    schema: 'starli.product-install.v1', state: process.env.STARLI_PRODUCT_STATE || `work/product-${instance || 'local'}`,
    frontendPort: Number(process.env.STARLI_PRODUCT_FRONTEND_PORT || 5186), backendPort: Number(process.env.STARLI_PRODUCT_BACKEND_PORT || 8080)
  };
  if (c.schema !== 'starli.product-install.v1') throw new Error('Product installation configuration schema invalid.');
  for (const p of [c.frontendPort, c.backendPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('Product ports must be integers from1024 to65535.');
  if (c.frontendPort === c.backendPort) throw new Error('Frontend and backend ports must differ.');
  const state = resolve(root, c.state);
  const work = join(root, 'work');
  if (!state.startsWith(work + (win ? '\\' : '/'))) throw new Error('New product state must be in this checkout work/ directory.');
  return { ...c, state, frontend: `http://127.0.0.1:${c.frontendPort}`, backend: `http://127.0.0.1:${c.backendPort}` };
}
function backendArgs(c, mode) { return [join(root, 'product-backend/local_server.py'), mode, '--state', c.state, '--port', String(c.backendPort), '--origin', c.frontend]; }
function builtProductAvailable(){return existsSync(join(root,'product/build/index.html')) && existsSync(join(root,'product/.svelte-kit/output/server/manifest.js'));}
async function response(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!r.ok) throw new Error(`${new URL(url).pathname} HTTP${r.status}`);
  return r;
}
async function readiness(c) {
  const health = await (await response(c.backend + '/health')).json();
  if (!['ready', 'setup_required'].includes(health.status) || health.backend !== 'NEW_COMPANY_NATIVE_CANDIDATE' || health.nativeAuth !== true || health.nativeMessaging !== true) throw new Error('Single-company backend health contract did not pass.');
  const proxied = await (await response(c.frontend + '/health')).json();
  if (proxied.backend !== health.backend || proxied.status !== health.status) throw new Error('Frontend API proxy is not joined to the single-company backend.');
  const setup=validateFirstRunStatus(await (await response(c.backend+'/api/v1/setup/status')).json());
  const frontSetup=validateFirstRunStatus(await (await response(c.frontend+'/api/v1/setup/status')).json());
  if (frontSetup.setupRequired!==setup.setupRequired) throw new Error('First-run status changed or frontend proxy is joined to another instance; retrying.');
  for (const path of ['/', '/app']) {
    const r = await response(c.frontend + path);
    if (!r.headers.get('content-type')?.includes('text/html') || !(await r.text()).toLowerCase().includes('<!doctype html')) throw new Error(`New product ${path} did not serve an HTML application.`);
  }
  return {...health,setupRequired:setup.setupRequired,deploymentMode:'single_company'};
}
async function freePorts(c) {
  const { createServer } = await import('node:net');
  for (const port of [c.frontendPort, c.backendPort]) await new Promise((yes, no) => {
    const s = createServer();s.once('error', () => no(new Error(`Loopback port${port} is occupied. Stop only your own installation or choose fresh setup ports.`)));
    s.listen(port, '127.0.0.1', () => s.close(yes));
  });
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && child.pid) {
    if (win) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
}
function startChild(command, params, cwd, childEnv) {
  const child = spawn(command, params, { cwd, env: childEnv, stdio: 'inherit', windowsHide: true, detached: !win });
  children.push(child);
  child.once('error', e => { console.error(e.message);stop();process.exitCode = 1; });
  child.once('exit', code => { if (!stopping) { stop();process.exitCode = code || 1; } });
  return child;
}
try {
  if (!['help', 'install', 'build', 'setup', 'start', 'doctor', 'health'].includes(action) || args.some(a => a !== action && a !== '--dry-run')) throw new Error('Unknown new product command.');
  if (action === 'help') console.log('New bots/teams/Boss product: install, setup, start, doctor, health, build. Native frontend+backend; Ctrl+C stops owned foreground services. Health reports configured capabilities without implying model/worker readiness.');
  else {
    source();
    if (action === 'install') {
      if (!existsSync(node22)) run(process.execPath, [native, 'bootstrap-node22']);
      if (!existsSync(py)) run('uv', ['venv', '--python', '3.11', join(cache, 'python')]);
      run('uv', ['pip', 'install', '--python', py, '--require-hashes', '-r', backendLock()]);
      run(node22, [npm(), 'ci', '--include=dev'], join(root, 'product'), env());
      run(node22, [npm(), 'run', 'build'], join(root, 'product'), env());
      if (!dry) console.log('Single-company product installed. Run start, then create the first administrator and company in the browser. No default account/password is created. CLI setup is an optional privileged alternative.');
    } else if (action === 'build') run(node22, [npm(), 'run', 'build'], join(root, 'product'), env());
    else if (action === 'doctor') {
      run(node22, ['--version']);run(py, ['-c', 'import fastapi,uvicorn,pyarrow,numpy; print("Product backend Python dependencies import successfully")']);
      if (!builtProductAvailable()) throw new Error('Product build/preview manifest missing or build in progress; finish install/build before start.');
      if (!dry) console.log(existsSync(configFile) ? 'Product source/dependencies/build and instance configuration: present. Use health after start to inspect first-run status.' : 'Product source/dependencies/build: present. Start will serve browser first-run setup.');
    } else if (action === 'setup') {
      const c = settings();if (!dry) await freePorts(c);
      run(py, [join(here,'first-run-cli.py'),'--state',c.state,'--port',String(c.backendPort),'--origin',c.frontend], root, env());
      if (!dry) { persistNewInstanceConfig(configFile,c);console.log('Privileged CLI initialization completed. Existing instance configuration and private keys are preserved. Run start.'); }
    } else if (action === 'health') {
      const c = settings(!dry);
      if (dry) console.log(JSON.stringify({ health: [c.backend + '/health', c.frontend + '/health', c.backend+'/api/v1/setup/status',c.frontend+'/api/v1/setup/status',c.frontend + '/', c.frontend + '/app'] }));
      else { const h = await readiness(c);console.log(JSON.stringify({ core: h.setupRequired ? 'setup_required' : 'ready', setupRequired:h.setupRequired, deploymentMode:h.deploymentMode, frontend: c.frontend, providerConfigured: h.providerConfigured, modelExecution: h.modelExecution, workerExecution: h.workerExecution, productionReady: h.productionReady })); }
    } else if (action === 'start') {
      const hadConfig=existsSync(configFile);
      const c = settings();
      const vite = join(root, 'product/node_modules/vite/bin/vite.js');
      const frontArgs = [vite, 'preview', '--host', '127.0.0.1', '--port', String(c.frontendPort), '--strictPort'];
      const childEnv = { ...env(), STARLI_BACKEND_URL: c.backend };
      if (dry) { run(py, backendArgs(c, 'serve'), root, childEnv);run(node22, frontArgs, join(root, 'product'), childEnv); }
      else {
        if (!existsSync(py) || !existsSync(vite) || !builtProductAvailable()) throw new Error('Product dependencies/build/preview manifest missing or build in progress. Finish install/build first.');
        await freePorts(c);
        if (!hadConfig && !persistNewInstanceConfig(configFile,c)) throw new Error('Another start configured this instance concurrently. Existing configuration preserved; retry start.');
        startChild(py, backendArgs(c, 'serve'), root, childEnv);startChild(node22, frontArgs, join(root, 'product'), childEnv);
        process.on('SIGINT', () => { stop();process.exitCode = 130; });process.on('SIGTERM', () => { stop();process.exitCode = 143; });
        const deadline = Date.now() + 180000;let last;
        while (Date.now() < deadline) {
          if (children.some(c => c.exitCode !== null)) throw new Error('A product process exited before readiness.');
          try { const h = await readiness(c);console.log(h.setupRequired ? `First-run page ready at ${c.frontend}. Create the single administrator and company in your browser; no default credentials exist. Ctrl+C stops both services.` : `Single-company workspace ready at ${c.frontend}; sign in to continue. Provider=${h.providerConfigured}, model=${h.modelExecution}, worker=${h.workerExecution}. Ctrl+C stops both services.`);last = null;break; }
          catch (e) { last = e;await new Promise(r => setTimeout(r, 1500)); }
        }
        if (last) throw new Error(`New product readiness failed: ${last.message}`);
      }
    }
  }
} catch (e) { stop();console.error(`StarliDigital product: ${e.message}`);process.exitCode = 1; }
