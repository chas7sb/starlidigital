import { Store, id, now, type RecordData } from './store.js';
import {parseOperatorBusinessDetails} from './operator-project-context.js';
import {buildBespokeOperatorProposal} from './operator-bespoke.js';
import { Events } from './events.js';
import { fail, bounded, type Context } from './security.js';
import { response, settings as getAiSettings, aiConfigured } from './ai.js';
import {runAutonomousOperator} from './operator-agent.js';
import {executeAutonomousPlatformTool} from './operator-platform-tools.js';
import {updateOperatorConversation} from './operator-gateway.js';
import {platformWorkspace,platformContentHash,readPlatformSnapshot,writePlatformSnapshot} from './operator-platform-changes.js';
import {
  requireOperator,
  recordOperatorAudit,
  redactSecrets,
  type OperatorPermission
} from './operator-auth.js';
import {
  upsertLead,
  createOrUpdateProposalDemo,
  promoteOperatorProposal,
  getAgencyBudget,
  type LeadRecord,
  type ProposalRecord
} from './leads-proposals.js';
import { prepareProposalMessage, type OutboundMessageRecord } from './messaging.js';
import { createOperatorJob, completeOperatorJob, type OperatorJobRecord } from './operator-jobs.js';
import type { DeviceRecord } from './operator-devices.js';

export type PlatformChangeRecord = RecordData & {
  id: string;
  actorId: string;
  title: string;
  targetPath: string;
  originalContent: string;
  proposedContent: string;
  diffText: string;
  verificationPassed: boolean;
  verificationReport: string;
  status: 'STAGED_AWAITING_APPROVAL' | 'APPLYING' | 'APPLY_UNCERTAIN' | 'APPROVED_APPLIED' | 'ROLLING_BACK' | 'ROLLBACK_UNCERTAIN' | 'ROLLED_BACK' | 'REJECTED';
  approvedBy: string | null;
  approvedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperatorToolCallResult = {
  tool: string;
  ok: boolean;
  summary: string;
  data: Record<string, unknown>;
};

const PRIVILEGED_SINGLE_EXEC_TOOLS = new Set([
  'device.powershell',
  'approve_platform_change',
  'approve_message_send',
  'exec_root',
  'root_shell',
  'arbitrary_shell'
]);

const ALLOWED_OPERATOR_TOOLS: Record<string, { permission: OperatorPermission; allowFromModelTurn: boolean }> = {
  platform_operational_summary: { permission: 'READ', allowFromModelTurn: true },
  search_platform: { permission: 'READ', allowFromModelTurn: true },
  inspect_project: { permission: 'PROJECTS', allowFromModelTurn: true },
  inspect_client_conversation: { permission: 'CONVERSATIONS', allowFromModelTurn: true },
  create_lead_proposal: { permission: 'PROPOSALS', allowFromModelTurn: true },
  promote_proposal: { permission: 'PROPOSALS', allowFromModelTurn: true },
  prepare_proposal_sms: { permission: 'MESSAGES', allowFromModelTurn: true },
  explain_error_and_remediate: { permission: 'PROJECTS', allowFromModelTurn: true },
  stage_platform_change: { permission: 'PLATFORM_STAGE', allowFromModelTurn: false }
};

export function computeSimpleUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a) continue;
    if (b !== undefined) out.push(`- [L${i + 1}] ${b}`);
    if (a !== undefined) out.push(`+ [L${i + 1}] ${a}`);
  }
  if (out.length === 2) out.push(' (nicio diferență)');
  return out.join('\n').slice(0, 12000);
}

