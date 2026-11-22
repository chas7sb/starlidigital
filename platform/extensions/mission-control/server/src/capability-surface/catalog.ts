import type { UnifiedToolDefinition } from './types.js';

export const STARLI_UNIFIED_30_TOOLS: readonly UnifiedToolDefinition[] = [
  // ==========================================
  // 1. BUSINESS ENGINE & OPERATING SPINE (4)
  // ==========================================
  {
    id: 'starli.business.status',
    displayName: 'Business Health & Status',
    category: 'BUSINESS',
    description: 'Inspects holistic business health, active routines, blockers, and engine component statuses.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        includeBlockers: { type: 'boolean', description: 'Include active operational blockers' },
        includeComponentGraph: { type: 'boolean', description: 'Include high-level component graph health' }
      },
      additionalProperties: false
    },
    outputDescription: 'Returns holistic business health score (0-100), active routines, blockers, and recommendations.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.business.goals',
    displayName: 'Business Goals & KPIs',
    category: 'BUSINESS',
    description: 'Reads or tracks high-level business goals, target metrics, and progress milestones.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        quarter: { type: 'string', description: 'Target business quarter, e.g. Q4-2026', maxLength: 10 }
      },
      additionalProperties: false
    },
    outputDescription: 'List of active business objectives, target key results, and percentage completion.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.business.graph',
    displayName: 'Business Engine Graph',
    category: 'BUSINESS',
    description: 'Inspects connected business graph nodes (presence, runtime backends, agents, campaigns, pipelines).',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 40, maxPerHour: 600, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'integer', description: 'Graph traversal depth (1 to 3)', minimum: 1, maximum: 3 }
      },
      additionalProperties: false
    },
    outputDescription: 'Normalized topological graph of business nodes, edge relationships, and synchronization health.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.business.briefing',
    displayName: 'Starli Executive Briefing',
    category: 'BUSINESS',
    description: 'Generates or retrieves the 60-second executive morning debrief (overnight achievements, pending decisions, today focus).',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 30, maxPerHour: 300, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Briefing date (YYYY-MM-DD)', maxLength: 10 }
      },
      additionalProperties: false
    },
    outputDescription: 'Structured briefing containing overnight metrics, autonomous actions taken, pending approvals, and high-priority opportunities.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },

  // ==========================================
  // 2. BUILD, EVOLUTION & ARTIFACTS (5)
  // ==========================================
  {
    id: 'starli.build.plan',
    displayName: 'Synthesize Change Plan',
    category: 'BUILD',
    description: 'Synthesizes an orchestrated multi-artifact business change plan from an intent outcome description.',
    sideEffectLevel: 'NONE',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 20, maxPerHour: 200, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        outcomeDescription: { type: 'string', description: 'What the business owner wants to accomplish', maxLength: 1000 }
      },
      required: ['outcomeDescription'],
      additionalProperties: false
    },
    outputDescription: 'Structured change plan detailing affected components, required capability invocations, risk assessment, and approval requirements.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.build.artifact',
    displayName: 'Create or Modify Business Artifact',
    category: 'BUILD',
    description: 'Creates or modifies a project business artifact (website page, schema, copy, email template, or campaign spec).',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: true,
    autonomousAllowed: false,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 20, maxPerHour: 200, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        artifactType: { type: 'string', enum: ['PAGE', 'SCHEMA', 'EMAIL_TEMPLATE', 'COPY_SPEC', 'ASSET_SPEC'], description: 'Type of artifact' },
        title: { type: 'string', description: 'Artifact title', maxLength: 120 },
        content: { type: 'string', description: 'Artifact content payload', maxLength: 100000 },
        idempotencyKey: { type: 'string', description: 'Unique idempotency key', maxLength: 64 },
        approvalReferenceId: { type: 'string', description: 'Approved plan reference ID', maxLength: 64 }
      },
      required: ['artifactType', 'title', 'content', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Returns the created or modified artifact metadata, version hash, and audit receipt.',
    promptBoundaryPolicy: { untrustedInputSources: ['content'], outputFencingRequired: false }
  },
  {
    id: 'starli.build.preview',
    displayName: 'Generate Ephemeral Preview',
    category: 'BUILD',
    description: 'Generates an isolated, ephemeral preview URL for any staged artifact, page, or application release.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'CUSTOMER_AGENT', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: true,
    rateLimit: { maxPerMinute: 15, maxPerHour: 150, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'Target artifact identifier', maxLength: 100 }
      },
      required: ['artifactId'],
      additionalProperties: false
    },
    outputDescription: 'Returns ephemeral preview URL, expiry timestamp, and render status.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.build.version',
    displayName: 'Inspect Artifact Versions',
    category: 'BUILD',
    description: 'Lists or inspects historic versions and diffs for a given business artifact.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'Artifact identifier', maxLength: 100 },
        versionNumber: { type: 'integer', description: 'Specific version number to inspect', minimum: 1 }
      },
      required: ['artifactId'],
      additionalProperties: false
    },
    outputDescription: 'Returns historical versions, author, commit timestamp, and diff summary.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.build.remix',
    displayName: 'Remix Business Artifact',
    category: 'BUILD',
    description: 'Remixes an existing artifact into multi-channel derivatives (e.g. blog post -> Reel storyboard + 3 LinkedIn posts + email summary).',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: true,
    rateLimit: { maxPerMinute: 10, maxPerHour: 100, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'HIGH', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        sourceArtifactId: { type: 'string', description: 'Source artifact identifier', maxLength: 100 },
        targetFormats: {
          type: 'array',
          description: 'Desired derivative target formats',
          items: { type: 'string', enum: ['REEL_STORYBOARD', 'LINKEDIN_POST', 'TWITTER_THREAD', 'EMAIL_NEWSLETTER'] }
        },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['sourceArtifactId', 'targetFormats', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Asynchronous job descriptor for artifact remix synthesis.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },

  // ==========================================
  // 3. OBSERVE & VISITOR INTELLIGENCE (5)
  // ==========================================
  {
    id: 'starli.observe.pulse',
    displayName: 'Real-Time Telemetry Pulse',
    category: 'OBSERVE',
    description: 'Inspects real-time business telemetry: active live visitors, ongoing agent conversations, and error pulses.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'CUSTOMER_AGENT', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1200, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        timeWindowMinutes: { type: 'integer', description: 'Telemetry window (5 to 60 minutes)', minimum: 5, maximum: 60 }
      },
      additionalProperties: false
    },
    outputDescription: 'Current active visitors count, recent errors, and ongoing customer sessions.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.observe.traffic',
    displayName: 'Visitor Traffic & Funnels',
    category: 'OBSERVE',
    description: 'Reads aggregated, privacy-friendly visitor traffic metrics, top acquisition sources, and conversion funnel stats.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', '7d', '30d', 'month'], description: 'Time range period' }
      },
      additionalProperties: false
    },
    outputDescription: 'Unique visitors, pageviews, bounce rate, top referrers, and funnel completion percentages.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.observe.leads',
    displayName: 'High-Intent Leads Intelligence',
    category: 'OBSERVE',
    description: 'Reads prioritized high-intent leads generated by website visitors, pricing visits, and chat interactions.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 40, maxPerHour: 600, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        minScore: { type: 'integer', description: 'Minimum lead score threshold (0-100)', minimum: 0, maximum: 100 },
        limit: { type: 'integer', description: 'Max leads to return', minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    },
    outputDescription: 'Prioritized lead list with intent score, last seen timestamp, key visited pages, and suggested next touchpoint.',
    promptBoundaryPolicy: { outputFencingRequired: true }
  },
  {
    id: 'starli.observe.conversations',
    displayName: 'Customer Conversations & Chats',
    category: 'OBSERVE',
    description: 'Inspects customer support and sales chat conversations with privacy sanitization.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'CUSTOMER_AGENT', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 40, maxPerHour: 600, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'RESOLVED', 'NEEDS_OPERATOR'], description: 'Conversation status filter' },
        limit: { type: 'integer', description: 'Max conversations', minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    },
    outputDescription: 'List of customer conversation summaries, sentiment rating, and resolution states.',
    promptBoundaryPolicy: { untrustedInputSources: ['visitor_messages'], outputFencingRequired: true }
  },
  {
    id: 'starli.observe.sentiment',
    displayName: 'Customer Sentiment & Friction Analysis',
    category: 'OBSERVE',
    description: 'Analyzes customer sentiment, recurring questions, and onboarding friction points from real visitor messages.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 20, maxPerHour: 300, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        timeWindowDays: { type: 'integer', description: 'Days to analyze (1 to 30)', minimum: 1, maximum: 30 }
      },
      additionalProperties: false
    },
    outputDescription: 'Aggregate sentiment distribution, top customer friction topics, and unresolved inquiries.',
    promptBoundaryPolicy: { outputFencingRequired: true }
  },

  // ==========================================
  // 4. REACH, CONTENT & SOCIAL GROWTH (4)
  // ==========================================
  {
    id: 'starli.reach.calendar',
    displayName: 'Unified Publishing Calendar',
    category: 'REACH',
    description: 'Reads scheduled and published content entries across all channels (Blog, LinkedIn, Instagram, TikTok, Email).',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'CUSTOMER_AGENT', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date (YYYY-MM-DD)', maxLength: 10 },
        to: { type: 'string', description: 'End date (YYYY-MM-DD)', maxLength: 10 }
      },
      additionalProperties: false
    },
    outputDescription: 'Timeline of scheduled and published content posts with status, channel, and scheduled time.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.reach.draft_post',
    displayName: 'Draft Multi-Channel Content Post',
    category: 'REACH',
    description: 'Drafts brand-aligned content posts for social media or newsletter publication (remains draft until approved).',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 20, maxPerHour: 300, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['LINKEDIN', 'INSTAGRAM', 'TIKTOK', 'TWITTER', 'NEWSLETTER'], description: 'Target channel' },
        topic: { type: 'string', description: 'Core topic or announcement', maxLength: 500 },
        scheduledTime: { type: 'string', description: 'Optional target publication time (ISO-8601)', maxLength: 40 },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['channel', 'topic', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Returns created draft post reference, generated copy variants, and pending approval requirement for publishing.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.reach.video_brief',
    displayName: 'Synthesize Video Asset Brief',
    category: 'REACH',
    description: 'Generates programmatic video composition briefs and preview renders for reels and ads.',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: true,
    rateLimit: { maxPerMinute: 10, maxPerHour: 100, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'HIGH', financialCost: 'PLATFORM_CREDITS', estimatedCreditUnits: 25 },
    inputSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'Video core concept and hook', maxLength: 500 },
        aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1'], description: 'Aspect ratio' },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['concept', 'aspectRatio', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Asynchronous job descriptor for video rendering pipeline.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.reach.performance',
    displayName: 'Campaign Reach & Performance',
    category: 'REACH',
    description: 'Measures multi-channel content engagement, click-through rates, and follower growth.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: true,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 40, maxPerHour: 600, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        timeRangeDays: { type: 'integer', description: 'Analysis range in days (7 to 90)', minimum: 7, maximum: 90 }
      },
      additionalProperties: false
    },
    outputDescription: 'Summary of impressions, likes, shares, link clicks, and top-performing posts.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },

  // ==========================================
  // 5. OPERATIONS, RUNTIME & INTEGRATIONS (5)
  // ==========================================
  {
    id: 'starli.operations.summary',
    displayName: 'Runtime & Infrastructure Health',
    category: 'OPERATIONS',
    description: 'Inspects runtime health, deployment status, error budgets, and latency across staging and production.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', enum: ['staging', 'production', 'all'], description: 'Environment filter' }
      },
      additionalProperties: false
    },
    outputDescription: 'Status of application containers, database connectivity, domain TLS certificates, and uptime percentage.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.operations.logs',
    displayName: 'Tail & Summarize Application Logs',
    category: 'OPERATIONS',
    description: 'Retrieves bounded, sanitized runtime logs with automated error extraction and pattern summarization.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: true,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 30, maxPerHour: 500, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['INFO', 'WARN', 'ERROR', 'FATAL'], description: 'Minimum log severity' },
        limit: { type: 'integer', description: 'Max log lines to return', minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    outputDescription: 'List of sanitized log entries, error frequency histogram, and potential root cause hints.',
    promptBoundaryPolicy: { outputFencingRequired: true }
  },
  {
    id: 'starli.operations.connections',
    displayName: 'List Active Integrations',
    category: 'OPERATIONS',
    description: 'Lists all connected external provider integrations (Stripe, GitHub, Resend, Meta, Google Analytics) with opaque references.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    outputDescription: 'List of integration connections, provider names, connection health, and opaque connection references.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.operations.connect',
    displayName: 'Initiate Provider Connection',
    category: 'OPERATIONS',
    description: 'Initiates OAuth 2.0 PKCE connection handshake or creates an opaque connection reference for an external tool.',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:admin'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: true,
    autonomousAllowed: false,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 10, maxPerHour: 50, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['STRIPE', 'GITHUB', 'RESEND', 'META', 'GOOGLE'], description: 'Target provider' },
        callbackUrl: { type: 'string', description: 'Client redirect URI', maxLength: 250 },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['provider', 'callbackUrl', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Returns OAuth authorization URL and pending connection token reference.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.operations.sync',
    displayName: 'Trigger Data Synchronization',
    category: 'OPERATIONS',
    description: 'Triggers bidirectional data synchronization with external connected accounts (e.g. sync CRM deals, pull recent analytics).',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: true,
    idempotent: true,
    async: true,
    rateLimit: { maxPerMinute: 10, maxPerHour: 100, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'MEDIUM', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['CRM', 'ANALYTICS', 'COMMERCE', 'SOCIAL'], description: 'Domain to synchronize' },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['domain', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Asynchronous sync job tracking reference with progress monitoring.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },

  // ==========================================
  // 6. GOVERNANCE, APPROVALS & TRUST (7)
  // ==========================================
  {
    id: 'starli.governance.approvals_pending',
    displayName: 'List Pending Approvals',
    category: 'GOVERNANCE',
    description: 'Lists all decisions currently awaiting human sign-off with blast radius, summary, and expiry timestamp.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    outputDescription: 'List of pending approval cards, action descriptions, financial or recipient blast radius, and approval reference IDs.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.approve',
    displayName: 'Approve Pending Action',
    category: 'GOVERNANCE',
    description: 'Records a human approval decision for the exact canonical plan hash. This never executes the action.',
    sideEffectLevel: 'HIGH_IMPACT',
    requiredScopes: ['customer:admin'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: true,
    autonomousAllowed: false,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 20, maxPerHour: 200, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        approvalReferenceId: { type: 'string', description: 'Target approval reference ID', maxLength: 180 },
        planHash: { type: 'string', description: 'SHA-256 hash of the verified plan', maxLength: 64 },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['approvalReferenceId', 'planHash', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Canonical approval decision ID and audit receipt. Execution remains separately governed.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.reject',
    displayName: 'Reject Pending Action',
    category: 'GOVERNANCE',
    description: 'Declines a pending action or requests revision with feedback for the agent.',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:write'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: false,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 30, maxPerHour: 300, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        planHash: {type:'string',description:'Exact canonical action-plan hash',maxLength:64},
        approvalReferenceId: { type: 'string', description: 'Target approval reference ID', maxLength: 180 },
        reason: { type: 'string', description: 'Feedback or explanation for rejection', maxLength: 500 },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['planHash','approvalReferenceId', 'reason', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Rejection confirmation and updated change plan state.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.policy_get',
    displayName: 'Inspect Autonomy Policy',
    category: 'GOVERNANCE',
    description: 'Reads active tenant autonomy policies: quiet hours, auto-execute thresholds, and approval rules.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    outputDescription: 'Active tenant autonomy configuration including default delegation mode and quiet hour windows.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.policy_set',
    displayName: 'Update Autonomy Policy',
    category: 'GOVERNANCE',
    description: 'Updates tenant autonomy parameters: contact permissions, publishing rules, or spending caps.',
    sideEffectLevel: 'WRITE',
    requiredScopes: ['customer:admin'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: true,
    autonomousAllowed: false,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 15, maxPerHour: 100, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        defaultAutonomyLevel: { type: 'string', enum: ['OBSERVE', 'RECOMMEND', 'DRAFT', 'EXECUTE_SAFE', 'EXECUTE_APPROVED'], description: 'Default autonomy level' },
        requirePublishApproval: { type: 'boolean', description: 'Require sign-off before publishing' },
        requireDeployApproval: { type: 'boolean', description: 'Require sign-off before deploying' },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Updated policy confirmation receipt.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.receipt_get',
    displayName: 'Verify Cryptographic Receipt',
    category: 'GOVERNANCE',
    description: 'Reads a tenant-owned canonical capability audit receipt and its recorded result digest.',
    sideEffectLevel: 'READ',
    requiredScopes: ['customer:read'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: true,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 60, maxPerHour: 1000, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        receiptId: { type: 'string', description: 'Cryptographic receipt ID', maxLength: 64 }
      },
      required: ['receiptId'],
      additionalProperties: false
    },
    outputDescription: 'Immutable execution audit record with SHA-256 payload digest and verification status.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  },
  {
    id: 'starli.governance.pause',
    displayName: 'Emergency Global Pause',
    category: 'GOVERNANCE',
    description: 'Pauses new governed Agency actions through canonical autonomy policy. Already-started work requires inspection.',
    sideEffectLevel: 'HIGH_IMPACT',
    requiredScopes: ['customer:admin'],
    allowedSurfaces: ['ORCHESTRATOR', 'CLI', 'WINDOWS_MCP', 'CHATGPT_MCP'],
    approvalRequired: false,
    autonomousAllowed: false,
    projectScoped: false,
    connectionRequired: false,
    idempotent: true,
    async: false,
    rateLimit: { maxPerMinute: 10, maxPerHour: 50, scope: 'PER_TENANT' },
    estimatedCost: { computeLevel: 'LOW', financialCost: 'NONE' },
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for emergency pause', maxLength: 500 },
        idempotencyKey: { type: 'string', description: 'Idempotency key', maxLength: 64 }
      },
      required: ['reason', 'idempotencyKey'],
      additionalProperties: false
    },
    outputDescription: 'Canonical pause confirmation; no claim that in-flight actions were undone.',
    promptBoundaryPolicy: { outputFencingRequired: false }
  }
];
