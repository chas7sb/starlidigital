import {DatabaseSync} from 'node:sqlite';
import { createHash } from 'node:crypto';
import { stopFacebookCustomerPilotEffects } from './pilot-effect-stop.js';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store } from '../store.js';
import { FacebookCustomerScheduler, createScheduleCipher } from '../facebook-customer/scheduler.js';
import { createTrustedScheduledFacebookPublisherComposition } from './scheduled-publisher-composition.js';
import { createFacebookCustomerPilotComposition } from './pilot-composition.js';

const configSchema = z.object({
  issuer: z.string().url(),
  registeredClients: z.array(z.object({
    clientId: z.string().min(1),
    enabled: z.literal(true),
    redirectUris: z.array(z.string().url()).min(1),
  }).strict()).min(1),
  firstPhoto: z.object({
    tenantId:z.string().min(1),
    pageId:z.string().regex(/^[0-9]+$/),
    commandId:z.string().regex(/^[A-Za-z0-9_.:-]{8,160}$/),
    captionSha256:z.string().regex(/^[a-f0-9]{64}$/),
    mediaSha256:z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  facebook: z.object({
    appId: z.string().min(1),
    appSecret: z.string().min(1),
    redirectUri: z.string().url(),
    credentialKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    graphVersion: z.string().regex(/^v[0-9]+\.[0-9]+$/),
  }).strict(),
}).strict();

function privatePilotDatabase(state: string) {
  if (!isAbsolute(state)) throw Error('DEDICATED_STATE_REQUIRED');
  const root = realpathSync(state);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
  }
  const database = join(root, 'facebook-customer-pilot.sqlite');
  for (const path of [database, database + '-wal', database + '-shm']) {
    const info = lstatSync(path, { throwIfNoEntry:false });
    if (info && (!info.isFile() || info.nlink !== 1 || info.uid !== stat.uid || (info.mode & 0o077) !== 0)) {
      throw Error('PRIVATE_PILOT_DATABASE_REQUIRED');
    }
  }
  return {root,database};
}

export function stopExistingCustomerMcpPilot(env: NodeJS.ProcessEnv): void {
  const {database}=privatePilotDatabase(env.STATE_DIRECTORY ?? '');
  if (!lstatSync(database, {throwIfNoEntry:false})) throw Error('EXISTING_PILOT_DATABASE_REQUIRED');
  const store=new Store(database);
  try { stopFacebookCustomerPilotEffects(store); } finally { store.close(); }
}

type CompositionInput=Parameters<typeof createFacebookCustomerPilotComposition>[0];
type FirstPhoto=NonNullable<z.infer<typeof configSchema>['firstPhoto']>;

export function authorizeFirstPhoto(approval:FirstPhoto):NonNullable<CompositionInput['authorizeProviderWrite']>{
  return (binding,command)=>{
    const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
    if(binding.tenantId!==approval.tenantId||command.tenantId!==approval.tenantId||
       binding.verifiedPageId!==approval.pageId||command.pageId!==approval.pageId||
       command.commandId!==approval.commandId||command.media?.kind!=='IMAGE'||
       digest(command.caption.trim())!==approval.captionSha256||
       digest(command.media.bytes)!==approval.mediaSha256){
      throw Error('FIRST_PHOTO_APPROVAL_MISMATCH');
    }
  };
}

export async function launchCustomerMcpReadiness(env: NodeJS.ProcessEnv, port = 4130) {
  const openAiKey = env.OPENAI_API_KEY || (()=>{
    try {
      const text = readFileSync('/etc/starlidigital/production.env', 'utf8');
      const m = /^OPENAI_API_KEY=["']?([^"'\r\n]+)/m.exec(text);
      return m ? m[1] : undefined;
    } catch { return undefined; }
  })();

  const liveFirstPhoto = env.FACEBOOK_CUSTOMER_EXTERNAL_WRITES_ENABLED === 'true' &&
    env.CUSTOMER_MCP_LIVE_FIRST_PHOTO === 'true';
  const livePosting = env.FACEBOOK_CUSTOMER_EXTERNAL_WRITES_ENABLED === 'true' &&
    (liveFirstPhoto || env.CUSTOMER_MCP_POSTING_ENABLED === 'true');
  const imageGen = env.CUSTOMER_MCP_IMAGE_GEN_ENABLED === 'true' &&
    env.CUSTOMER_MCP_IMAGE_GEN_OPT_IN === 'true' &&
    Boolean(openAiKey);
  const scheduledDispatch = livePosting && env.CUSTOMER_MCP_SCHEDULED_DISPATCH_ENABLED === 'true';
  const instagramEnabled = env.CUSTOMER_MCP_INSTAGRAM_ENABLED === 'true';
  if(instagramEnabled&&(!scheduledDispatch||liveFirstPhoto))throw Error('INSTAGRAM_EFFECTS_DISABLED');
  const reelsEnabled = env.CUSTOMER_MCP_FACEBOOK_REELS_ENABLED === 'true';
  const videoDatabasePath = env.CUSTOMER_MCP_VIDEO_DATABASE_PATH;
  const videoRenderRoot = env.CUSTOMER_MCP_VIDEO_RENDER_ROOT;
  if (reelsEnabled && (!scheduledDispatch || liveFirstPhoto ||
      !videoDatabasePath || !isAbsolute(videoDatabasePath) || !videoRenderRoot || !isAbsolute(videoRenderRoot))) {
    throw Error('FACEBOOK_REEL_CONFIGURATION_REQUIRED');
  }
  const recurringEnabled = env.CUSTOMER_MCP_RECURRING_ENABLED === 'true';
  const recurringCustomer = env.CUSTOMER_MCP_UNCAPPED_IMAGE_CUSTOMER_ID;
  if (recurringEnabled && (!scheduledDispatch || !imageGen || liveFirstPhoto || !recurringCustomer)) {
    throw Error('RECURRING_GENERATION_AUTHORIZATION_REQUIRED');
  }
  const live = livePosting || imageGen;

  for (const key of ['FACEBOOK_CUSTOMER_EXTERNAL_WRITES_ENABLED',
    'CUSTOMER_MCP_IMAGE_GEN_ENABLED', 'CUSTOMER_MCP_SCHEDULED_DISPATCH_ENABLED']) {
    if (key === 'FACEBOOK_CUSTOMER_EXTERNAL_WRITES_ENABLED' && livePosting) continue;
    if (key === 'CUSTOMER_MCP_IMAGE_GEN_ENABLED' && imageGen) continue;
    if (key === 'CUSTOMER_MCP_SCHEDULED_DISPATCH_ENABLED' && scheduledDispatch) continue;
    if (env[key] !== undefined && env[key] !== 'false') throw Error('LAUNCHER_EFFECTS_DISABLED');
  }
  if (env.CUSTOMER_MCP_HOST !== undefined && env.CUSTOMER_MCP_HOST !== '127.0.0.1') {
    throw Error('LOOPBACK_REQUIRED');
  }
  if (env.CUSTOMER_MCP_PORT !== undefined && env.CUSTOMER_MCP_PORT !== '4130') {
    throw Error('DEDICATED_PORT_REQUIRED');
  }
  const state = env.STATE_DIRECTORY;
  const credentials = env.CREDENTIALS_DIRECTORY;
  if (!state || !credentials || !isAbsolute(state) || !isAbsolute(credentials)) {
    throw Error('DEDICATED_STATE_AND_CREDENTIALS_REQUIRED');
  }
  const config = configSchema.parse(JSON.parse(readFileSync(join(credentials, 'pilot.json'), 'utf8')));
  if (liveFirstPhoto && !config.firstPhoto) throw Error('FIRST_PHOTO_APPROVAL_REQUIRED');
  const issuer = new URL(config.issuer);
  if (issuer.protocol !== 'https:' || issuer.origin !== config.issuer ||
      config.facebook.redirectUri !== issuer.origin + '/customer/facebook/callback' ||
      config.registeredClients.some(client => client.redirectUris.some(uri => {
        const url = new URL(uri);
        return url.protocol !== 'https:' || !!(url.username || url.password || url.hash);
      }))) {
    throw Error('INVALID_PILOT_HTTPS_CONFIGURATION');
  }

  const {root,database}=privatePilotDatabase(state);
  const stat=lstatSync(root);
  const privateStorageRoot = join(root, 'private-media');
  mkdirSync(privateStorageRoot, { recursive:true, mode:0o700 });
  const mediaStat = lstatSync(privateStorageRoot);
  if (!mediaStat.isDirectory() || mediaStat.uid !== stat.uid || (mediaStat.mode & 0o077) !== 0) {
    throw Error('PRIVATE_MEDIA_DIRECTORY_REQUIRED');
  }

  const store = new Store(database);
  try {
    store.db.exec("ATTACH DATABASE '/var/lib/starlidigital/starli.sqlite' AS starli_main;");
    store.db.exec("INSERT OR REPLACE INTO users SELECT * FROM starli_main.users;");
    store.db.exec("INSERT OR IGNORE INTO sessions SELECT * FROM starli_main.sessions;");
  } catch {
    // Offline / isolated test fixture without host database
  }
  let videoDatabase:DatabaseSync|undefined;
  try {
    let facebookReels:CompositionInput['facebookReels'];
    if (reelsEnabled && videoDatabasePath && videoRenderRoot) {
      const source = videoDatabase = new DatabaseSync(videoDatabasePath,{readOnly:true});
      const getRecord = source.prepare('SELECT payload FROM records WHERE collection=? AND id=?');
      const getUser = source.prepare('SELECT payload FROM users WHERE id=?');
      const read = (row:{payload?:unknown}|undefined) =>
        typeof row?.payload==='string'?JSON.parse(row.payload):undefined;
      facebookReels={renderRoot:realpathSync(videoRenderRoot),videoStore:{
        get:(collection,id)=>read(getRecord.get(collection,id)),
        user:id=>read(getUser.get(id)),
      }};
    }
    const pilot = await createFacebookCustomerPilotComposition({
      ...config, store, privateStorageRoot, externalWritesEnabled:livePosting,
      ...(facebookReels?{facebookReels}:{}),
      ...(instagramEnabled?{instagram:{
        loadCredential:()=>JSON.parse(readFileSync(join(credentials,'instagram-account.json'),'utf8')),
      }}:{}),
      ...(!scheduledDispatch?{disableDueWorker:true as const}:{}),
      ...(recurringEnabled&&recurringCustomer?{recurringApproval:{
        customerId:recurringCustomer,
        loadApproval:ref=>{
          if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(ref))throw Error('INVALID_RECURRING_APPROVAL_ID');
          try{return JSON.parse(readFileSync(join(credentials,'recurring-approvals',ref+'.json'),'utf8'));}
          catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          return JSON.parse(readFileSync(join(credentials,'recurring-approval.json'),'utf8'));
        },
      }}:{}),
      ...(liveFirstPhoto && config.firstPhoto ? {
        authorizeProviderWrite:authorizeFirstPhoto(config.firstPhoto!),
      } : live ? {} : {offlineReadiness:true as const}),
      ...(imageGen ? {
        openaiImageGeneration: {
          enabled: true,
          resolveServerCredential: () => openAiKey!,
          requireExplicitPublishApprovalForGeneratedMedia: false,
          defaultTenantBudgetUsdCents: 500,
          uncappedCustomerId: env.CUSTOMER_MCP_UNCAPPED_IMAGE_CUSTOMER_ID,
        }
      } : {}),
      scheduler:({ pages, pageTokens, provider, media }) => {
        const scheduleCipher = createScheduleCipher(Buffer.from(config.facebook.credentialKey, 'base64'));
        const trustedPublisher = livePosting ? createTrustedScheduledFacebookPublisherComposition({
          store,
          ports: {
            cipher: scheduleCipher,
            async authorizeOriginalSchedule(input) {
              const job = store.get('facebook-customer-schedule', input.jobId);
              return Boolean(
                job &&
                job.tenantId === input.tenantId &&
                job.userId === input.userId &&
                job.commandId === input.originalCommandId &&
                job.payloadHash === input.payloadHash
              );
            },
            async resolveCurrentPage({ tenantId, userId, pageConnectionId }) {
              return pages.requireSelectedDispatchGrant({ tenantId, userId }, pageConnectionId);
            },
            async readOwnedMediaForDue({ tenantId, userId, jobId, mediaRef }) {
              const { bytes, media: imgReceipt } = media.readImageForScheduledPublish({
                tenantId,
                userId,
                jobId,
                mediaRef,
                cipher: scheduleCipher,
              });
              return {
                tenantId,
                ownerUserId: userId,
                ref: mediaRef,
                state: 'READY' as const,
                kind: 'IMAGE' as const,
                mimeType: imgReceipt.contentType as 'image/png' | 'image/jpeg',
                sha256: imgReceipt.sha256,
                bytes,
              };
            },
          },
          pageTokens,
          provider,
          externalWritesEnabled: livePosting,
        }) : { async publishNow(){throw Error('LAUNCHER_EFFECTS_DISABLED')} };
        return new FacebookCustomerScheduler(store, {
          cipher: scheduleCipher,
          publisher: trustedPublisher,
          async authorizeSchedule(input) {
            return livePosting && Boolean(input.tenantId && input.userId && input.pageConnectionId);
          },
          async authorizeCancel() {
            return true;
          },
          async authorizeDueDispatch() {
            return scheduledDispatch;
          },
          async resolvePage({ tenantId, userId, pageConnectionId }) {
            return pages.requireSelectedDispatchGrant({ tenantId, userId }, pageConnectionId);
          },
          async resolveMedia({ tenantId, userId, mediaRef }) {
            if (!livePosting) return undefined;
            const item = store.get('facebook-customer-media', mediaRef) as {
              id: string; tenantId: string; subjectId: string; mediaRef: string;
              state: string; contentType: string; sha256: string; byteSize: number;
              revokedAt?: unknown;
            } | undefined;
            if (!item || item.tenantId !== tenantId || item.subjectId !== userId || item.state !== 'STORED_PRIVATE' || item.revokedAt !== undefined) {
              return undefined;
            }
            return {
              tenantId,
              ownerUserId: userId,
              ref: mediaRef,
              state: 'READY' as const,
              kind: 'IMAGE' as const,
              mimeType: item.contentType as 'image/png' | 'image/jpeg',
              sha256: item.sha256,
              bytes: item.byteSize,
            };
          },
        }, {
          enqueueEnabled: livePosting,
          dispatchEnabled: scheduledDispatch,
        });
      },
    }).start(port);
    let closing:Promise<void>|undefined;
    return {
      address:pilot.address,
      close:()=>closing ??= pilot.close().finally(()=>{videoDatabase?.close();store.close();}),
    };
  } catch (error) {
    videoDatabase?.close();
    store.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  if (process.argv.length === 3 && process.argv[2] === '--stop-effects') {
    try {
      stopExistingCustomerMcpPilot(process.env);
      console.info('Customer MCP provider stop recorded');
    } catch {
      console.error('Customer MCP provider stop failed. Check dedicated private state.');
      process.exitCode=1;
    }
  } else if (process.argv.length !== 2) {
    console.error('Invalid Customer MCP launcher arguments');
    process.exitCode=1;
  } else {
    launchCustomerMcpReadiness(process.env).then(pilot=>{
      const stop=()=>void pilot.close().catch(()=>{process.exitCode=1});
      process.once('SIGTERM',stop);
      process.once('SIGINT',stop);
      console.info('Customer MCP listening on 127.0.0.1:4130');
    }).catch(()=>{
      console.error('Customer MCP startup refused. Check private state and trusted configuration.');
      process.exitCode=1;
    });
  }
}