export function stagePlatformChange(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    title: string;
    targetPath: string;
    originalContent: string;
    proposedContent: string;
  }
): PlatformChangeRecord {
  const { user } = requireOperator(ctx, 'PLATFORM_STAGE');
  const title = bounded(input.title, 160, 3);
  const targetPath = bounded(input.targetPath, 240, 3);
  if (targetPath.includes('..') || targetPath.includes('\0') || /(?:^|[\\/])\.env/i.test(targetPath)) {
    fail('Calea propusă pentru modificare nu este permisă.', 'FORBIDDEN');
  }
  const originalContent = String(input.originalContent ?? '');
  const proposedContent = String(input.proposedContent ?? '');
  if(Buffer.byteLength(originalContent)>200000||Buffer.byteLength(proposedContent)>200000)fail('Modificările sunt limitate la 200 KB; conținutul nu a fost trunchiat.');
  if(redactSecrets(originalContent)!==originalContent||redactSecrets(proposedContent)!==proposedContent)fail('Fișierele care conțin credențiale nu pot fi incluse în modificări.','FORBIDDEN');
  const workspaceRoot=platformWorkspace(),snapshot=readPlatformSnapshot(workspaceRoot,targetPath);
  if(snapshot.content!==originalContent)fail('Conținutul original nu corespunde fișierului actual. Citește fișierul și pregătește un diff nou.','CONFLICT');
  const diffText = computeSimpleUnifiedDiff(targetPath, originalContent, proposedContent);

  // Static content checks only: no build, deployment or runtime activation is implied.
  const hasSecretLeak = /\b(?:sk-live-|whsec_|starli_op_)\S+/i.test(proposedContent);
  const verificationPassed = !hasSecretLeak && proposedContent.trim().length > 0;
  const verificationReport = verificationPassed
    ? 'Verificare statică: fișierul original corespunde, diff calculat, conținut fără credențiale detectate. Buildul și testele nu au fost executate; modificarea nu este aplicată.'
    : 'Verificare eșuată: conținut gol sau potențial secret detectat.';

  const record: PlatformChangeRecord = {
    id: id(),
    ownerId: user.id,
    actorId: user.id,
    title,
    targetPath,
    workspaceRoot,
    originalExisted:snapshot.exists,
    originalHash:snapshot.hash,
    originalMode:snapshot.mode,
    proposedHash:platformContentHash(proposedContent),
    originalContent: redactSecrets(originalContent),
    proposedContent: redactSecrets(proposedContent),
    diffText: redactSecrets(diffText),
    verificationPassed,
    verificationReport,
    status: 'STAGED_AWAITING_APPROVAL',
    approvedBy: null,
    approvedAt: null,
    rolledBackAt: null,
    createdAt: now(),
    updatedAt: now()
  };

  store.put('platform-changes', record, user.id);
  recordOperatorAudit(store, user.id, 'operator.platform_change.staged', `${record.id} (${targetPath})`);
  events?.publish('operator-jobs');
  return record;
}

export function approveStagedPlatformChange(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  changeId: string
): PlatformChangeRecord {
  const { user } = requireOperator(ctx, 'PLATFORM_APPROVE');
  const existing = store.get('platform-changes', changeId) as PlatformChangeRecord | undefined;
  if (!existing) fail('Modificarea pregătită nu există.', 'NOT_FOUND');
  if (existing.status !== 'STAGED_AWAITING_APPROVAL') {
    fail(`Modificarea nu poate fi aprobată din starea ${existing.status}.`);
  }
  if (!existing.verificationPassed) {
    fail('Modificarea nu a trecut verificările de siguranță și nu poate fi aprobată.');
  }
  const workspaceRoot=platformWorkspace();
  if(existing.workspaceRoot!==workspaceRoot||!existing.originalHash||!existing.proposedHash||typeof existing.originalExisted!=='boolean')fail('Modificarea nu are dovada fișierului original din acest workspace. Pregătește un diff nou.','CONFLICT');
  if(platformContentHash(existing.proposedContent)!==existing.proposedHash||platformContentHash(existing.originalContent)!==existing.originalHash)fail('Conținutul modificării nu corespunde dovezii salvate.','CONFLICT');
  const snapshot=readPlatformSnapshot(workspaceRoot,existing.targetPath);
  if(snapshot.exists!==existing.originalExisted||snapshot.hash!==existing.originalHash)fail('Fișierul s-a schimbat după pregătirea diff-ului. Modificarea nu a fost aplicată.','CONFLICT');
  // Commit a durable claim and preimage before touching the filesystem. A crash leaves
  // APPLYING, never a false success and never an automatically repeated operation.
  if(store.db.isTransaction)fail('Aplicarea pe disc necesită o operațiune dedicată.','CONFLICT');
  store.db.exec('BEGIN IMMEDIATE');
  try{const fresh=store.get('platform-changes',changeId);if(fresh?.status!=='STAGED_AWAITING_APPROVAL')fail('Modificarea este deja procesată.','CONFLICT');
   store.put('platform-change-backups',{id:changeId,ownerId:existing.actorId,workspaceRoot,targetPath:existing.targetPath,exists:snapshot.exists,content:snapshot.content,hash:snapshot.hash,mode:snapshot.mode,createdAt:now()},existing.actorId);
   store.put('platform-changes',{...existing,status:'APPLYING',approvedBy:user.id,approvedAt:now(),updatedAt:now()},existing.actorId);store.db.exec('COMMIT');
  }catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
  try{writePlatformSnapshot(workspaceRoot,existing.targetPath,{exists:snapshot.exists,hash:snapshot.hash},{exists:true,content:existing.proposedContent,mode:snapshot.mode});}
  catch(error){store.put('platform-changes',{...existing,status:'APPLY_UNCERTAIN',verificationReport:'Aplicarea nu a fost confirmată. Verifică fișierul înainte de orice repetare.',updatedAt:now()},existing.actorId);throw error;}
  const updated: PlatformChangeRecord = {
    ...existing,
    status: 'APPROVED_APPLIED',
    approvedBy: user.id,
    approvedAt: now(),
    appliedHash:existing.proposedHash,
    appliedAt:now(),
    verificationReport:'Conținutul aprobat a fost scris atomic pe disc și verificat prin SHA-256. Backupul original este salvat. Buildul, testele, restartul și publicarea nu au fost executate.',
    updatedAt: now()
  };
  store.put('platform-changes', updated, existing.actorId);
  recordOperatorAudit(store, user.id, 'operator.platform_change.approved', `${changeId} (${existing.targetPath})`);
  events?.publish('operator-jobs');
  return updated;
}

