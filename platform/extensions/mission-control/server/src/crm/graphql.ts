import type { CrmServices } from './services.js';
import { requireAdmin, type Context } from '../security.js';

export const crmTypeDefs = `#graphql
  enum CrmQualificationStatus {
    UNQUALIFIED
    QUALIFYING
    QUALIFIED
    DISQUALIFIED
  }

  enum CrmOpportunityStatus {
    OPEN
    WON
    LOST
  }

  enum CrmTaskPriority {
    LOW
    MEDIUM
    HIGH
    URGENT
  }

  enum CrmTaskStatus {
    PENDING
    IN_PROGRESS
    COMPLETED
    CANCELLED
  }

  enum CrmActivityKind {
    NOTE
    CALL
    EMAIL
    EMAIL_INBOUND
    EMAIL_OUTBOUND
    EMAIL_TRANSACTIONAL
    MEETING
    STAGE_CHANGE
    TASK
    IMPORT
    SYSTEM
  }

  enum CrmVisibility {
    PUBLIC
    INTERNAL_ONLY
    REDACTED
  }

  type CrmPipelineStage {
    id: String!
    name: String!
    order: Int!
    probability: Int!
    isTerminalWon: Boolean
    isTerminalLost: Boolean
  }

  type CrmPipelineConfig {
    id: String!
    name: String!
    stages: [CrmPipelineStage!]!
    version: Int!
    updatedAt: String!
  }

  type CrmSavedView {
    id: String!
    name: String!
    target: String!
    filtersJson: String!
    sortField: String
    sortDirection: String
    ownerId: String!
    isShared: Boolean!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmCompany {
    id: String!
    name: String!
    domain: String
    industry: String
    locality: String
    country: String
    website: String
    phone: String
    email: String
    qualificationStatus: CrmQualificationStatus!
    ownerId: String!
    tags: [String!]!
    legacyLeadId: String
    proposalId: String
    projectId: String
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmContact {
    id: String!
    companyId: String!
    firstName: String!
    lastName: String!
    fullName: String!
    email: String
    phone: String
    roleTitle: String
    isPrimary: Boolean!
    ownerId: String!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmSignal {
    id: String!
    companyId: String!
    source: String!
    kind: String!
    title: String!
    summary: String!
    evidenceUrl: String
    confidenceScore: Float!
    verified: Boolean!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmOpportunity {
    id: String!
    companyId: String!
    primaryContactId: String
    title: String!
    amount: Float!
    currency: String!
    stageId: String!
    probability: Int!
    closeDate: String
    wonReason: String
    lostReason: String
    status: CrmOpportunityStatus!
    ownerId: String!
    projectId: String
    proposalId: String
    legacyLeadId: String
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmTask {
    id: String!
    companyId: String
    opportunityId: String
    contactId: String
    title: String!
    description: String
    dueDate: String
    priority: CrmTaskPriority!
    status: CrmTaskStatus!
    ownerId: String!
    completedAt: String
    version: Int!
    createdAt: String!
    updatedAt: String!
  }

  type CrmActivity {
    id: String!
    kind: CrmActivityKind!
    actorPrincipal: String!
    occurredAt: String!
    companyId: String
    contactId: String
    opportunityId: String
    projectId: String
    sourceEventId: String
    visibility: CrmVisibility!
    summary: String!
    details: String
    version: Int!
    createdAt: String!
  }

  type CrmCsvPreviewRow {
    rowIndex: Int!
    name: String!
    domain: String
    email: String
    phone: String
    industry: String
    locality: String
    contactName: String
    isDuplicate: Boolean!
    duplicateReason: String
    sanitized: Boolean!
  }

  type CrmCsvPreviewResult {
    totalRows: Int!
    validRows: Int!
    duplicateCount: Int!
    rows: [CrmCsvPreviewRow!]!
  }

  type CrmCsvImportResult {
    importedCount: Int!
    skippedCount: Int!
  }

  type CrmStageMetric {
    stageId: String!
    stageName: String!
    count: Int!
    valueByCurrencyJson: String!
    probabilityWeightedValueByCurrencyJson: String!
  }

  type CrmPipelineMetrics {
    totalOpenCount: Int!
    totalOpenValueByCurrencyJson: String!
    totalWonCount: Int!
    totalWonValueByCurrencyJson: String!
    totalLostCount: Int!
    stageBreakdown: [CrmStageMetric!]!
    wonReasonsBreakdownJson: String!
    lostReasonsBreakdownJson: String!
  }

  input CrmSavedViewInput {
    id: String
    name: String!
    target: String!
    filtersJson: String!
    sortField: String
    sortDirection: String
    isShared: Boolean
  }

  input CrmCompanyInput {
    id: String
    name: String!
    domain: String
    industry: String
    locality: String
    country: String
    website: String
    phone: String
    email: String
    qualificationStatus: CrmQualificationStatus
    tags: [String!]
    legacyLeadId: String
    proposalId: String
    projectId: String
  }

  input CrmContactInput {
    id: String
    companyId: String!
    firstName: String!
    lastName: String!
    email: String
    phone: String
    roleTitle: String
    isPrimary: Boolean
  }

  input CrmSignalInput {
    companyId: String!
    source: String!
    kind: String!
    title: String!
    summary: String!
    evidenceUrl: String
    confidenceScore: Float
    verified: Boolean
  }

  input CrmOpportunityInput {
    id: String
    companyId: String!
    primaryContactId: String
    title: String!
    amount: Float!
    currency: String!
    stageId: String!
    probability: Int
    closeDate: String
    wonReason: String
    lostReason: String
    projectId: String
    proposalId: String
    legacyLeadId: String
  }

  input CrmTaskInput {
    id: String
    companyId: String
    opportunityId: String
    contactId: String
    title: String!
    description: String
    dueDate: String
    priority: CrmTaskPriority
    status: CrmTaskStatus
  }

  input CrmPipelineStageInput {
    id: String!
    name: String!
    order: Int!
    probability: Int!
    isTerminalWon: Boolean
    isTerminalLost: Boolean
  }

  type AgencyNextAction {
    id: String!
    kind: String!
    priority: Int!
    title: String!
    description: String!
    companyId: String!
    companyName: String!
    resourceId: String!
    targetView: String!
    occurredAt: String!
  }
  type AgencyOverview {
    generatedAt: String!
    companies: Int!
    unlinkedLeads: Int!
    awaitingReply: Int!
    claimedDemos: Int!
    readyDemos: Int!
    overdueTasks: Int!
    actionCount: Int!
    mailboxLastSyncedAt: String
    mailboxConfigured:Boolean!
    mailboxCatchingUp:Boolean!
    mailboxLastError:String
    actions: [AgencyNextAction!]!
  }
  type CrmLegacyChange { leadId: String!, companyId: String, name: String!, action: String! }
  type CrmLegacyReconciliation {
    dryRun: Boolean!
    totalLeads: Int!
    processed: Int!
    created: Int!
    updated: Int!
    unchanged: Int!
    conflicts: Int!
    nextCursor: String
    changes: [CrmLegacyChange!]!
  }
  extend type Query {
    crmAgencyOverview: AgencyOverview!
    crmPipeline: CrmPipelineConfig!
    crmCompanies(search: String, industry: String, qualificationStatus: String, tag: String): [CrmCompany!]!
    crmCompany(id: String!): CrmCompany
    crmDuplicateCandidates(name: String!, domain: String, email: String): [CrmCompany!]!
    crmContacts(companyId: String): [CrmContact!]!
    crmSignals(companyId: String): [CrmSignal!]!
    crmOpportunities(companyId: String, stageId: String, status: String): [CrmOpportunity!]!
    crmOpportunity(id: String!): CrmOpportunity
    crmTasks(companyId: String, opportunityId: String, status: String): [CrmTask!]!
    crmActivities(companyId: String, opportunityId: String): [CrmActivity!]!
    crmSavedViews(target: String): [CrmSavedView!]!
    crmPipelineMetrics: CrmPipelineMetrics!
    crmPreviewCsvImport(csvContent: String!): CrmCsvPreviewResult!
    crmExportCompaniesCsv: String!
  }

  extend type Mutation {
    crmConnectLegacyLeads(dryRun:Boolean = true, limit:Int = 100, after:String):CrmLegacyReconciliation!
    crmUpsertCompany(input: CrmCompanyInput!, expectedVersion: Int): CrmCompany!
    crmMergeCompanies(targetCompanyId: String!, sourceCompanyId: String!, expectedTargetVersion: Int!, expectedSourceVersion: Int!): CrmCompany!
    crmUpsertContact(input: CrmContactInput!, expectedVersion: Int): CrmContact!
    crmAddSignal(input: CrmSignalInput!): CrmSignal!
    crmVerifySignal(signalId: String!, verified: Boolean!, expectedVersion: Int): CrmSignal!
    crmUpsertOpportunity(input: CrmOpportunityInput!, expectedVersion: Int): CrmOpportunity!
    crmUpsertTask(input: CrmTaskInput!, expectedVersion: Int): CrmTask!
    crmAddActivityNote(companyId: String, opportunityId: String, summary: String!, details: String): CrmActivity!
    crmUpdatePipelineStages(stages: [CrmPipelineStageInput!]!, expectedVersion: Int!): CrmPipelineConfig!
    crmUpsertSavedView(input: CrmSavedViewInput!, expectedVersion: Int): CrmSavedView!
    crmDeleteSavedView(id: String!): Boolean!
    crmExecuteCsvImport(csvContent: String!, skipDuplicates: Boolean!): CrmCsvImportResult!
  }
`;

