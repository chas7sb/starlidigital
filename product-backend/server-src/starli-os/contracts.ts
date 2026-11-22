import type {WorkspaceMediaContext,HomeMediaSummary} from '../media-workspace/types.js';
export type {WorkspaceMediaContext,HomeMediaSummary} from '../media-workspace/types.js';

/**
 * STARLI OS V2 — AGGREGATE API CONTRACT
 *
 * Formal data contracts for Starli Home and Starli Workspace screens.
 * Designed by GEMINI 4 (Aggregate API Architect) under CHATGPT ULTRA BOSS.
 *
 * Strict invariants:
 * 1. Exactly ONE network roundtrip per screen load.
 * 2. Strict bounded payload budgets (<= 100 KB Home, <= 150 KB Workspace).
 * 3. Zero browser-side fanout across projects, artifacts, or capabilities.
 * 4. Monotonic sequence cursors for realtime event catch-up.
 * 5. Privacy-safe projection: zero secret keys, tokens, or raw PII.
 */

// ============================================================================
// SECTION 1: PERFORMANCE BUDGETS & ARCHITECTURAL LIMITS
// ============================================================================

export const STARLI_AGGREGATE_BUDGETS = {
  /** Maximum number of backend roundtrips for full screen snapshot */
  MAX_INITIAL_REQUESTS: 1,
  /** Maximum allowable roundtrips during periodic screen refresh */
  MAX_REFRESH_REQUESTS: 1,
  /** Maximum uncompressed payload for Starli Home (100 KB) */
  MAX_HOME_PAYLOAD_BYTES: 102400,
  /** Maximum uncompressed payload for Starli Workspace (150 KB) */
  MAX_WORKSPACE_PAYLOAD_BYTES: 153600,
  /** Hard cap on list items returned in any aggregate screen section */
  MAX_ITEMS_PER_SECTION: 50,
  /** Maximum simultaneous multiplexed subscriptions per client */
  MAX_ACTIVE_SUBSCRIPTIONS: 2,
  /** Active foreground polling interval fallback when WebSockets drop */
  POLLING_INTERVAL_ACTIVE_MS: 15000,
  /** Background / hidden tab polling interval */
  POLLING_INTERVAL_BACKGROUND_MS: 60000,
  /** Maximum buffer lag before server triggers backpressure overrun */
  MAX_UNACKED_EVENT_LAG: 500,
  /** Server-side query execution circuit breaker (ms) */
  QUERY_TIMEOUT_MS: 3000,
} as const;

export type StarliAggregateBudgets = typeof STARLI_AGGREGATE_BUDGETS;

// ============================================================================
// SECTION 2: ANTI-FANOUT INVARIANTS
// ============================================================================

export const ANTI_FANOUT_RULES = {
  /** No client-side mapping over projects to fetch artifacts/builds */
  NO_PROJECT_ARTIFACT_FANOUT: 'FORBIDDEN_PROJECT_ARTIFACT_FANOUT',
  /** No client-side iteration to fetch capability health per connector */
  NO_CAPABILITY_STATUS_FANOUT: 'FORBIDDEN_CAPABILITY_STATUS_FANOUT',
  /** Server must pre-join rollups (kpis, steps, artifact counts, preview status) */
  PRE_JOINED_SCREEN_ROLLUPS: 'MANDATORY_PRE_JOINED_SCREEN_ROLLUPS',
  /** Strict keyset / sequence cursors on all activity streams */
  STRICT_CURSOR_PAGINATION: 'STRICT_CURSOR_PAGINATION',
} as const;

// ============================================================================
// SECTION 3: COMMON PRIMITIVES & CURSORS
// ============================================================================

export interface MonotonicSequenceCursor {
  afterSequence?: number | null;
  limit?: number;
}

export interface KeysetCursor {
  cursor?: string | null;
  limit?: number;
}

export interface SectionPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
  totalCount?: number;
}

// ============================================================================
// SECTION 4: STARLI HOME AGGREGATE READ MODEL (ONE SNAPSHOT)
// ============================================================================

export type BusinessEngineLifecycle =
  | 'DRAFT'
  | 'COMPILING'
  | 'BUILDING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ATTENTION_REQUIRED';

export interface BusinessEngineKpiSummary {
  label: string;
  value: string | number;
  changePercent?: number;
  trend: 'UP' | 'DOWN' | 'NEUTRAL';
}