export function rollbackPlatformChange(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  changeId: string
): PlatformChangeRecord {
  const { user } = requireOperator(ctx, 'PLATFORM_APPROVE');
  const existing = store.get('platform-changes', changeId) as PlatformChangeRecord | undefined;
  if (!existing) fail('Modificarea nu există.', 'NOT_FOUND');
  if(existing.status!=='APPROVED_APPLIED')fail('Rollbackul este permis numai pentru o modificare aplicată și verificată.','CONFLICT');
  const workspaceRoot=platformWorkspace(),backup=store.get('platform-change-backups',changeId);
  if(!backup||existing.workspaceRoot!==workspaceRoot||backup.workspaceRoot!==workspaceRoot||backup.targetPath!==existing.targetPath||platformContentHash(backup.content)!==backup.hash||backup.hash!==existing.originalHash||existing.appliedHash!==existing.proposedHash)fail('Backupul verificat al modificării nu este disponibil.','CONFLICT');
  const current=readPlatformSnapshot(workspaceRoot,existing.targetPath);
  if(!current.exists||current.hash!==existing.appliedHash)fail('Fișierul a fost schimbat ulterior. Rollbackul nu va suprascrie aceste modificări.','CONFLICT');
  if(store.db.isTransaction)fail('Rollbackul pe disc necesită o operațiune dedicată.','CONFLICT');
  store.db.exec('BEGIN IMMEDIATE');
  try{if(store.get('platform-changes',changeId)?.status!=='APPROVED_APPLIED')fail('Modificarea este deja procesată.','CONFLICT');store.put('platform-changes',{...existing,status:'ROLLING_BACK',updatedAt:now()},existing.actorId);store.db.exec('COMMIT');}
  catch(error){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw error;}
  try{writePlatformSnapshot(workspaceRoot,existing.targetPath,{exists:true,hash:existing.appliedHash},{exists:backup.exists,content:backup.content,mode:backup.mode});}
  catch(error){store.put('platform-changes',{...existing,status:'ROLLBACK_UNCERTAIN',verificationReport:'Restaurarea pe disc nu a fost confirmată. Verifică fișierul înainte de orice repetare.',updatedAt:now()},existing.actorId);throw error;}
  const updated: PlatformChangeRecord = {
    ...existing,
    status: 'ROLLED_BACK',
    rolledBackAt: now(),
    verificationReport:'Fișierul original a fost restaurat pe disc și verificat. Pentru un fișier nou, absența sa a fost confirmată. Buildul, restartul și publicarea nu au fost executate.',
    updatedAt: now()
  };
  store.put('platform-changes', updated, existing.actorId);
  recordOperatorAudit(store, user.id, 'operator.platform_change.rolled_back', `${changeId} (${existing.targetPath})`);
  events?.publish('operator-jobs');
  return updated;
}

export function getPlatformOperationalSummary(store: Store, ctx: Context) {
  requireOperator(ctx, 'READ');
  const users = store.users();
  const projects = store.list('projects');
  const conversations = store.list('conversations');
  const leads = store.list('leads') as LeadRecord[];
  const proposals = store.list('proposals') as ProposalRecord[];
  const devices = store.list('operator-devices') as DeviceRecord[];
  const jobs = store.list('operator-jobs') as OperatorJobRecord[];
  const messages = store.list('outbound-messages') as OutboundMessageRecord[];
  const budget = getAgencyBudget(store);

  const proposalsByState: Record<string, number> = {};
  for (const p of proposals) {
    proposalsByState[p.status] = (proposalsByState[p.status] || 0) + 1;
  }

  return {
    usersCount: users.length,
    projectsCount: projects.length,
    activeBuildsCount: projects.filter(p => ['BUILDING', 'VERIFYING'].includes(p.status)).length,
    failedProjectsCount: projects.filter(p => ['FAILED', 'BUILD_FAILED'].includes(p.status)).length,
    conversationsCount: conversations.length,
    leadsCount: leads.length,
    proposalsCount: proposals.length,
    proposalsByStateJson: JSON.stringify(proposalsByState),
    devicesOnlineCount: devices.filter(d => d.status === 'ONLINE').length,
    devicesTotalCount: devices.length,
    adbConnectedCount: devices.filter(d => d.status === 'ONLINE' && d.adbStatus === 'CONNECTED').length,
    runningJobsCount: jobs.filter(j => j.status === 'RUNNING' || j.status === 'QUEUED_DEVICE').length,
    awaitingApprovalJobsCount: jobs.filter(j => j.status === 'AWAITING_APPROVAL').length,
    messagesCount: messages.length,
    agencyBudget: budget,
    generatedAt: now()
  };
}

/**
 * Executes a typed operator tool with independent backend validation of role, token scopes,
 * arguments, budgets, and untrusted-input privilege escalation protection.
 */
