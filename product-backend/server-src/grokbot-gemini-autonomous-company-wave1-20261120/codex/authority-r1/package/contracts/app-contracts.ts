// grokbot3 — APP_SPEC_V1, APP_BUILD_RECEIPT_V1, APP_RELEASE_MANIFEST_V1 and the
// PROVISIONAL trusted-context envelope types consumed from Grokbot1/Grokbot2.
// Decision STARLI_GROKBOT_GEMINI_AUTONOMOUS_COMPANY_INTEGRATION_WAVE1_20261120_V1
// Pure TypeScript + runtime validators (no dependencies). Consumers import from
// server/src/grokbot-gemini-autonomous-company-wave1-20261120/grokbot3/contracts/app-contracts.ts

export const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
export const SHA256_RE = /^[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------
// PROVISIONAL upstream envelope (owned by Grokbot1 identity / Grokbot2 task).
// grokbot3 does NOT own these; they mirror INTERFACE-CONTRACT.md v1 field names
// until Grokbot1/Grokbot2 publish their typed schemas. Marked provisional.
// ---------------------------------------------------------------------------
export type PrincipalKind = 'RESTRICTED_GUEST' | 'VERIFIED_REGISTERED_PERSON';
/** PROVISIONAL mirror of Grokbot1 TRUSTED_CONTEXT envelope (INTERFACE-CONTRACT v1). */
export interface ProvisionalTrustedContextV1 {
  envelope: 'PROVISIONAL_TRUSTED_CONTEXT_V1';
  companyId: string; projectId: string; requestId: string; idempotencyKey: string;
  revision: number; principalKind: PrincipalKind; subjectId: string;
  scope: readonly string[]; authorizationRevision: number; issuedAt: string; expiresAt: string;
}
/** PROVISIONAL mirror of Grokbot2 NATIVE_TASK_REQUEST_V1 task binding fields. */
export interface ProvisionalTaskBindingV1 {
  envelope: 'PROVISIONAL_TASK_BINDING_V1';
  graphId: string; taskId: string; botId: string | null; roomId: string | null;
  nativeSourceMessageId: string | null; turnId: string | null;
  /** Grokbot2 WORKER_EXECUTION_RECEIPT_V1 digest when available; null => not bound. */
  workerReceiptSha256: string | null;
}

// ---------------------------------------------------------------------------
// APP_SPEC_V1 (owned by grokbot3)
// ---------------------------------------------------------------------------
export type AppTemplate = 'DOG_REGISTRY_V1';
export type StorageEngineRequest = 'SQLITE_DISK_TEST_FIXTURE' | 'MONGODB_REPLICA_SET';
export interface AppSpecFieldV1 { name: 'name' | 'breed' | 'ageYears' | 'notes'; label: string; required: boolean; maxLength?: number; min?: number; max?: number; }
export interface AppSpecV1 {
  schema: 'APP_SPEC_V1';
  appId: string;               // stable app identity
  specRevision: number;        // monotonically increasing; new revision => new build
  displayName: string;
  tagline: string;
  template: AppTemplate;       // allowlisted template only; no arbitrary code/scripts
  theme: { accent: string };   // #rrggbb
  fields: AppSpecFieldV1[];
  limits: { maxDogsPerProject: number; maxWritesPerSubjectPerMinute: number; maxBodyBytes: number };
  storage: { requested: StorageEngineRequest; fallbackForTests: 'SQLITE_DISK_TEST_FIXTURE' };
  /** Injected at generation time (AppSpec input, --binding-file, or GB3_BINDING_* env); never hard-coded in code. */
  binding: { companyId: string; projectId: string; requestId: string; graphId: string; taskId: string; taskIds?: string[];
             bindingSource: 'PROVISIONAL_GROKBOT3_FIXTURE' | 'BOSS_CANONICAL_IDS_V1' | 'GROKBOT1_PROVISIONAL_FLOW' | 'GROKBOT2_NATIVE_TASK_REQUEST_V1' };
}

export class ContractError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } }
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function str(o: Record<string, unknown>, k: string, re?: RegExp, max = 200): string {
  const v = o[k]; if (typeof v !== 'string' || !v.trim() || v.length > max || (re && !re.test(v))) throw new ContractError('APP_SPEC_INVALID', `invalid ${k}`); return v;
}
function int(o: Record<string, unknown>, k: string, lo: number, hi: number): number {
  const v = o[k]; if (!Number.isSafeInteger(v) || (v as number) < lo || (v as number) > hi) throw new ContractError('APP_SPEC_INVALID', `invalid ${k}`); return v as number;
}
const ALLOWED_KEYS = ['schema','appId','specRevision','displayName','tagline','template','theme','fields','limits','storage','binding'];
export function validateAppSpec(x: unknown): AppSpecV1 {
  if (!isObj(x)) throw new ContractError('APP_SPEC_INVALID', 'not an object');
  for (const k of Object.keys(x)) if (!ALLOWED_KEYS.includes(k)) throw new ContractError('APP_SPEC_INVALID', `unknown key ${k}`);
  if (x.schema !== 'APP_SPEC_V1') throw new ContractError('APP_SPEC_INVALID', 'schema');
  if (x.template !== 'DOG_REGISTRY_V1') throw new ContractError('APP_SPEC_TEMPLATE_DENIED', 'template not allowlisted');
  str(x, 'appId', ID_RE); int(x, 'specRevision', 1, 1_000_000);
  str(x, 'displayName', /^[\p{L}\p{N} .,'!&-]{1,40}$/u, 40); str(x, 'tagline', /^[\p{L}\p{N} .,'!&?-]{1,120}$/u, 120);
  if (!isObj(x.theme) || typeof x.theme.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x.theme.accent)) throw new ContractError('APP_SPEC_INVALID', 'theme');
  if (!Array.isArray(x.fields) || x.fields.length < 1 || x.fields.length > 4) throw new ContractError('APP_SPEC_INVALID', 'fields');
  const seen = new Set<string>();
  for (const f of x.fields) {
    if (!isObj(f) || !['name','breed','ageYears','notes'].includes(String(f.name)) || seen.has(String(f.name))) throw new ContractError('APP_SPEC_INVALID', 'field');
    seen.add(String(f.name)); str(f, 'label', /^[\p{L}\p{N} ()-]{1,40}$/u, 40);
    if (typeof f.required !== 'boolean') throw new ContractError('APP_SPEC_INVALID', 'field.required');
  }
  if (!seen.has('name')) throw new ContractError('APP_SPEC_INVALID', 'name field required');
  if (!isObj(x.limits)) throw new ContractError('APP_SPEC_INVALID', 'limits');
  int(x.limits, 'maxDogsPerProject', 1, 1000); int(x.limits, 'maxWritesPerSubjectPerMinute', 1, 600); int(x.limits, 'maxBodyBytes', 256, 16384);
  if (!isObj(x.storage) || !['SQLITE_DISK_TEST_FIXTURE','MONGODB_REPLICA_SET'].includes(String(x.storage.requested)) || x.storage.fallbackForTests !== 'SQLITE_DISK_TEST_FIXTURE') throw new ContractError('APP_SPEC_INVALID', 'storage');
  if (!isObj(x.binding)) throw new ContractError('APP_SPEC_INVALID', 'binding');
  for (const k of ['companyId','projectId','requestId','graphId','taskId']) str(x.binding, k, ID_RE);
  if (x.binding.taskIds !== undefined && (!Array.isArray(x.binding.taskIds) || x.binding.taskIds.length < 1 || x.binding.taskIds.length > 16 || !x.binding.taskIds.every(t => typeof t === 'string' && ID_RE.test(t)) || !x.binding.taskIds.includes(x.binding.taskId))) throw new ContractError('APP_SPEC_INVALID', 'binding.taskIds');
  for (const k of Object.keys(x.binding)) if (!['companyId','projectId','requestId','graphId','taskId','taskIds','bindingSource'].includes(k)) throw new ContractError('APP_SPEC_INVALID', `unknown binding key ${k}`);
  if (!['PROVISIONAL_GROKBOT3_FIXTURE','BOSS_CANONICAL_IDS_V1','GROKBOT1_PROVISIONAL_FLOW','GROKBOT2_NATIVE_TASK_REQUEST_V1'].includes(String(x.binding.bindingSource))) throw new ContractError('APP_SPEC_INVALID', 'bindingSource');
  return x as unknown as AppSpecV1;
}

