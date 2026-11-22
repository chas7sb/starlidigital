export const SOCIAL_PLATFORMS = [
  'TIKTOK','INSTAGRAM','YOUTUBE','FACEBOOK','LINKEDIN','X','THREADS','PINTEREST','BLUESKY','GOOGLE_BUSINESS','DISCORD','TELEGRAM','MASTODON','WORDPRESS',
] as const;
export type SocialPlatform = typeof SOCIAL_PLATFORMS[number];

export const SOCIAL_CAPABILITIES = [
  'CONNECT_ACCOUNT','LIST_ACCOUNTS','LIST_FACEBOOK_PAGES','LIST_LINKEDIN_PAGES','LIST_PINTEREST_BOARDS','LIST_GOOGLE_BUSINESS_LOCATIONS',
  'PUBLISH_VIDEO','PUBLISH_IMAGES','PUBLISH_TEXT','SCHEDULE','QUEUE','EDIT_SCHEDULED','CANCEL_SCHEDULED','STATUS','HISTORY','RECENT_MEDIA',
  'POST_ANALYTICS','PROFILE_ANALYTICS','COMMENTS_READ','COMMENTS_REPLY','COMMENTS_MODERATE','DMS_READ','DMS_SEND','GOOGLE_REVIEWS_READ','GOOGLE_REVIEWS_REPLY',
] as const;
export type SocialCapability = typeof SOCIAL_CAPABILITIES[number];

export type SocialConnectionState = 'CONNECTED'|'REAUTH_REQUIRED'|'DISCONNECTED'|'ERROR';
export type SocialPublishState = 'DRAFT'|'READY_FOR_APPROVAL'|'APPROVED'|'QUEUED'|'SCHEDULED'|'PUBLISHING'|'PUBLISHED'|'PARTIAL_SUCCESS'|'FAILED'|'NEEDS_REAUTH'|'NEEDS_REVIEW'|'CANCELLED';
export type SocialPublishMode = 'NOW'|'SCHEDULE'|'QUEUE'|'DRAFT';

export interface SocialConnection {
  id: string;
  tenantId: string;
  projectId?: string;
  provider: string;
  platform: SocialPlatform;
  providerProfileRef: string;
  accountRef: string;
  safeMetadata: { displayName?: string; handle?: string; avatarUrl?: string; targetLabel?: string };
  capabilities: SocialCapability[];
  state: SocialConnectionState;
  connectedAt: string;
  refreshedAt: string;
}

export interface SocialSchedule { mode: SocialPublishMode; publishAt?: string; timezone?: string; queueRef?: string }

export interface SocialPostVariant {
  platform: SocialPlatform;
  connectionId: string;
  caption?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
  firstComment?: string;
  mediaRefs?: string[];
  options?: Record<string, string|number|boolean>;
}

export interface SocialPostPlan {
  id: string;
  tenantId: string;
  projectId?: string;
  sourceArtifactRefs: string[];
  variants: SocialPostVariant[];
  schedule: SocialSchedule;
  disclosureFlags?: string[];
  approvalReference?: string;
  createdAt: string;
}

export interface SocialPlatformResult {
  platform: SocialPlatform;
  connectionId: string;
  state: SocialPublishState;
  providerPostRef?: string;
  providerJobRef?: string;
  publishedAt?: string;
  warningCodes?: string[];
  errorCode?: string;
}

export interface SocialPublishJob {
  id: string;
  tenantId: string;
  planId: string;
  state: SocialPublishState;
  idempotencyKey: string;
  results: SocialPlatformResult[];
  createdAt: string;
  updatedAt: string;
}

export interface SocialAnalyticsSnapshot {
  id: string;
  tenantId: string;
  platform: SocialPlatform;
  connectionId: string;
  postRef?: string;
  capturedAt: string;
  metrics: Record<string, number>;
}