export function executeOperatorTool(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    tool: string;
    args: Record<string, unknown>;
    invokedByModel?: boolean;
  }
): OperatorToolCallResult {
  const toolName = String(input.tool || '').trim();

  if (PRIVILEGED_SINGLE_EXEC_TOOLS.has(toolName)) {
    recordOperatorAudit(store, ctx.user?.id || 'unknown', 'operator.security.blocked_privileged_tool', toolName);
    fail(`Instrumentul privilegiat „${toolName}” nu poate fi executat direct prin apel generic de instrument; necesită aprobare punctuală dedicată.`, 'FORBIDDEN');
  }

  const spec = ALLOWED_OPERATOR_TOOLS[toolName];
  if (!spec) {
    recordOperatorAudit(store, ctx.user?.id || 'unknown', 'operator.security.unknown_tool', toolName);
    fail(`Instrumentul „${toolName}” nu este permis în Starli Operator.`, 'FORBIDDEN');
  }

  if (input.invokedByModel && !spec.allowFromModelTurn) {
    recordOperatorAudit(store, ctx.user?.id || 'unknown', 'operator.security.blocked_model_escalation', toolName);
    fail(`Instrumentul „${toolName}” nu poate fi declanșat automat de model din date externe.`, 'FORBIDDEN');
  }

  const { user } = requireOperator(ctx, spec.permission);
  const args = input.args && typeof input.args === 'object' ? input.args : {};

  if (toolName === 'platform_operational_summary') {
    const summary = getPlatformOperationalSummary(store, ctx);
    return {
      tool: toolName,
      ok: true,
      summary: `Platformă: ${summary.usersCount} utilizatori, ${summary.projectsCount} proiecte (${summary.failedProjectsCount} cu erori), ${summary.leadsCount} leaduri, ${summary.proposalsCount} propuneri, ${summary.devicesOnlineCount}/${summary.devicesTotalCount} dispozitive online, buget azi ${summary.agencyBudget.spentTodayUnits}/${summary.agencyBudget.dailyMaxUnits} unități.`,
      data: summary as unknown as Record<string, unknown>
    };
  }

  if (toolName === 'search_platform') {
    const q = String(args.query || '').trim().toLowerCase().slice(0, 120);
    const scope = String(args.scope || 'all').toLowerCase();
    const results: Record<string, unknown[]> = {};

    if (scope === 'all' || scope === 'users') {
      results.users = store
        .users()
        .filter(u => !q || String(u.username || '').toLowerCase().includes(q) || String(u.recoveryEmail || '').toLowerCase().includes(q))
        .slice(0, 15)
        .map(u => ({ id: u.id, username: u.username, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt }));
    }
    if (scope === 'all' || scope === 'projects') {
      results.projects = store
        .list('projects')
        .filter(p => !q || String(p.name || '').toLowerCase().includes(q) || String(p.brief || '').toLowerCase().includes(q))
        .slice(0, 15)
        .map(p => ({ id: p.id, name: p.name, status: p.status, ownerId: p.ownerId, validationStatus: p.validationStatus, buildError: p.buildError || null, updatedAt: p.updatedAt }));
    }
    if (scope === 'all' || scope === 'leads') {
      results.leads = (store.list('leads') as LeadRecord[])
        .filter(l => !q || l.businessName.toLowerCase().includes(q) || l.locality.toLowerCase().includes(q) || (l.normalizedPhone || '').includes(q))
        .slice(0, 15)
        .map(l => ({ id: l.id, businessName: l.businessName, industry: l.industry, locality: l.locality, phone: l.normalizedPhone, consentStatus: l.consentStatus }));
    }
    if (scope === 'all' || scope === 'proposals') {
      results.proposals = (store.list('proposals') as ProposalRecord[])
        .filter(p => !q || p.businessName.toLowerCase().includes(q) || p.publicSlug.includes(q) || p.status.toLowerCase().includes(q))
        .slice(0, 15)
        .map(p => ({ id: p.id, publicSlug: p.publicSlug, businessName: p.businessName, locality: p.locality, status: p.status, viewedAt: p.viewedAt, claimedByUserId: p.claimedByUserId }));
    }
    return {
      tool: toolName,
      ok: true,
      summary: `Căutarea pentru „${q || '*'}” a returnat rezultate filtrate pe metadate.`,
      data: results
    };
  }

  if (toolName === 'inspect_project') {
    const projectId = String(args.projectId || '').trim();
    const project = store.get('projects', projectId);
    if (!project) fail('Proiectul nu a fost găsit.', 'NOT_FOUND');
    recordOperatorAudit(store, user.id, 'operator.project.inspected', projectId);
    return {
      tool: toolName,
      ok: true,
      summary: `Proiect „${project.name}” (${project.status}), ${Array.isArray(project.files) ? project.files.length : 0} fișiere, ${Array.isArray(project.versions) ? project.versions.length : 0} versiuni.`,
      data: {
        id: project.id,
        name: project.name,
        ownerId: project.ownerId,
        status: project.status,
        validationStatus: project.validationStatus,
        buildState:project.buildState||null,
        buildStep:project.buildStep||null,
        aiGenerated:project.operatorBespokeGenerated===true,
        aiBuildStatus:project.operatorBespokeStatus||null,
        lastAiBuildError:redactSecrets(String(store.list('proposals').filter(p=>p.projectId===project.id).map(p=>store.get('operator-project-context',p.id)?.lastBuildError||'').find(Boolean)||'')).slice(0,2500),
        proposals:store.list('proposals').filter(p=>p.projectId===project.id).map(p=>({id:p.id,mode:p.generationMode,status:p.status})),
        buildError: redactSecrets(String(project.buildError || '')),
        filesCount: Array.isArray(project.files) ? project.files.length : 0,
        filePaths: (Array.isArray(project.files) ? project.files : []).map((f: any) => f.path),
        versions: (Array.isArray(project.versions) ? project.versions : []).slice(0, 10).map((v: any) => ({
          id: v.id,
          summary: v.summary,
          createdBy: v.createdBy,
          createdAt: v.createdAt
        })),
        updatedAt: project.updatedAt
      }
    };
  }

  if (toolName === 'inspect_client_conversation') {
    const conversationId = String(args.conversationId || '').trim();
    const justification = String(args.justification || '').trim();
    if (justification.length < 10) {
      fail('Accesul la conversația unui client necesită o justificare operațională explicită (cel puțin 10 caractere).', 'BAD_USER_INPUT');
    }
    const conv = store.get('conversations', conversationId);
    if (!conv) fail('Conversația nu a fost găsită.', 'NOT_FOUND');

    recordOperatorAudit(store, user.id, 'operator.conversation.inspected', conversationId, {
      justification: justification.slice(0, 240)
    });

    const sanitizedMessages = (Array.isArray(conv.messages) ? conv.messages : [])
      .slice(-15)
      .map((m: any) => ({
        id: m.id,
        role: m.role,
        authorName: m.authorName,
        // Mark as untrusted client data & redact any secrets/tokens
        content: `[UNTRUSTED_CLIENT_MESSAGE] ${redactSecrets(String(m.content || '').slice(0, 1200))}`,
        createdAt: m.createdAt
      }));

    return {
      tool: toolName,
      ok: true,
      summary: `Conversația „${conv.title}” (${sanitizedMessages.length} mesaje recente) a fost inspectată și înregistrată în audit.`,
      data: {
        id: conv.id,
        title: conv.title,
        mode: conv.mode,
        projectId: conv.projectId || null,
        messages: sanitizedMessages
      }
    };
  }

  if (toolName === 'create_lead_proposal') {
    const businessName = String(args.businessName || '').trim();
    if (!businessName) fail('Numele afacerii este obligatoriu.');
    const created = createOrUpdateProposalDemo(store, events, ctx, {
      businessName,
      industry: args.industry ? String(args.industry) : undefined,
      locality: args.locality ? String(args.locality) : undefined,
      phone: args.phone ? String(args.phone) : null,
      email: args.email ? String(args.email) : null,
      existingWebsite: args.existingWebsite ? String(args.existingWebsite) : null,
      includeWhatsapp: args.includeWhatsapp !== false,
      customBrief: args.customBrief ? String(args.customBrief) : undefined,
      consentStatus: (args.consentStatus as any) || undefined,
      consentProvenance: args.consentProvenance ? String(args.consentProvenance) : undefined,
      mode: (args.mode as any) || 'snapshot'
    });
    return {
      tool: toolName,
      ok: true,
      summary: `Proposal / Propunerea (${created.proposal.generationMode === 'bespoke' ? 'Opțiunea 1 · Bespoke' : 'Opțiunea 2 · Propunere rapidă'}) for "${created.lead.businessName}" (${created.lead.locality}) is ready at /proposal/${created.proposal.publicSlug} .`,
      data: {
        leadId: created.lead.id,
        proposalId: created.proposal.id,
        projectId: created.project.id,
        publicSlug: created.proposal.publicSlug,
        status: created.proposal.status,
        generationMode: created.proposal.generationMode,
        claimCode: created.claimCode,
        deduplicated: created.deduplicated
      }
    };
  }

  if (toolName === 'promote_proposal') {
    const proposalId = String(args.proposalId || '').trim();
    const targetMode = (args.targetMode as any) || 'bespoke';
    const promoted = promoteOperatorProposal(store, events, ctx, proposalId, targetMode);
    return {
      tool: toolName,
      ok: true,
      summary: `Propunerea ${promoted.id} (${promoted.businessName}) a fost promovată la opțiunea 1 (Bespoke / Website personalizat). Sursa Next.js a fost generată și verificată.`,
      data: {
        proposalId: promoted.id,
        businessName: promoted.businessName,
        generationMode: promoted.generationMode,
        publicSlug: promoted.publicSlug,
        costAiUnits: promoted.costAiUnits
      }
    };
  }

  if (toolName === 'prepare_proposal_sms') {
    const proposalId = String(args.proposalId || '').trim();
    const prep = prepareProposalMessage(store, events, ctx, {
      proposalId,
      adapter: (args.adapter as any) || 'WINDOWS_ADB',
      deviceId: args.deviceId ? String(args.deviceId) : null,
      customBody: args.customBody ? String(args.customBody) : null
    });
    return {
      tool: toolName,
      ok: true,
      summary: `Mesajul SMS pentru propunerea ${proposalId} a fost pregătit în starea ${prep.message.status}. Așteaptă aprobarea explicită a operatorului înainte de expediere.`,
      data: {
        messageId: prep.message.id,
        status: prep.message.status,
        recipientPhone: prep.message.recipientPhone,
        body: prep.message.body,
        capabilityReport: prep.message.capabilityReport
      }
    };
  }

  if (toolName === 'explain_error_and_remediate') {
    const projectId = String(args.projectId || '').trim();
    const project = store.get('projects', projectId);
    if (!project) fail('Proiectul nu există.', 'NOT_FOUND');
    const rawErr = redactSecrets(String(project.buildError || project.buildLog || 'Nicio eroare înregistrată.'));
    const diagnosis = project.buildError
      ? `Proiectul „${project.name}” este în starea ${project.status} cu eroarea: „${rawErr.slice(0, 300)}”. Remediere recomandată: verifică sintaxa TSX în app/page.tsx, asigură-te că importurile sunt doar react / next/link / componente locale și reia verificarea prin verifyProject sau buildProject.`
      : `Proiectul „${project.name}” nu are erori active (stare: ${project.status}, validare: ${project.validationStatus}).`;
    return {
      tool: toolName,
      ok: true,
      summary: diagnosis,
      data: {
        projectId: project.id,
        status: project.status,
        buildError: rawErr.slice(0, 1000),
        remediation: diagnosis
      }
    };
  }

  if (toolName === 'stage_platform_change') {
    const staged = stagePlatformChange(store, events, ctx, {
      title: String(args.title || 'Modificare platformă'),
      targetPath: String(args.targetPath || ''),
      originalContent: String(args.originalContent || ''),
      proposedContent: String(args.proposedContent || '')
    });
    return {
      tool: toolName,
      ok: true,
      summary: `Modificarea „${staged.title}” a fost pregătită în workspace-ul izolat (${staged.status}). Aprobarea operatorului este necesară înainte de aplicare.`,
      data: {
        changeId: staged.id,
        status: staged.status,
        diffText: staged.diffText,
        verificationPassed: staged.verificationPassed
      }
    };
  }

  fail('Instrument neimplementat.');
}