// ---------------------------------------------------------------------------
// APP_BUILD_RECEIPT_V1 (owned by grokbot3) — emitted by generator/generate.mjs
// ---------------------------------------------------------------------------
export interface AppBuildReceiptV1 {
  schema: 'APP_BUILD_RECEIPT_V1';
  buildId: string; appId: string; specRevision: number; specSha256: string;
  /** Integer build sequence == AppSpec specRevision (accepted Boss mapping; Grokbot4 integer buildRevision). */
  buildRevision: number;
  /** sha256(JSON{specSha256, generatorSha256, templateTreeSha256, toolchain}) — reproducibility fingerprint (was the sha "buildRevision" in r1/r2 legacy receipts). */
  buildFingerprint: string;
  binding: AppSpecV1['binding'];
  generatorSha256: string; templateTreeSha256: string; generatedSourceTreeSha256: string;
  artifactDigest: string;           // sha256 over sorted dist file list "path\0sha256\n"
  distFiles: { path: string; sha256: string; bytes: number }[];
  toolchain: { node: string; vite: string; react: string; typescript: string; esbuild: string };
  builder: { host: string; pid: number; maxOldSpaceMb: number; nice: boolean; startedAt: string; finishedAt: string; exitCode: number; installScriptsRun: false; networkInstall: false };
  executionClass: 'FIXTURE' | 'COMBINED_CANDIDATE';
}

// ---------------------------------------------------------------------------
// APP_RELEASE_MANIFEST_V1 (owned by grokbot3) — consumed by Grokbot4 / Boss
// ---------------------------------------------------------------------------
export interface AppReleaseManifestV1 {
  schema: 'APP_RELEASE_MANIFEST_V1';
  releaseId: string; appId: string; specRevision: number; buildRevision: number; buildFingerprint: string; artifactDigest: string; /** == artifactDigest (Boss CANONICAL-IDS grokbot3.artifactRevision) */ artifactRevision: string;
  buildReceiptSha256: string; serverSourceTreeSha256: string; openapiSha256: string; appSpecSha256: string;
  binding: AppSpecV1['binding'];
  storage: { engine: 'SQLITE_DISK_TEST_FIXTURE' | 'MONGODB_REPLICA_SET'; productionEligible: boolean; note: string };
  authority: { supported: ('FIXTURE_APP_AUTHORITY' | 'GROKBOT1_NATIVE_ADAPTER')[]; note: string };
  runtime: { node: string; entry: string; args: string[]; listen: '127.0.0.1'; servingMemoryLimitMiB: 512; heavyBuildInServingTier: false };
  commands: { build: string; migrate: string; rollback: string; start: string; health: string; issueFixtureSession: string; revoke: string };
  health: { path: '/api/v1/app/health'; expects: { buildRevision: number; artifactDigest: string; specSha256: string; companyId: string; projectId: string } };
  createdAt: string; executionClass: 'FIXTURE' | 'COMBINED_CANDIDATE'; previewReady: false;
}

export function treeLine(path: string, sha256: string) { return `${path}\0${sha256}\n`; }