export interface SocialTarget { ref: string; label: string; kind: 'PAGE'|'BOARD'|'LOCATION'|'ACCOUNT' }
export interface SocialInteractionSummary { ref: string; kind: 'COMMENT'|'DM'|'REVIEW'; platform: SocialPlatform; createdAt?: string; authorLabel?: string; moderationState?: string; hasText: boolean }
export interface SocialWriteReceipt { state: 'QUEUED'|'PUBLISHED'|'FAILED'|'NEEDS_REAUTH'|'NEEDS_REVIEW'; providerRef?: string; errorCode?: string }
export interface SocialConnectionFlow { provider: string; flowRef: string; launchUrl?: string; expiresAt?: string }
export interface ProviderPublishInput { connection: SocialConnection; variant: SocialPostVariant; schedule: SocialSchedule; idempotencyKey: string }
export interface ProviderPublishResult { state: Exclude<SocialPublishState,'DRAFT'|'READY_FOR_APPROVAL'|'APPROVED'|'PARTIAL_SUCCESS'>; providerPostRef?: string; providerJobRef?: string; publishedAt?: string; warningCodes?: string[]; errorCode?: string }

export interface SocialProviderAdapter {
  readonly provider: string;
  createConnectionFlow(input: { tenantId: string; projectId?: string; platform?: SocialPlatform; platforms?: SocialPlatform[]; returnUrl?: string }): Promise<SocialConnectionFlow>;
  listConnectedAccounts(input: { tenantId: string; providerProfileRef?: string }): Promise<Array<Omit<SocialConnection,'id'|'tenantId'|'connectedAt'|'refreshedAt'>>>;
  listTargets(input: { connection: SocialConnection; kind: SocialTarget['kind'] }): Promise<SocialTarget[]>;
  publishVideo(input: ProviderPublishInput): Promise<ProviderPublishResult>;
  publishImages(input: ProviderPublishInput): Promise<ProviderPublishResult>;
  publishText(input: ProviderPublishInput): Promise<ProviderPublishResult>;
  editScheduled(input: { connection: SocialConnection; providerJobRef: string; variant: SocialPostVariant; idempotencyKey: string }): Promise<ProviderPublishResult>;
  cancelScheduled(input: { connection: SocialConnection; providerJobRef: string; idempotencyKey: string }): Promise<ProviderPublishResult>;
  getStatus(input: { connection: SocialConnection; providerJobRef?: string; providerPostRef?: string }): Promise<ProviderPublishResult>;
  history(input: { connection: SocialConnection; limit: number }): Promise<SocialPlatformResult[]>;
  recentMedia(input: { connection: SocialConnection; limit: number }): Promise<Array<{ ref: string; kind: 'IMAGE'|'VIDEO'; createdAt?: string }>>;
  postAnalytics(input: { connection: SocialConnection; providerPostRef: string }): Promise<Record<string,number>>;
  profileAnalytics(input: { connection: SocialConnection }): Promise<Record<string,number>>;
  listComments(input: { connection: SocialConnection; providerPostRef?: string; limit: number }): Promise<SocialInteractionSummary[]>;
  replyToComment(input: { connection: SocialConnection; interactionRef: string; text: string; idempotencyKey: string }): Promise<SocialWriteReceipt>;
  moderateComment(input: { connection: SocialConnection; interactionRef: string; action: 'HIDE'|'UNHIDE'|'DELETE'|'REPORT'; idempotencyKey: string }): Promise<SocialWriteReceipt>;
  listDms(input: { connection: SocialConnection; limit: number }): Promise<SocialInteractionSummary[]>;
  sendDm(input: { connection: SocialConnection; conversationRef: string; text: string; idempotencyKey: string }): Promise<SocialWriteReceipt>;
  listGoogleBusinessReviews(input: { connection: SocialConnection; limit: number }): Promise<SocialInteractionSummary[]>;
  replyGoogleBusinessReview(input: { connection: SocialConnection; reviewRef: string; text: string; idempotencyKey: string }): Promise<SocialWriteReceipt>;
}

export interface SocialCapabilityPolicy {
  authorize(input: { tenantId: string; projectId?: string; capability: SocialCapability; approvalReference?: string; externalWrite: boolean }): Promise<{ allowed: boolean; reason?: string }>;
}

export interface SocialEventSink { publish(type: string, payload: Record<string,unknown>): void }