export interface BusinessEngineHomeSummary {
  id: string;
  name: string;
  objective: string;
  lifecycle: BusinessEngineLifecycle;
  blueprintSummary: string;
  healthScore: number | null; // 0-100
  activeRoutinesCount: number;
  kpis: BusinessEngineKpiSummary[];
  updatedAt: string;
}

export type WorkPackageStatus = 'QUEUED' | 'WORKING' | 'REVIEW' | 'COMPLETED' | 'BLOCKED';

export interface WorkPackageHomeSummary {
  id: string;
  title: string;
  category: 'PRESENCE' | 'BACKEND' | 'BRAND' | 'ACQUISITION' | 'SUPPORT' | 'DISTRIBUTION';
  progressPercent: number | null;
  status: WorkPackageStatus;
  activeWorker: string | null;
  lastStepSummary: string;
  updatedAt: string;
}

export type ApprovalKind = 'PUBLISH' | 'SPEND' | 'DEPLOY' | 'SEND' | 'DATA_MIGRATE' | 'OTHER';

export interface PendingApprovalItem {
  id: string;
  title: string;
  kind: ApprovalKind;
  requestedAt: string;
  resourceType: string;
  resourceId: string;
  impactSummary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface CustomerClarificationQuestion {
  id: string;
  question: string;
  context: string;
  suggestedOptions?: string[];
  askedAt: string;
}

export interface AttentionHomeQueue {
  totalCount: number;
  criticalCount: number;
  pendingApprovals: PendingApprovalItem[];
  customerQuestions: CustomerClarificationQuestion[];
}

export interface HomeActivityEvent {
  id: string;
  sequence: number; // Monotonic strict integer cursor
  type: string;
  title: string;
  summary: string;
  occurredAt: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  primaryEntityRef?: {
    kind: string;
    id: string;
  };
}

export interface HomeActivityFeed {
  events: HomeActivityEvent[];
  lastSequence: number;
  hasMore: boolean;
}

export interface CapabilityConnectorSummary {
  id: string;
  label: string;
  category: string;
  status: 'CONNECTED' | 'AVAILABLE' | 'ATTENTION_REQUIRED' | 'DISCONNECTED' | 'REVOKED';
}

export interface CapabilityCloudHomeSummary {
  connectedCount: number;
  availableCount: number | null;
  needsAttentionCount: number;
  topConnectors: CapabilityConnectorSummary[];
}

export type StarliConnectionState = 'CONNECTED' | 'CONFIGURATION_NEEDED' | 'PERMISSION_REQUIRED' | 'UNAVAILABLE' | 'DEGRADED';
export interface StarliConnectionItem {
  id: string;
  provider: string;
  label: string;
  category: string;
  status: StarliConnectionState;
  source: 'CAPABILITY_CLOUD' | 'SOCIAL_CLOUD' | 'CATALOG';
  usedByStarli: boolean;
  action: 'OPEN_SOCIAL' | null;
  detail: string | null;
  updatedAt: string | null;
}
export interface StarliConnectionsSnapshot {
  schemaVersion: 2;
  generatedAt: string;
  tenantId: string;
  items: StarliConnectionItem[];
  counts: Record<StarliConnectionState, number>;
  hasMore: boolean;
}

/**
 * Composite Starli Home Screen Snapshot.
 * Delivered in exactly ONE HTTP POST /graphql roundtrip.
 */
export interface StarliHomeSnapshot {
  projection?: { unavailableSections:string[]; boundedSections:string[]; activitySource:'CREATIVE_PROJECTS' };
  generatedAt: string;
  tenantId: string;
  greetingHeadline: string;
  activeEngine: BusinessEngineHomeSummary | null;
  activeWorkPackages: WorkPackageHomeSummary[];
  attention: AttentionHomeQueue;
  recentActivity: HomeActivityFeed;
  capabilityCloud: CapabilityCloudHomeSummary;
  media?: HomeMediaSummary | null;
}

// ============================================================================
// SECTION 5: STARLI WORKSPACE / INFINITE STUDIO AGGREGATE READ MODEL
// ============================================================================

export type StudioScreenMode = 'CANVAS' | 'PREVIEW' | 'FILES' | 'ACTIVITY' | 'BACKEND' | 'PUBLISH';

export type WorkspaceLifecycle = 'IDEA' | 'PLANNED' | 'WORKING' | 'BLOCKED' | 'REVIEW' | 'READY' | 'LIVE';

export interface WorkspacePlanStep {
  id: string;
  label: string;
  status: 'TODO' | 'WORKING' | 'DONE' | 'BLOCKED';
  artifactIds: string[];
}

export interface WorkspacePlanSummary {
  summary: string;
  progressPercent: number | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETE' | 'BLOCKED';
  steps: WorkspacePlanStep[];
}

export interface WorkspaceArtifactCard {
  id: string;
  name: string;
  kind: 'website' | 'web_app' | 'mobile_app' | 'backend' | 'image' | 'video' | 'copy' | 'campaign' | 'ai_agent' | 'automation' | 'integration' | 'file' | 'report' | 'custom';
  version: number;
  status: 'idea' | 'planned' | 'working' | 'ready' | 'published' | 'failed';
  previewUrl?: string | null;
  thumbnailHash?: string | null;
  updatedAt: string;
}

export interface WorkspaceArtifactGraph {
  totalArtifacts: number;
  artifacts: WorkspaceArtifactCard[];
  pageInfo: SectionPageInfo;
}

export interface WorkspaceLivePreviewState {
  activeUrl: string | null;
  provider: 'DOCKER' | 'VERCEL' | null;
  status: 'BUILDING' | 'READY' | 'FAILED' | 'OFFLINE' | 'UNKNOWN';
  lastBuildDurationMs?: number | null;
  buildError?: string | null;
}

export interface WorkspaceBackendState {
  serviceStatus: 'UNAVAILABLE' | 'STAGED' | 'PROVISIONED' | 'LIVE' | 'DEGRADED' | 'UNKNOWN';
  schemaVersion?: number | null;
  endpointUrl?: string | null;
  activeMigrationsCount: number | null;
  databaseHealth: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
}

export interface WorkspaceBrandBrainSummary {
  id: string;
  brandName: string;
  voiceTone: string;
  hasLogo: boolean;
  colorsCount: number;
}

export interface WorkspaceExecutionReceipt {
  id: string;
  stepLabel: string;
  toolName: string | null;
  durationMs: number | null;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  executedAt: string;
  summary: string;
}

/**
 * Composite Starli Workspace / Infinite Studio Snapshot.
 * Delivered in exactly ONE HTTP POST /graphql roundtrip.
 */
export interface StarliWorkspaceSnapshot {
  projection?: { unavailableSections:string[] };
  generatedAt: string;
  projectId: string;
  projectName: string;
  projectType: string;
  lifecycle: WorkspaceLifecycle;
  currentMode: StudioScreenMode;
  plan: WorkspacePlanSummary;
  artifactGraph: WorkspaceArtifactGraph;
  livePreview: WorkspaceLivePreviewState;
  backendState: WorkspaceBackendState;
  brandBrain: WorkspaceBrandBrainSummary | null;
  recentExecutionReceipts: WorkspaceExecutionReceipt[];
  media?: WorkspaceMediaContext | null;
}

// ============================================================================
// SECTION 6: REALTIME DELTAS & SUBSCRIPTIONS
// ============================================================================

export type StarliDeltaType =
  | 'WORK_PACKAGE_PROGRESS'
  | 'STEP_COMPLETED'
  | 'APPROVAL_REQUESTED'
  | 'ARTIFACT_CREATED'
  | 'PREVIEW_READY'
  | 'BACKEND_STATUS_CHANGED'
  | 'EVENT_APPENDED';

export interface StarliHomeDeltaEvent {
  deltaType: StarliDeltaType;
  sequence: number;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

export interface StarliWorkspaceDeltaEvent {
  projectId: string;
  deltaType: StarliDeltaType;
  sequence: number;
  occurredAt: string;
  payload: Record<string, string | number | boolean>;
}

// ============================================================================
// SECTION 7: CLIENT LOADER CONTRACT
// ============================================================================

export interface IStarliScreenClient {
  /**
   * Load the full Starli Home screen in exactly 1 request.
   * Prohibits client-side fanout across engines, work packages, or connectors.
   */
  loadStarliHomeSnapshot(): Promise<StarliHomeSnapshot>;

  /**
   * Load the full Starli Workspace / Infinite Studio in exactly 1 request.
   * Prohibits client-side fanout across artifacts, preview builds, or backend state.
   */
  loadStarliWorkspaceSnapshot(projectId: string): Promise<StarliWorkspaceSnapshot>;

  /**
   * Catch up on missed delta events using the monotonic sequence cursor.
   */
  catchUpHomeActivity(afterSequence: number, limit?: number): Promise<HomeActivityFeed>;
}
