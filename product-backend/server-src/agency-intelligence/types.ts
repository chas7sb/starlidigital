export type LifecycleStage = 'ANONYMOUS'|'ENGAGED'|'IDENTIFIED'|'LEAD'|'CUSTOMER'|'RETURNING'|'DORMANT';
export type AutonomyLevel = 'OBSERVE'|'RECOMMEND'|'DRAFT'|'EXECUTE_SAFE'|'EXECUTE_APPROVED';
export type OpportunityStatus = 'OPEN'|'DISMISSED'|'RESOLVED'|'COOLDOWN';
export type OpportunityType =
  | 'ACTIVE_ENGAGED_VISITOR' | 'REPEATED_ROUTE_INTEREST' | 'ABANDONED_AGENT_CONVERSATION'
  | 'KNOWN_LEAD_RETURNED' | 'PROPOSAL_FOLLOWUP_NEEDED' | 'UNANSWERED_INBOUND'
  | 'STALE_CRM_LEAD' | 'CAMPAIGN_CONVERSION_ANOMALY';

export interface EntityRef { kind: string; id: string }
export interface ConsentReference { ref: string; status: 'GRANTED'|'DENIED'|'UNKNOWN'; capturedAt?: string }
export interface ContactPreference { channel: 'EMAIL'|'PHONE'|'SMS'|'DM'|'ONSITE'; allowed: boolean; sourceRef: string }
export interface ActionCooldown { key: string; until: string; reason: string }
export interface VisitorProfileEvidence {
  id: string; tenantId: string; kind: 'SESSION'|'ROUTE'|'CAMPAIGN'|'REFERRER'|'CONVERSATION_STATE'|'EXPLICIT_CONTACT'|'CRM_LINK'|'PROPOSAL_ACTIVITY'|'CONSENT'|'BUSINESS_TAG';
  sourceRef: EntityRef; observedAt: string; category?: string; value?: string; authoritativeIdentity?: boolean;
}
export interface IntentSignal { kind: 'ACTIVE'|'REPEATED_INTEREST'|'CONVERSATION_STARTED'|'RETURNED'|'PROPOSAL_ENGAGED'; strength: number; evidenceRefs: string[] }
export interface EngagementScore { value: number; band: 'LOW'|'MEDIUM'|'HIGH'; reasons: string[]; version: 'v1' }
export interface NextBestAction { kind: string; label: string; rationale: string; autonomyAllowed: AutonomyLevel; approvalRequired: boolean }
export interface VisitorProfile {
  id: string; tenantId: string; agentId?: string; sessionRefs: string[]; linkedContactRef?: EntityRef; linkedCrmRef?: EntityRef;
  lifecycleStage: LifecycleStage; interestCategories: string[]; intentSignals: IntentSignal[]; engagementScore: EngagementScore;
  evidenceRefs: string[]; consentRefs: ConsentReference[]; contactPreferences: ContactPreference[]; doNotContact: boolean; dismissed: boolean;
  nextBestAction?: NextBestAction; cooldowns: ActionCooldown[]; createdAt: string; updatedAt: string;
}
export interface BusinessOpportunity {
  id: string; tenantId: string; type: OpportunityType; entityRefs: EntityRef[]; evidenceRefs: string[]; confidence: number;
  priority: number; recommendedAction: NextBestAction; autonomyAllowed: AutonomyLevel; approvalRequired: boolean; cooldown: ActionCooldown;
  status: OpportunityStatus; dedupeKey: string; createdAt: string; updatedAt: string;
}
export interface AgencyActionPlan {
  id: string; tenantId: string; opportunityId: string; status: 'PROPOSED'; action: NextBestAction; entityRefs: EntityRef[];
  evidenceRefs: string[]; capabilityRequirement?: string; approvalRequired: boolean; autonomyAllowed: AutonomyLevel; createdAt: string;
}

export interface AgencyObservation {
  tenantId: string; now: string; kind: OpportunityType; entityRefs: EntityRef[]; evidenceRefs: string[];
  active?: boolean; engagementScore?: number; repeatedInterestCount?: number; abandoned?: boolean; knownLead?: boolean;
  proposalViewedAt?: string; followupAt?: string|null; inboundAt?: string; answeredAt?: string|null; crmUpdatedAt?: string;
  campaignVisits?: number; campaignConversions?: number; baselineConversionRate?: number;
  doNotContact?: boolean; dismissed?: boolean; optOut?: boolean;
}
