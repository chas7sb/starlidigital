import { createHash, randomBytes } from 'node:crypto';
import { Store, id, now, type RecordData } from './store.js';
import { Events } from './events.js';
import { fail, bounded, type Context } from './security.js';
import { requireOperator, recordOperatorAudit, redactSecrets } from './operator-auth.js';
import {
  isContactOptedOut,
  rotateOrRevokeClaimCode,
  normalizeRomanianPhone,
  type LeadRecord,
  type ProposalRecord
} from './leads-proposals.js';
import { enqueueDeviceTask, type DeviceRecord } from './operator-devices.js';

export const MESSAGE_STATES = [
  'PREGATIT',
  'APROBAT',
  'EXPEDIERE',
  'TRIMIS_DISPOZITIV',
  'EXPEDIAT',
  'LIVRAT',
  'ESUAT',
  'INCERT'
] as const;

export type MessageState = (typeof MESSAGE_STATES)[number];

export type OutboundMessageKind = 'COMMERCIAL_PROPOSAL' | 'TRANSACTIONAL_OTP';

export type OutboundMessageRecord = RecordData & {
  id: string;
  ownerId: string;
  leadId: string | null;
  proposalId: string | null;
  kind: OutboundMessageKind;
  adapter: 'WINDOWS_ADB' | 'SMS_API' | 'SIMULATED';
  deviceId: string | null;
  recipientPhone: string;
  body: string;
  proposalUrl: string | null;
  optOutInfo: string;
  status: MessageState;
  idempotencyKey: string;
  fingerprint: string;
  approvedBy: string | null;
  approvedAt: string | null;
  deviceJobId: string | null;
  providerMessageId: string | null;
  capabilityReport: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface SmsProviderAdapter {
  readonly name: 'WINDOWS_ADB' | 'SMS_API' | 'SIMULATED';
  inspectCapabilities(store: Store, deviceId?: string | null): {
    ready: boolean;
    canSendSms: boolean;
    detail: string;
  };
  dispatch(
    store: Store,
    events: Events | undefined,
    ctx: Context,
    message: OutboundMessageRecord
  ): Promise<{
    nextState: MessageState;
    deviceJobId?: string | null;
    providerMessageId?: string | null;
    detail: string;
  }>;
}

export class WindowsAdbMessagingAdapter implements SmsProviderAdapter {
  readonly name = 'WINDOWS_ADB' as const;

  inspectCapabilities(store: Store, deviceId?: string | null): {
    ready: boolean;
    canSendSms: boolean;
    detail: string;
  } {
    const devices = store.list('operator-devices') as DeviceRecord[];
    const device = deviceId
      ? devices.find(d => d.id === deviceId)
      : devices.find(d => d.status === 'ONLINE');

    if (!device) {
      return {
        ready: false,
        canSendSms: false,
        detail: 'Niciun conector Windows (starli-device) nu este conectat.'
      };
    }
    if (device.status !== 'ONLINE' || device.revokedAt) {
      return {
        ready: false,
        canSendSms: false,
        detail: `Dispozitivul Windows „${device.name}” este ${device.status}.`
      };
    }
    if (device.adbStatus !== 'CONNECTED' || !device.adbDevices.length) {
      return {
        ready: false,
        canSendSms: false,
        detail: `Telefonul Android pe „${device.name}” are starea ADB: ${device.adbStatus}.`
      };
    }
    const phone = device.adbDevices.find(d => d.state === 'device');
    if (!phone) {
      return {
        ready: false,
        canSendSms: false,
        detail: 'Niciun telefon Android autorizat nu este activ în ADB.'
      };
    }
    if (!phone.canSendSms) {
      return {
        ready: false,
        canSendSms: false,
        detail:
          phone.limitation ||
          `Telefonul Android (${phone.model}) este conectat, dar configurarea Android curentă nu permite trimiterea directă de SMS prin ADB fără confirmare pe ecran.`
      };
    }
    return {
      ready: true,
      canSendSms: true,
      detail: `Telefonul Android ${phone.model} (${phone.serial}) este conectat și pregătit.`
    };
  }

  async dispatch(
    store: Store,
    events: Events | undefined,
    ctx: Context,
    message: OutboundMessageRecord
  ): Promise<{
    nextState: MessageState;
    deviceJobId?: string | null;
    providerMessageId?: string | null;
    detail: string;
  }> {
    const cap = this.inspectCapabilities(store, message.deviceId);
    if (!cap.ready || !cap.canSendSms) {
      // Never fake success or bypass device restrictions: keep the message APROBAT and report the exact limitation!
      return {
        nextState: 'APROBAT',
        detail: cap.detail
      };
    }
    const devices = store.list('operator-devices') as DeviceRecord[];
    const targetDevice = message.deviceId
      ? devices.find(d => d.id === message.deviceId)!
      : devices.find(d => d.status === 'ONLINE')!;
    const phone = targetDevice.adbDevices.find(d => d.state === 'device' && d.canSendSms);

    const job = enqueueDeviceTask(store, events, ctx, {
      deviceId: targetDevice.id,
      kind: 'device.sms.send',
      idempotencyKey: `sms-adb:${message.id}`,
      args: {
        messageId: message.id,
        to: message.recipientPhone,
        body: message.body,
        serial: phone?.serial || null
      }
    });

    return {
      nextState: 'TRIMIS_DISPOZITIV',
      deviceJobId: job.id,
      detail: `Trimis către dispozitivul Windows (${targetDevice.name}) cu jobId ${job.id}. Executarea ADB nu echivalează automat cu livrarea în rețea.`
    };
  }
}

export class ExternalSmsApiAdapter implements SmsProviderAdapter {
  readonly name = 'SMS_API' as const;

  inspectCapabilities(): { ready: boolean; canSendSms: boolean; detail: string } {
    const endpoint = process.env.SMS_API_URL?.trim();
    const token = process.env.SMS_API_TOKEN?.trim();
    if (!endpoint || !token) {
      return {
        ready: false,
        canSendSms: false,
        detail: 'Furnizorul SMS API extern nu este configurat (lipsesc SMS_API_URL / SMS_API_TOKEN).'
      };
    }
    return {
      ready: true,
      canSendSms: true,
      detail: `Furnizor SMS API configurat (${new URL(endpoint).hostname}).`
    };
  }

  async dispatch(
    _store: Store,
    _events: Events | undefined,
    _ctx: Context,
    message: OutboundMessageRecord
  ): Promise<{
    nextState: MessageState;
    deviceJobId?: string | null;
    providerMessageId?: string | null;
    detail: string;
  }> {
    const cap = this.inspectCapabilities();
    if (!cap.ready) {
      return {
        nextState: 'APROBAT',
        detail: cap.detail
      };
    }
    try {
      const response = await fetch(process.env.SMS_API_URL!.trim(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SMS_API_TOKEN!.trim()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.id
        },
        body: JSON.stringify({
          id: message.id,
          to: message.recipientPhone,
          text: message.body
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408) {
          return {
            nextState: 'INCERT',
            detail: `Furnizorul SMS a returnat o eroare ambiguă (${response.status}). Nu se retrimite automat.`
          };
        }
        return {
          nextState: 'ESUAT',
          detail: `Furnizorul SMS a respins cererea (${response.status}).`
        };
      }
      const data = (await response.json()) as any;
      return {
        nextState: data?.delivered === true ? 'LIVRAT' : 'EXPEDIAT',
        providerMessageId: String(data?.messageId || data?.id || message.id),
        detail: 'Mesaj acceptat de furnizorul SMS API.'
      };
    } catch {
      return {
        nextState: 'INCERT',
        detail: 'Conexiunea cu furnizorul SMS API a expirat sau s-a întrerupt; rezultatul este INCERT (fără retrimitere automată).'
      };
    }
  }
}

export class SimulatedMessagingAdapter implements SmsProviderAdapter {
  readonly name = 'SIMULATED' as const;

  inspectCapabilities(): { ready: boolean; canSendSms: boolean; detail: string } {
    return {
      ready: true,
      canSendSms: true,
      detail: 'Adaptor simulat de test (nu expediază SMS-uri către numere reale).'
    };
  }

  async dispatch(
    _store: Store,
    _events: Events | undefined,
    _ctx: Context,
    message: OutboundMessageRecord
  ): Promise<{
    nextState: MessageState;
    deviceJobId?: string | null;
    providerMessageId?: string | null;
    detail: string;
  }> {
    return {
      nextState: 'EXPEDIAT',
      providerMessageId: `sim-${message.id}`,
      detail: 'Mesaj înregistrat în adaptorul simulat de test (fără expediere în rețeaua mobilă).'
    };
  }
}

const adapters: Record<'WINDOWS_ADB' | 'SMS_API' | 'SIMULATED', SmsProviderAdapter> = {
  WINDOWS_ADB: new WindowsAdbMessagingAdapter(),
  SMS_API: new ExternalSmsApiAdapter(),
  SIMULATED: new SimulatedMessagingAdapter()
};

export function getMessagingAdapter(name: 'WINDOWS_ADB' | 'SMS_API' | 'SIMULATED'): SmsProviderAdapter {
  return adapters[name] || adapters.WINDOWS_ADB;
}

/**
 * Prepares a personalized SMS invitation for a proposal.
 * Enforces:
 * - Plain text + public proposal link only (never claims screenshots can be attached to an SMS).
 * - Identifies Starlidigital, uses only confirmed business facts, includes clear opt-out path.
 * - Respects the persistent opt-out registry and authenticated operator authorization.
 * - Saves in state PREGATIT so the operator can inspect the exact message before approval.
 */
export function prepareProposalMessage(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    proposalId: string;
    adapter?: 'WINDOWS_ADB' | 'SMS_API' | 'SIMULATED';
    deviceId?: string | null;
    customBody?: string | null;
    idempotencyKey?: string | null;
  }
): { message: OutboundMessageRecord; deduplicated: boolean } {
  const { user } = requireOperator(ctx, 'MESSAGES');
  const proposal = store.get('proposals', input.proposalId) as ProposalRecord | undefined;
  if (!proposal) fail('Propunerea nu există.', 'NOT_FOUND');
  const lead = store.get('leads', proposal.leadId) as LeadRecord | undefined;
  if (!lead) fail('Leadul asociat propunerii nu există.', 'NOT_FOUND');

  const phone = normalizeRomanianPhone(lead.normalizedPhone);
  if (!phone) {
    fail('Leadul nu are un număr de telefon valid și confirmat pentru SMS.');
  }

  // Check persistent opt-out registry first
  if (isContactOptedOut(store, phone, lead.email) || lead.consentStatus === 'OPTED_OUT') {
    fail(
      'Destinatarul s-a dezabonat de la comunicări (opt-out activ). Trimiterea de mesaje comerciale este blocată.',
      'FORBIDDEN'
    );
  }


  const origin = (process.env.PUBLIC_APP_URL || 'https://starlidigital.ro').replace(/\/$/, '');
  const proposalUrl = `${origin}/propunere/${proposal.publicSlug}`;
  const optOutInfo = 'Pentru oprirea comunicărilor, accesează linkul și apasă „Nu mai doresc mesaje”.';
  const defaultBody = `Salut! Sunt Alex de la Starlidigital. Am pregătit o demonstrație gratuită de website pentru ${lead.businessName} (${lead.locality}): ${proposalUrl} . ${optOutInfo}`;
  const requestedBody = input.customBody ? bounded(input.customBody, 480, 20) : defaultBody;
  if (/ata[sș]at|attachment|screenshot\s+ata[sș]at/i.test(requestedBody)) {
    fail('Un SMS standard conține doar text și link; nu afirma că are o captură de ecran atașată.');
  }
  if (!requestedBody.toLowerCase().includes('starlidigital')) fail('Mesajul trebuie să identifice clar Starlidigital.');
  if (!requestedBody.includes(proposalUrl)) fail('Mesajul trebuie să includă linkul public al propunerii (care conține și opțiunea de dezabonare).');
  const adapterName = input.adapter || 'WINDOWS_ADB';
  const requestFingerprint = createHash('sha256').update(JSON.stringify({proposalId:proposal.id,phone,body:requestedBody,adapter:adapterName,deviceId:input.deviceId||null})).digest('hex');
  const legacyFingerprint = createHash('sha256').update(JSON.stringify({proposalId:proposal.id,phone,body:requestedBody,adapter:adapterName})).digest('hex');
  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).trim().slice(0,140) : `msg:${proposal.id}:${requestFingerprint.slice(0,24)}`;
  const nested = store.db.isTransaction;
  const savepoint = 'prepare_sms_'+randomBytes(6).toString('hex');
  store.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
  try {
    const messages = store.list('outbound-messages') as OutboundMessageRecord[];
    const existing = messages.find(m=>m.idempotencyKey===idempotencyKey);
    let result: {message:OutboundMessageRecord;deduplicated:boolean};
    if(existing){
      if(existing.requestFingerprint!==requestFingerprint && existing.fingerprint!==legacyFingerprint) fail('Cheia de idempotență a mesajului a fost deja folosită pentru alt conținut.');
      result={message:existing,deduplicated:true};
    }else{
      const current = store.get('proposals',proposal.id) as ProposalRecord;
      if(current.status==='REVENDICAT'||current.claimedByUserId) fail('Propunerea a fost deja revendicată.');
      // Never invalidate a code already included in an approved or dispatched invitation.
      // A second draft also needs explicit operator handling rather than silently replacing its code.
      if(messages.some(m=>m.proposalId===proposal.id)||store.list('operator-email-invitations').some(m=>m.proposalId===proposal.id)) fail('Există deja o invitație pentru această propunere. Folosește mesajul existent; codul nu a fost schimbat.');
      const cap=getMessagingAdapter(adapterName).inspectCapabilities(store,input.deviceId);
      const issued=rotateOrRevokeClaimCode(store,undefined,ctx,proposal.id);
      const body=`${requestedBody} Codul tău de revendicare: ${issued.claimCode}. Introdu-l pe pagina propunerii; nu este necesar un al doilea SMS.`;
      const fingerprint=createHash('sha256').update(JSON.stringify({proposalId:proposal.id,phone,body,adapter:adapterName})).digest('hex');
      const record: OutboundMessageRecord={
        id:id(),ownerId:user.id,leadId:lead.id,proposalId:proposal.id,kind:'COMMERCIAL_PROPOSAL',
        adapter:adapterName,deviceId:input.deviceId||null,recipientPhone:phone,body,proposalUrl,optOutInfo,
        status:'PREGATIT',idempotencyKey,fingerprint,requestFingerprint,
        approvedBy:null,approvedAt:null,deviceJobId:null,providerMessageId:null,
        capabilityReport:cap.detail,error:null,createdAt:now(),updatedAt:now()
      };
      store.put('outbound-messages',record,user.id);
      recordOperatorAudit(store,user.id,'operator.message.prepared',`${record.id} -> ${phone}`);
      result={message:record,deduplicated:false};
    }
    store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');
    if(!result.deduplicated){events?.publish('proposals');events?.publish('outbound-messages');}
    return result;
  }catch(error){
    if(nested){try{store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}catch{}}
    else if(store.db.isTransaction)store.db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Operator explicitly approves a prepared message and dispatches it.
 * Never re-sends a message that is already TRIMIS_DISPOZITIV, EXPEDIAT, LIVRAT, or INCERT!
 */
export async function approveAndDispatchMessage(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  messageId: string,
  overrides:{adapter?:SmsProviderAdapter;clock?:()=>number}={}
): Promise<OutboundMessageRecord> {
  const { user } = requireOperator(ctx, 'MESSAGES');
  const clock=overrides.clock||Date.now;
  const nested=store.db.isTransaction,savepoint='dispatch_'+randomBytes(6).toString('hex');
  store.db.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
  const commit=()=>store.db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');
  let existing:OutboundMessageRecord,approved:OutboundMessageRecord,dispatchToken:string;
  try{
  const found = store.get('outbound-messages', messageId) as OutboundMessageRecord | undefined;
  if(!found)fail('Mesajul nu există.','NOT_FOUND');existing=found;
  if (!existing) fail('Mesajul nu există.', 'NOT_FOUND');

  if (existing.status === 'INCERT') {
    fail(
      'Acest mesaj are un rezultat INCERT dintr-o încercare anterioară. Retrimiterea automată este interzisă pentru a preveni mesajele duplicate.',
      'FORBIDDEN'
    );
  }
  if (['TRIMIS_DISPOZITIV', 'EXPEDIAT', 'LIVRAT'].includes(existing.status)) {
    commit();return existing;
  }
  if(existing.status==='EXPEDIERE'){
    if(Number(existing.dispatchLeaseUntil)>clock()){commit();return existing;}
    store.put('outbound-messages',{...existing,status:'INCERT',error:'Expedierea precedentă a fost întreruptă sau nu are rezultat confirmat. Nu se retrimite automat.',updatedAt:now()},existing.ownerId);commit();
    fail('Rezultatul expedierii precedente este INCERT. Verifică furnizorul înainte de orice retrimitere.','FORBIDDEN');
  }

  const lead = existing.leadId ? (store.get('leads', existing.leadId) as LeadRecord | undefined) : undefined;
  if (
    isContactOptedOut(store, existing.recipientPhone, lead?.email) ||
    (lead && lead.consentStatus === 'OPTED_OUT')
  ) {
    const blocked: OutboundMessageRecord = {
      ...existing,
      status: 'ESUAT',
      error: 'Expediere oprită: destinatarul s-a dezabonat (opt-out activ).',
      updatedAt: now()
    };
    store.put('outbound-messages', blocked, existing.ownerId);
    events?.publish('outbound-messages');
    commit();
    fail(blocked.error!, 'FORBIDDEN');
  }

  if (existing.kind === 'COMMERCIAL_PROPOSAL' && !lead) {
    fail(
      'Leadul asociat invitației nu mai există. Verifică destinatarul înainte de trimitere.',
      'FORBIDDEN'
    );
  }

  // A durable dispatch claim precedes the external call, including across gateway processes.
  dispatchToken=randomBytes(16).toString('hex');
  approved = {
    ...existing,
    status: 'EXPEDIERE',
    dispatchToken,
    dispatchStartedAt:now(),
    dispatchLeaseUntil:clock()+60000,
    approvedBy: user.id,
    approvedAt: existing.approvedAt || now(),
    updatedAt: now()
  };
  store.put('outbound-messages', approved, existing.ownerId);
  recordOperatorAudit(store, user.id, 'operator.message.approved', `${approved.id} (${approved.recipientPhone})`);
  commit();
  }catch(error){if(nested){try{store.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);store.db.exec(`RELEASE SAVEPOINT ${savepoint}`);}catch{}}else if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}

  const adapter = overrides.adapter||getMessagingAdapter(approved.adapter);
  let outcome:Awaited<ReturnType<SmsProviderAdapter['dispatch']>>;
  try{outcome = await adapter.dispatch(store, events, ctx, approved);}
  catch(error){const detail='Adaptorul SMS nu a confirmat rezultatul: '+redactSecrets(error instanceof Error?error.message:'eroare necunoscută').slice(0,300);const current=store.get('outbound-messages',messageId) as OutboundMessageRecord;if(current?.dispatchToken===dispatchToken&&!['EXPEDIAT','LIVRAT'].includes(current.status))store.put('outbound-messages',{...current,status:'INCERT',error:detail,capabilityReport:detail,dispatchLeaseUntil:0,updatedAt:now()},existing.ownerId);events?.publish('outbound-messages');throw Object.assign(new Error(detail),{unknownOutcome:true,sideEffectStarted:true});}
  const current=store.get('outbound-messages',messageId) as OutboundMessageRecord;
  if(current?.dispatchToken!==dispatchToken)fail('Rezultatul expedierii trebuie reconciliat cu operațiunea curentă.','CONFLICT');
  if(['EXPEDIAT','LIVRAT'].includes(current.status)){events?.publish('outbound-messages');return current;}

  const updated: OutboundMessageRecord = {
    ...current,
    status: outcome.nextState,
    deviceJobId: outcome.deviceJobId ?? approved.deviceJobId,
    providerMessageId: outcome.providerMessageId ?? approved.providerMessageId,
    capabilityReport: outcome.detail,
    error: outcome.nextState === 'ESUAT' || outcome.nextState === 'INCERT' ? outcome.detail : null,
    dispatchLeaseUntil:0,
    updatedAt: now()
  };
  store.put('outbound-messages', updated, existing.ownerId);

  if (
    updated.proposalId &&
    ['TRIMIS_DISPOZITIV', 'EXPEDIAT', 'LIVRAT'].includes(updated.status)
  ) {
    const prop = store.get('proposals', updated.proposalId) as ProposalRecord | undefined;
    if (prop && prop.status === 'PREGATIT') {
      store.put('proposals', { ...prop, status: 'INVITATIE_TRIMISA', updatedAt: now() }, prop.ownerId);
      events?.publish('proposals');
    }
  }

  events?.publish('outbound-messages');
  return updated;
}

export function recoverInterruptedSmsDispatches(store:Store):number{
 let count=0;for(const message of store.list('outbound-messages'))if(message.status==='EXPEDIERE'){store.put('outbound-messages',{...message,status:'INCERT',dispatchLeaseUntil:0,error:'Gateway-ul s-a repornit în timpul expedierii. Verifică rezultatul; mesajul nu va fi retrimis automat.',updatedAt:now()},message.ownerId);count++;}return count;
}

/**
 * Reconciles the state of an ADB SMS message from the Windows device's report.
 * Crucial safety rule:
 * - Executing an ADB command is at most `EXPEDIAT` (dispatched to phone radio), NEVER `LIVRAT` unless explicit delivery receipt proof is provided.
 * - An ambiguous ADB output or timeout transitions the message to `INCERT` and NEVER auto-retries!
 */
export function recordAdbSmsOutcome(
  store: Store,
  events: Events | undefined,
  input: {
    messageId: string;
    outcome: 'RADIO_ACCEPTED' | 'DELIVERY_CONFIRMED' | 'FAILED_BEFORE_SEND' | 'AMBIGUOUS';
    detail: string;
  }
): OutboundMessageRecord {
  const existing = store.get('outbound-messages', input.messageId) as OutboundMessageRecord | undefined;
  if (!existing) fail('Mesajul nu există.', 'NOT_FOUND');
  // Delayed/replayed device reports cannot erase stronger evidence of dispatch or delivery.
  if(existing.status==='LIVRAT'||(existing.status==='EXPEDIAT'&&['FAILED_BEFORE_SEND','AMBIGUOUS'].includes(input.outcome)))return existing;

  let nextState: MessageState = existing.status;
  if (input.outcome === 'DELIVERY_CONFIRMED') {
    nextState = 'LIVRAT';
  } else if (input.outcome === 'RADIO_ACCEPTED') {
    // ADB execution alone is EXPEDIAT, never LIVRAT without delivery confirmation!
    nextState = 'EXPEDIAT';
  } else if (input.outcome === 'FAILED_BEFORE_SEND') {
    nextState = 'ESUAT';
  } else {
    // AMBIGUOUS -> INCERT, never retried automatically
    nextState = 'INCERT';
  }

  const safeDetail = redactSecrets(input.detail).slice(0, 500);
  const updated: OutboundMessageRecord = {
    ...existing,
    status: nextState,
    capabilityReport: safeDetail,
    error: nextState === 'ESUAT' || nextState === 'INCERT' ? safeDetail : null,
    updatedAt: now()
  };
  store.put('outbound-messages', updated, existing.ownerId);

  if (nextState === 'INCERT' && existing.proposalId) {
    const prop = store.get('proposals', existing.proposalId) as ProposalRecord | undefined;
    if (prop && prop.status === 'PREGATIT') {
      store.put('proposals', { ...prop, status: 'INCERT', lastError: safeDetail, updatedAt: now() }, prop.ownerId);
      events?.publish('proposals');
    }
  }

  events?.publish('outbound-messages');
  return updated;
}
