// grokbot3 AppSpec -> React/Vite/TS generator + verified build.
// Usage (from stage root):  nice -n 10 ionice -c3 node --max-old-space-size=768 generator/generate.mjs --spec appspec/doglove.appspec.r2.json
// Security: only the allowlisted DOG_REGISTRY_V1 template is used; the spec contributes
// validated DATA only (JSON literal + escaped title + validated hex colour). No npm install,
// no package scripts, no network: toolchain is the pre-installed workspace node_modules.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { validateAppSpec } from '../contracts/app-contracts.ts';
import { treeDigest } from '../server/app-server.ts';

const STAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = resolve(STAGE, '../../../../..');
const NM = join(WORKSPACE, 'node_modules');
const sha = b => createHash('sha256').update(b).digest('hex');
const { values: a } = parseArgs({ options: { spec: { type: 'string' }, out: { type: 'string' }, 'binding-file': { type: 'string' }, 'execution-class': { type: 'string', default: 'FIXTURE' } } });
if (!a.spec) { console.error('--spec required'); process.exit(2); }
const startedAt = new Date().toISOString();
// Binding injection (no IDs in code): AppSpec input < --binding-file JSON < GB3_BINDING_* env.
// The EFFECTIVE spec (after injection) is what is validated, hashed, embedded and served.
const inputSpec = JSON.parse(readFileSync(resolve(STAGE, a.spec), 'utf8'));
const binding = { ...(inputSpec.binding || {}) };
if (a['binding-file']) Object.assign(binding, JSON.parse(readFileSync(resolve(STAGE, a['binding-file']), 'utf8')));
const ENV = { companyId: 'GB3_BINDING_COMPANY_ID', projectId: 'GB3_BINDING_PROJECT_ID', requestId: 'GB3_BINDING_REQUEST_ID', graphId: 'GB3_BINDING_GRAPH_ID', taskId: 'GB3_BINDING_TASK_ID', bindingSource: 'GB3_BINDING_SOURCE' };
for (const [k, e] of Object.entries(ENV)) if (process.env[e]) binding[k] = process.env[e];
if (process.env.GB3_BINDING_TASK_IDS) binding.taskIds = process.env.GB3_BINDING_TASK_IDS.split(',');
const injected = Object.keys(ENV).filter(k => process.env[ENV[k]]).concat(process.env.GB3_BINDING_TASK_IDS ? ['taskIds'] : []);
// Cross-check against Boss's canonical record when present (read-only; any declared ID missing -> fail closed).
const canonPath = process.env.GB3_CANONICAL_IDS_FILE || resolve(STAGE, '..', 'grokbot-boss', 'CANONICAL-IDS.json');
let canonicalIdsCheck = { file: canonPath, result: 'ABSENT' };
if (existsSync(canonPath)) {
  const vals = new Set(); const walk = o => { if (typeof o === 'string') vals.add(o); else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
  walk(JSON.parse(readFileSync(canonPath, 'utf8')));
  const mine = [binding.companyId, binding.projectId, binding.requestId, binding.graphId, ...(binding.taskIds || [binding.taskId])];
  const missing = mine.filter(x => !vals.has(x));
  canonicalIdsCheck = { file: canonPath, result: missing.length ? 'MISMATCH' : 'MATCH', sha256: sha(readFileSync(canonPath)), missing };
  if (missing.length && binding.bindingSource === 'BOSS_CANONICAL_IDS_V1') { console.error(JSON.stringify({ error: 'CANONICAL_IDS_MISMATCH', missing })); process.exit(1); }
}
const specRaw = Buffer.from(JSON.stringify({ ...inputSpec, binding }, null, 2) + '\n');
const spec = validateAppSpec(JSON.parse(specRaw.toString('utf8')));
const out = resolve(STAGE, a.out ?? `generated/${spec.appId}-r${spec.specRevision}`);
if (!out.startsWith(join(STAGE, 'generated') + '/')) { console.error('out must be under stage generated/'); process.exit(2); }
const ver = p => JSON.parse(readFileSync(join(NM, p, 'package.json'), 'utf8')).version;
const toolchain = { node: process.version, vite: ver('vite'), react: ver('react'), typescript: ver('typescript'), esbuild: ver('esbuild'), pluginReact: ver('@vitejs/plugin-react') };
const generatorSha256 = sha(readFileSync(fileURLToPath(import.meta.url)));
const templateTreeSha256 = treeDigest(join(STAGE, 'web-template')).digest;
const specSha256 = sha(specRaw);
const buildFingerprint = sha(JSON.stringify({ specSha256, generatorSha256, templateTreeSha256, toolchain }));
const buildRevision = spec.specRevision; // integer build sequence linked via AppSpec specRevision

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const web = join(out, 'web');
cpSync(join(STAGE, 'web-template'), web, { recursive: true });
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
writeFileSync(join(web, 'index.html'), readFileSync(join(web, 'index.html'), 'utf8').replace('__APP_TITLE__', esc(spec.displayName)));
writeFileSync(join(web, 'src/styles.css'), readFileSync(join(web, 'src/styles.css'), 'utf8').replace('__ACCENT__', spec.theme.accent));
const config = { appId: spec.appId, specRevision: spec.specRevision, displayName: spec.displayName, tagline: spec.tagline, fields: spec.fields, buildRevision, binding: { companyId: spec.binding.companyId, projectId: spec.binding.projectId } };
writeFileSync(join(web, 'src/app-config.ts'), `// GENERATED from AppSpec ${spec.appId} r${spec.specRevision} (sha256 ${specSha256}). Data only.\n` +
  `export type FieldConfig = { name: string; label: string; required: boolean; maxLength?: number; min?: number; max?: number };\n` +
  `export const APP_CONFIG: { appId: string; specRevision: number; displayName: string; tagline: string; buildRevision: number; binding: { companyId: string; projectId: string }; fields: FieldConfig[] } = ${JSON.stringify(config, null, 2)};\n`);
writeFileSync(join(out, 'appspec.json'), specRaw);

// 1) strict typecheck of generated source (bounded heap)
const tsc = spawnSync(process.execPath, ['--max-old-space-size=768', join(NM, 'typescript/bin/tsc'), '-p', join(web, 'tsconfig.json')], { encoding: 'utf8', cwd: web });
writeFileSync(join(out, 'LOG-TSC.txt'), (tsc.stdout || '') + (tsc.stderr || '') + `\nexit=${tsc.status}\n`);
if (tsc.status !== 0) { console.error('TYPECHECK_FAILED\n' + tsc.stdout + tsc.stderr); process.exit(1); }

// 2) vite production build (programmatic, configFile:false => no spec-controlled config)
process.env.NODE_ENV = 'production'; // ensure production React (no dev build in served artifact)
const { build } = await import(pathToFileURL(join(NM, 'vite/dist/node/index.js')).href);
const react = (await import(pathToFileURL(join(NM, '@vitejs/plugin-react/dist/index.js')).href)).default;
await build({ root: web, configFile: false, mode: 'production', logLevel: 'warn', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [react()], base: '/',
  build: { outDir: join(out, 'dist'), emptyOutDir: true, sourcemap: false, modulePreload: { polyfill: false }, assetsInlineLimit: 0 } });

const dist = treeDigest(join(out, 'dist'));
const genTree = treeDigest(web);
const receipt = {
  schema: 'APP_BUILD_RECEIPT_V1', buildId: `build_${spec.appId}_r${spec.specRevision}_${buildFingerprint.slice(0, 12)}`,
  appId: spec.appId, specRevision: spec.specRevision, specSha256, buildRevision, buildFingerprint, binding: spec.binding, canonicalIdsCheck, bindingInjectedFrom: { appSpecInput: a.spec, bindingFile: a['binding-file'] ?? null, envOverrides: injected },
  generatorSha256, templateTreeSha256, generatedSourceTreeSha256: genTree.digest, artifactDigest: dist.digest, distFiles: dist.files, toolchain,
  builder: { host: hostname(), pid: process.pid, maxOldSpaceMb: 768, nice: true, startedAt, finishedAt: new Date().toISOString(), exitCode: 0, installScriptsRun: false, networkInstall: false,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) },
  executionClass: a['execution-class'],
};
writeFileSync(join(out, 'APP_BUILD_RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, out, buildRevision, buildFingerprint, binding: spec.binding, artifactDigest: dist.digest, specRevision: spec.specRevision, files: dist.files.length, peakRssMiB: receipt.builder.peakRssMiB }));
