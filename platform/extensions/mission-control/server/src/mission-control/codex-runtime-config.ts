import {lstatSync,readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import type {Server} from 'node:http';
import type {Store} from '../store.js';
import {Lcg2MissionControlQueue} from './lcg2-queue.js';
import {mountMissionControlOperatorHost} from './codex-operator-host.js';

/** Operator-controlled deployment interlocks, not substitutes for review evidence.
 * Default off returns before file I/O, DB changes, listeners or timers. */
export function missionControlReleaseConfig(env:NodeJS.ProcessEnv){
 if(env.MC_RUNTIME_ENABLED!=='true')return;
 const sha=env.MC_RELEASE_SHA;
 if(!sha||!/^[a-f0-9]{40}$/.test(sha)||
  ['MC_SECURITY_APPROVED_SHA','MC_ACCEPTANCE_APPROVED_SHA','MC_ROLLBACK_VERIFIED_SHA','MC_OPERATOR_APPROVED_SHA']
   .some(key=>env[key]!==sha))throw Error('MC_EXACT_RELEASE_APPROVALS_REQUIRED');
 const operatorOrigin=env.MC_OPERATOR_ORIGIN??'';
 const parsed=new URL(operatorOrigin);
 if(parsed.protocol!=='https:'||parsed.origin!==operatorOrigin)throw Error('MC_OPERATOR_HTTPS_ORIGIN_REQUIRED');
 const extensionOrigin=env.MC_EXTENSION_ORIGIN??'';
 if(!/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin))throw Error('MC_EXTENSION_ORIGIN_REQUIRED');
 const witnessId=env.MC_WITNESS_ID??'',publicFile=env.MC_WITNESS_PUBLIC_KEY_FILE??'';
 if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(witnessId)||!isAbsolute(publicFile))
  throw Error('MC_INDEPENDENT_WITNESS_REQUIRED');
 return {sha,operatorOrigin,extensionOrigin,witnessId,publicFile};
}
export function mountConfiguredMissionControl(store:Store,server:Server,env:NodeJS.ProcessEnv=process.env){
 const config=missionControlReleaseConfig(env);if(!config)return;
 const meta=lstatSync(config.publicFile);
 if(!meta.isFile()||meta.nlink!==1||meta.uid!==process.getuid?.()||(meta.mode&0o077)!==0||meta.size>4096)
  throw Error('MC_WITNESS_FILE_NOT_PRIVATE');
 const publicKey=readFileSync(config.publicFile,'utf8');
 const path=store.db.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
 if(typeof path!=='string'||!path)throw Error('MC_CANONICAL_DURABLE_STORE_REQUIRED');
 new Lcg2MissionControlQueue(path).close();
 return mountMissionControlOperatorHost({store,server,operatorOrigin:config.operatorOrigin,
  extensionOrigins:[config.extensionOrigin],witness:{witnessId:config.witnessId,witnessPublicKeyPem:publicKey}});
}
