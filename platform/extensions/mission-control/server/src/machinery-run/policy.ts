import {createHash} from 'node:crypto';
import type {MachineryRunActor,MachineryRunSelectionInput} from './types.js';

const ID=/^[A-Za-z0-9_.:@-]{1,180}$/;
const KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
export const MACHINERY_RUN_LIMITS={objectiveBytes:4096,plans:16,workPackages:64,blockers:128,receipts:256,runs:100} as const;
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const safeId=(value:unknown,label='identifier')=>{const v=String(value||'').trim();if(!ID.test(v))throw new Error(`Invalid ${label}.`);return v};
export const safeKey=(value:unknown)=>{const v=String(value||'').trim();if(!KEY.test(v))throw new Error('Invalid machinery run idempotency key.');return v};
export const cleanObjective=(value:unknown)=>{if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>MACHINERY_RUN_LIMITS.objectiveBytes)throw new Error('Machinery run objective is empty or too large.');const v=value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();if(!v)throw new Error('Machinery run objective is empty or too large.');return v};
export const actorScope=(actor:MachineryRunActor)=>{const ownerId=safeId(actor.userId,'owner id'),tenantId=safeId(actor.workspaceTenantId||actor.userId,'tenant id');return{ownerId,tenantId,workspaceId:tenantId}};
export function normalizeRequestedSelections(values:MachineryRunSelectionInput[]){if(!Array.isArray(values)||!values.length||values.length>MACHINERY_RUN_LIMITS.plans)throw new Error('Machinery run requires one to sixteen plan selections.');const normalized=values.map(v=>({orchestrationPlanId:safeId(v.orchestrationPlanId,'orchestration plan id'),workPackageIds:[...new Set((v.workPackageIds||[]).map(id=>safeId(id,'work package id')))].sort()})).sort((a,b)=>a.orchestrationPlanId.localeCompare(b.orchestrationPlanId));if(new Set(normalized.map(x=>x.orchestrationPlanId)).size!==normalized.length)throw new Error('Duplicate machinery run plan selection.');const total=normalized.reduce((n,x)=>n+x.workPackageIds.length,0);if(total>MACHINERY_RUN_LIMITS.workPackages)throw new Error('Too many selected machinery work packages.');return normalized}
export const runCursor=(tenantId:string,runId:string,sequence:number)=>`mr1:${digest({tenantId,runId}).slice(0,16)}:${sequence}`;
export function parseRunCursor(cursor:string|undefined,tenantId:string,runId:string){if(!cursor)return 0;const m=/^mr1:([a-f0-9]{16}):(\d+)$/.exec(cursor);if(!m||m[1]!==digest({tenantId,runId}).slice(0,16))throw new Error('Machinery reconnect cursor does not belong to this run.');const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid machinery reconnect cursor.');return n}