/**
 * Natural Romanian operator conversation handler for the `starli` CLI and Operator console.
 * Parses Romanian intent (e.g., „Pregătește o propunere pentru Cafeneaua X din Brașov...”, „status”, „caută...”),
 * executes authorized typed tools, records progressive tool steps, and persists the conversation for seamless reconnection.
 */
export async function runOperatorTurn(
  store: Store,
  events: Events | undefined,
  ctx: Context,
  input: {
    conversationId?: string | null;
    prompt: string;
  },
  options:{bespokeBuilder?:typeof buildBespokeOperatorProposal;autonomous?:boolean;signal?:AbortSignal}={}
): Promise<{
  conversation: RecordData;
  reply: RecordData;
  toolActivities: OperatorToolCallResult[];
  jobId: string;
}> {
  const { user } = requireOperator(ctx, 'READ');
  const promptText = bounded(input.prompt, 8000, 1);
  if(input.conversationId)requireOperator(ctx,'CONVERSATIONS');

  let conv: RecordData | undefined = input.conversationId
    ? store.get('operator-conversations', input.conversationId)
    : undefined;
  if(conv&&conv.ownerId!==user.id)fail('Conversația operatorului nu există sau nu îți aparține.','NOT_FOUND');
  if (!conv) {
    conv = {
      id: input.conversationId || id(),
      ownerId: user.id,
      title: promptText.slice(0, 72),
      status: 'OPEN',
      agentStatus: 'Gândește…',
      messages: [],
      toolHistory: [],
      createdAt: now(),
      updatedAt: now()
    };
  }

  if(!store.get('operator-conversations',conv.id))store.put('operator-conversations',conv,user.id);
  const writerTaskId=conv.activeWriterTaskId as string|undefined;
  const saveConversation=()=>Object.assign(conv!,updateOperatorConversation(store,conv!.id,writerTaskId,conv!));
  const userMsg = {
    id: id(),
    role: 'user',
    authorName: user.username,
    content: promptText,
    createdAt: now()
  };
  conv.messages = [...(conv.messages || []), userMsg];
  conv.agentStatus = 'Analizez cererea și pregătesc instrumentele…';
  conv.updatedAt = now();
  saveConversation();
  events?.publish('operator-conversation:' + conv.id);

  const { job } = createOperatorJob(store, events, {
    actorId: user.id,
    kind: 'operator.cli.turn',
    targetType: 'operator-conversation',
    targetId: conv.id,
    args: { promptExcerpt: promptText.slice(0, 200) }
  });

  const toolActivities: OperatorToolCallResult[] = [];
  const lower = promptText.toLowerCase();
  const bespokeBuilder=options.bespokeBuilder||buildBespokeOperatorProposal;
  let autonomousReply:string|undefined;
  let autonomousBlocked=false;

  try {
    options.signal?.throwIfAborted();
    // 1. Check for Proposal Creation or Promotion from Snapshot (Option 2) -> Bespoke (Option 1)
    const proposalMatch =
      /(?:preg[ăa]te[șs]te|creeaz[ăa]|construie[șs]te|f[ăa]|am\s+(?:g[ăa]sit|un\s+client))\s+(?:o\s+)?(?:propunere|demonstra[țt]ie|demo|pentru\s+)?([^.,\n]+?)(?:\s+din\s+([A-Za-zĂÂÎȘȚăâîșț -]+?))?(?:[.,\n]|$)/i.exec(
        promptText
      );
    const isExplicitOption1 = /op[țt]iunea\s+1|f[ăa]-i\s+full|varianta\s+complet[ăa]|este\s+important,\s+f[ăa]\s+custom|bespoke|custom\s+build/i.test(promptText);
    const isPromotion = /(?:transform[ăa]|promoveaz[ăa]|f[ăa]-i\s+op[țt]iunea\s+1|treci).*(?:op[țt]iunea\s+1|bespoke|custom|complet)/i.test(promptText) ||
      (/foarte\s+important.*(?:op[țt]iunea\s+1|f[ăa]-i|bespoke)/i.test(promptText) && (!proposalMatch || !proposalMatch[1].trim().length));

    const aiConfig=getAiSettings(store);
    if(options.autonomous!==false&&aiConfigured(aiConfig.aiProvider)){
      const result=await runAutonomousOperator({store,events,ctx,conversation:conv,prompt:promptText,signal:options.signal,executeTool:(tool,args,metadata)=>executeAutonomousPlatformTool({store,events,ctx,tool,args,prompt:promptText,conversationId:conv!.id,metadata},(name,parameters)=>executeOperatorTool(store,events,ctx,{tool:name,args:parameters,invokedByModel:true}))});
      toolActivities.push(...result.toolActivities);autonomousReply=result.reply;
      autonomousBlocked=result.status==='BLOCKED';
    } else if (isPromotion) {
      const allProposals = (store.list('proposals') as ProposalRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const explicitId=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(promptText)?.[0];
      const contextualId=[...(conv.toolHistory||[])].reverse().find((tool:any)=>tool.data?.proposalId)?.data.proposalId;
      const targetProposal=allProposals.find(p=>p.id===(explicitId||contextualId));
      if (targetProposal) {
        conv.agentStatus = `Promovez propunerea pentru ${targetProposal.businessName} la Opțiunea 1 (Bespoke Next.js)…`;
        saveConversation();
        events?.publish('operator-conversation:' + conv.id);

        const res = executeOperatorTool(store, events, ctx, {
          tool: 'promote_proposal',
          args: { proposalId: targetProposal.id, targetMode: 'bespoke' },
          invokedByModel: true
        });
        await bespokeBuilder(store,events,ctx,targetProposal.id,promptText);
        toolActivities.push(res);
      } else {
        fail('Nu există nicio propunere anterioară care să poată fi promovată.');
      }
    } else if (proposalMatch) {
      const details=parseOperatorBusinessDetails(promptText,{businessName:proposalMatch[1],locality:proposalMatch[2]});
      const businessName=details.businessName;
      if(!businessName)fail('Spune-mi numele afacerii, de exemplu: Nume: Pizeria Viva.','BAD_USER_INPUT');
      const locality = details.locality || 'România';
      const phoneMatch = /(?:\+40|07)\d{8,9}/.exec(promptText.replace(/\s+/g, ''));
      const emailMatch = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(promptText);
      const wantsWhatsapp = /whatsapp/i.test(promptText);
      const industry = details.industry || (/cafenea|coffee|bistro/i.test(promptText)
        ? 'Cafenea & HoReCa'
        : /clinic[ăa]|cabinet|stomatolog/i.test(promptText)
        ? 'Clinică & Sănătate'
        : /salon|frizerie|beauty/i.test(promptText)
        ? 'Beauty & Îngrijire'
        : /piz[ez]er|restaurant/i.test(promptText)
        ? 'Pizzerie & Restaurant'
        : /service|detailing|auto/i.test(promptText)
        ? 'Auto Service & Detailing'
        : 'Afaceri locale');

      const mode: 'snapshot' | 'bespoke' = isExplicitOption1 ? 'bespoke' : 'snapshot';
      conv.agentStatus = mode === 'bespoke'
        ? `Construiesc versiunea personalizată Next.js (Opțiunea 1) pentru ${businessName}…`
        : `Generez propunerea rapidă din șablon dedicat (Opțiunea 2) pentru ${businessName}…`;
      saveConversation();
      events?.publish('operator-conversation:' + conv.id);

      const res = executeOperatorTool(store, events, ctx, {
        tool: 'create_lead_proposal',
        args: {
          businessName,
          locality,
          industry,
          phone: phoneMatch ? phoneMatch[0] : null,
          email: emailMatch ? emailMatch[0] : null,
          includeWhatsapp: wantsWhatsapp,
          customBrief: promptText,
          mode
        },
        invokedByModel: true
      });
      if(mode==='bespoke')await bespokeBuilder(store,events,ctx,String(res.data.proposalId),promptText);
      toolActivities.push(res);
    } else if (/rezumat|status|stare|ansamblu|overview|platform[ăa]/i.test(lower)) {
      const res = executeOperatorTool(store, events, ctx, {
        tool: 'platform_operational_summary',
        args: {},
        invokedByModel: true
      });
      toolActivities.push(res);
    } else if (/caut[ăa]|g[ăa]se[șs]te|lead|proiect/i.test(lower)) {
      const cleanedQuery = promptText
        .replace(/^(?:caut[ăa]|g[ăa]se[șs]te|arat[ăa]-mi)\s+/i, '')
        .trim();
      const res = executeOperatorTool(store, events, ctx, {
        tool: 'search_platform',
        args: { query: cleanedQuery, scope: 'all' },
        invokedByModel: true
      });
      toolActivities.push(res);
    }

    let replyContent = '';
    if(autonomousReply!==undefined){
      const invitations=toolActivities.filter(t=>t.ok&&t.data?.publicSlug).map(t=>`Proposal: https://starlidigital.ro/proposal/${encodeURIComponent(String(t.data.publicSlug))}${/^\d{5}$/.test(String(t.data.claimCode||''))?'\nClaim code: '+t.data.claimCode:''}`);
      replyContent=[autonomousReply,...invitations].join('\n\n');
    } else if (toolActivities.length > 0) {
      const summaryLines = toolActivities.map(
        t => `• **[${t.tool}]**: ${t.summary}`
      );

      replyContent = [
        'Am executat operațiunile solicitate în Starli Operator:',
        '',
        ...summaryLines,
        '',
        toolActivities[0]?.data?.publicSlug
          ? `Public proposal link: \`/proposal/${toolActivities[0].data.publicSlug}\`\nSecret claim code (unique, keep it for client invitation): \`${toolActivities[0].data.claimCode}\``
          : 'Poți inspecta detaliile complete prin comenzile `starli proposals`, `starli leads`, `starli devices` sau `starli jobs`.'
      ].join('\n');
    } else {
      try {
        const aiConfig = getAiSettings(store);
        const systemPrompt = `Ești Starli Operator, agentul AI de administrare și operare pentru platforma Starlidigital.
Răspunzi mereu în limba română, direct, concis, profesionist și prietenos.
Dacă operatorul te testează (de exemplu "răspunde cu test" sau "funcționezi?"), răspunde-i direct cu exact ce a cerut și confirmă-i că ești operațional.
Oferi asistență pentru propuneri de website-uri (Opțiunea 1 Bespoke / Opțiunea 2 Snapshot), leaduri, dispozitive Windows și administrarea platformei.`;

        const history = (conv.messages || []).slice(-8).map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }));

        replyContent = await response(history, systemPrompt, false, {
          provider: aiConfig.aiProvider,
          fallbackToOpenAI: aiConfig.aiFallbackEnabled
        });
      } catch {fail('Furnizorul AI nu a răspuns. Verifică integrarea din Administrare; operațiunea nu a fost executată.','INTEGRATION_UNAVAILABLE');}

    }

    options.signal?.throwIfAborted();
    const replyMsg = {
      id: id(),
      role: 'assistant',
      authorName: 'Starli Operator',
      content: replyContent,
      toolActivities,
      createdAt: now()
    };

    conv.messages = [...conv.messages, replyMsg];
    conv.toolHistory = [...(conv.toolHistory || []), ...toolActivities].slice(-50);
    conv.agentStatus = null;
    conv.updatedAt = now();
    saveConversation();

    completeOperatorJob(store, events, job.id, {
      status: autonomousBlocked?'FAILED':'SUCCEEDED',
      output: replyContent,
      exitCode: autonomousBlocked?1:0
    });

    events?.publish('operator-conversation:' + conv.id);
    return { conversation: conv, reply: replyMsg, toolActivities, jobId: job.id };
  } catch (err) {
    const errText = redactSecrets(err instanceof Error ? err.message : 'Eroare la execuția Starli Operator.');
    conv.agentStatus = null;
    conv.updatedAt = now();
    try{saveConversation();}catch{/* A superseded run must not overwrite the active session. */}
    completeOperatorJob(store, events, job.id, {
      status: 'FAILED',
      error: errText,
      exitCode: 1
    });
    events?.publish('operator-conversation:' + conv.id);
    throw err;
  }
}