export function createCrmGraphQL(options: { services: CrmServices }) {
  const { services } = options;

  const getCaller = (context: Context) => {
    const user = requireAdmin(context);
    return {
      userId: user.id,
      role: user.role,
      principal: context.operatorTokenId ? `operator-token:${context.operatorTokenId}` : user.username || user.id
    };
  };

  const resolvers = {
    Query: {
      crmAgencyOverview: (_:unknown,__:unknown,context:Context)=>{requireAdmin(context);return services.agencyOverview();},
      crmPipeline: (_: any, __: any, context: Context) => {
        requireAdmin(context);
        return services.getPipeline();
      },
      crmCompanies: (_: any, args: any, context: Context) => {
        requireAdmin(context);
        return services.listCompanies(args);
      },
      crmCompany: (_: any, { id }: { id: string }, context: Context) => {
        requireAdmin(context);
        return services.getCompany(id) || null;
      },
      crmDuplicateCandidates: (_: any, { name, domain, email }: any, context: Context) => {
        requireAdmin(context);
        return services.findDuplicateCandidates(name, domain, email);
      },
      crmContacts: (_: any, { companyId }: { companyId?: string }, context: Context) => {
        requireAdmin(context);
        return services.listContacts(companyId);
      },
      crmSignals: (_: any, { companyId }: { companyId?: string }, context: Context) => {
        requireAdmin(context);
        return services.listSignals(companyId);
      },
      crmOpportunities: (_: any, args: any, context: Context) => {
        requireAdmin(context);
        return services.listOpportunities(args);
      },
      crmOpportunity: (_: any, { id }: { id: string }, context: Context) => {
        requireAdmin(context);
        return services.getOpportunity(id) || null;
      },
      crmTasks: (_: any, args: any, context: Context) => {
        requireAdmin(context);
        return services.listTasks(args);
      },
      crmActivities: (_: any, args: any, context: Context) => {
        requireAdmin(context);
        return services.listActivities(args);
      },
      crmSavedViews: (_: any, { target }: { target?: string }, context: Context) => {
        const caller = getCaller(context);
        return services.listSavedViews(caller, target);
      },
      crmPipelineMetrics: (_: any, __: any, context: Context) => {
        requireAdmin(context);
        const metrics = services.getPipelineMetrics();
        return {
          totalOpenCount: metrics.totalOpenCount,
          totalOpenValueByCurrencyJson: JSON.stringify(metrics.totalOpenValueByCurrency),
          totalWonCount: metrics.totalWonCount,
          totalWonValueByCurrencyJson: JSON.stringify(metrics.totalWonValueByCurrency),
          totalLostCount: metrics.totalLostCount,
          stageBreakdown: metrics.stageBreakdown.map(s => ({
            stageId: s.stageId,
            stageName: s.stageName,
            count: s.count,
            valueByCurrencyJson: JSON.stringify(s.valueByCurrency),
            probabilityWeightedValueByCurrencyJson: JSON.stringify(s.probabilityWeightedValueByCurrency)
          })),
          wonReasonsBreakdownJson: JSON.stringify(metrics.wonReasonsBreakdown),
          lostReasonsBreakdownJson: JSON.stringify(metrics.lostReasonsBreakdown)
        };
      },
      crmPreviewCsvImport: (_: any, { csvContent }: { csvContent: string }, context: Context) => {
        requireAdmin(context);
        return services.previewCsvImport(csvContent);
      },
      crmExportCompaniesCsv: (_: any, __: any, context: Context) => {
        requireAdmin(context);
        return services.exportCompaniesCsv();
      }
    },
    Mutation: {
      crmConnectLegacyLeads:(_:unknown,args:{dryRun?:boolean;limit?:number;after?:string},context:Context)=>{
        const caller=getCaller(context);
        if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>250))throw new Error('Limit must be between 1 and 250');
        return services.reconcileLegacyLeads(caller,args);
      },
      crmUpsertCompany: (_: any, { input, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.upsertCompany(caller, input, expectedVersion);
      },
      crmMergeCompanies: (_: any, { targetCompanyId, sourceCompanyId, expectedTargetVersion, expectedSourceVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.mergeCompanies(caller, targetCompanyId, sourceCompanyId, expectedTargetVersion, expectedSourceVersion);
      },
      crmUpsertContact: (_: any, { input, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.upsertContact(caller, input, expectedVersion);
      },
      crmAddSignal: (_: any, { input }: any, context: Context) => {
        const caller = getCaller(context);
        return services.addSignal(caller, input);
      },
      crmVerifySignal: (_: any, { signalId, verified, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.verifySignal(caller, signalId, verified, expectedVersion);
      },
      crmUpsertOpportunity: (_: any, { input, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.upsertOpportunity(caller, input, expectedVersion);
      },
      crmUpsertTask: (_: any, { input, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.upsertTask(caller, input, expectedVersion);
      },
      crmAddActivityNote: (_: any, { companyId, opportunityId, summary, details }: any, context: Context) => {
        const caller = getCaller(context);
        return services.logActivity({
          kind: 'NOTE',
          actorPrincipal: caller.principal,
          occurredAt: new Date().toISOString(),
          companyId,
          opportunityId,
          summary,
          details,
          visibility: 'INTERNAL_ONLY'
        });
      },
      crmUpdatePipelineStages: (_: any, { stages, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.updatePipelineStages(caller, stages, expectedVersion);
      },
      crmUpsertSavedView: (_: any, { input, expectedVersion }: any, context: Context) => {
        const caller = getCaller(context);
        return services.upsertSavedView(caller, input, expectedVersion);
      },
      crmDeleteSavedView: (_: any, { id }: { id: string }, context: Context) => {
        const caller = getCaller(context);
        return services.deleteSavedView(caller, id);
      },
      crmExecuteCsvImport: (_: any, { csvContent, skipDuplicates }: any, context: Context) => {
        const caller = getCaller(context);
        return services.executeCsvImport(caller, csvContent, { skipDuplicates });
      }
    }
  };

  return {
    typeDefs: crmTypeDefs,
    resolvers
  };
}
