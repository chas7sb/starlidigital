import {createStarliAggregateGraphQL} from './starli-os/graphql.js';
import {MediaWorkspaceService} from './media-workspace/service.js';
import {HostedAgentService} from './hosted-agents/service.js';
import {createHostedAgentGraphQL} from './hosted-agents/graphql.js';
import {createHostedAgentProposalGraphQL} from './hosted-agent-integrations/graphql.js';
import {createAgencyMailbox} from './mailbox/agency-mailbox.js';
import{canUseSubscriptionHosting}from'./hosting.js';
import{enqueueSubscriptionFulfillment}from'./fulfillment.js';
import{creditsWallet,creditLedger,grantCredits}from'./credits.js';
import{creditCatalog,billingAccount,createCreditCheckout,createSubscriptionCheckout,createBillingPortal,creditOwnerId,sandboxCheckoutAllowed}from'./subscriptions.js';
import{creditCosts,buildCreditCost,reserveCreditAction,finishCreditAction,admitFreeChat}from'./credit-policy.js';
import { createSchema } from 'graphql-yoga';
import {buildBespokeOperatorProposal} from './operator-bespoke.js';
import {startOperatorTask,operatorTask,stopOperatorTask} from './operator-tasks.js';
import {operatorTaskEvents} from './operator-gateway.js';
import {listOperatorSessions,getOperatorSession} from './operator-sessions.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Store, id, now, type RecordData } from './store.js';
import { Events } from './events.js';
import { fail, bounded, limit, access, refresh, requireAdmin, requireUser, normalizeUsername, validatePassword, hashPassword, verifyPassword, startSession, hashToken, owner, type Context } from './security.js';
import { integrations, settings, chatReply, generateArticle, aiConfigured, normalizeProvider, outlierDiagnostics, pingOutlier, updateOutlierCredentials } from './ai.js';
import {enqueueAdminFulfillment,retryFulfillment as retryJob,tickFulfillment} from './fulfillment.js';
import {emailStatus,emailOutboxReady,publicEmail,enqueueEmail,queueWelcome,queuePasswordReset,retryEmail as retryOutbox} from './email.js';
import { createCheckout, paidForSource, pricing, sourceHash } from './billing.js';
import { deployNextSite, getDeployment, vercelConfigured } from './integrations/vercel.js';
import { SerialQueue } from './queue.js';
import {agentTurn,type AgentActionMode,type ChatAttachmentInput} from './agent-turn.js';
import {validateChatAttachments} from './attachments.js';
import {sourceDraftEvidence} from './source-evidence.js';
import {renderNextPreviewHtml} from './preview-renderer.js';
import {validateNextProjectFiles} from './next-template.js';
import {createDomainQuote as quoteDomainCheckout,createDomainCheckout as checkoutDomain,listDomainQuotes,listDomainPayments} from './domain-commerce.js';
import {issueOperatorToken,revokeOperatorToken,listOperatorTokens,requireOperator,redactSecrets} from './operator-auth.js';
import {approveOperatorJob,cancelOperatorJob} from './operator-jobs.js';
import {createDevicePairingCode,completeDevicePairing,recordDeviceHeartbeat,revokeDevice,enqueueDeviceTask,reportDeviceJobOutcome,pushJobToDeviceSocket} from './operator-devices.js';
import {upsertLead,createOrUpdateProposalDemo,promoteOperatorProposal,transitionProposalState,rotateOrRevokeClaimCode,getProposalDeliveryInfo,getPublicProposalBySlug,sendProposalVisitorMessage,publicOptOutFromProposal,requestProposalClaimOtp,claimProposalWebsite,getAgencyBudget,updateAgencyBudgetLimits,recordContactOptOut} from './leads-proposals.js';
import {prepareProposalMessage,approveAndDispatchMessage,recordAdbSmsOutcome} from './messaging.js';
import {executeOperatorTool,runOperatorTurn,getPlatformOperationalSummary,stagePlatformChange,approveStagedPlatformChange,rollbackPlatformChange} from './operator-tools.js';
import { CrmServices } from './crm/services.js';
import { createCrmGraphQL } from './crm/graphql.js';
import { MailboxServices } from './mailbox/service.js';
import { createMailboxGraphQL } from './mailbox/graphql.js';
import { AssetServices } from './assets/service.js';
import { createAssetGraphQL } from './assets/graphql.js';
import { VideoServices } from './video/service.js';
import { createVideoGraphQL } from './video/graphql.js';
import { VideoDirectorService } from './video-director/service.js';
import { createVideoDirectorGraphQL } from './video-director/graphql.js';
import { AgencyCockpitService } from './agency-cockpit/service.js';
import { createAgencyCockpitGraphQL } from './agency-cockpit/graphql.js';
import { ApprovalCenterService } from './approval-center/service.js';
import { createApprovalCenterGraphQL } from './approval-center/graphql.js';
import { createBusinessEngineGraphQL } from './business-engine/graphql.js';
import { ensureAgencyIntelligenceProjector } from './agency-intelligence/projector.js';
import { SocialPublishingService } from './social-publishing/service.js';
import { StoreSocialRepository } from './social-publishing/repository.js';
import { createSocialPublishingGraphQL } from './social-publishing/graphql.js';
import { createCustomerCapabilityGraphQL } from './customer-capabilities/graphql.js';
import { createCustomerCapabilityRuntime, type CustomerCapabilityRuntime } from './customer-capabilities/runtime.js';
import { UploadPostAdapter } from './social-publishing/upload-post-adapter.js';
import { UploadPostRestClient, uploadPostProfileForTenant } from './social-publishing/upload-post-client.js';
import { createCanonicalMachineryExecutionRuntime } from './machinery-run/runtime.js';
import {createStarliGovernedGraphQL,governedIntentForMessage} from './starli-conversation/customer-graphql.js';
import type {ConversationGoalPlanner} from './starli-conversation/governed-execution-adapter.js';
import { createMachineryGraphQL } from './machinery-run/graphql.js';

const typeDefs=/* GraphQL */`
 enum ChatMode { STARLI ALEX }
 enum AgentActionMode { AUTO CHAT PLAN BUILD }
 enum AIProvider { OPENAI OUTLIER }
 type User { id: ID! username: String! email: String! recoveryEmail: String! role: String! createdAt: String! disabled: Boolean! }
 type AuditEntry { id: ID! actor: String! actorName: String! action: String! target: String! createdAt: String! }
 type ChatAttachment { name: String! mimeType: String! dataUrl: String textExcerpt: String }
 input ChatAttachmentInput { name: String! mimeType: String! dataUrl: String textExcerpt: String }
 type Message { id: ID! role: String! content: String! createdAt: String! authorName: String! planJson: String questionJson: String suggestedFollowUp: String attachments: [ChatAttachment!] stepsCount: Int durationMs: Int agentRunId: ID selectedElement: String }
 type Conversation { projectId: ID id: ID! title: String! mode: ChatMode! status: String! agentStatus: String agentStartedAt: String createdAt: String! updatedAt: String! messages: [Message!]! }
 type SourceFile { path: String! content: String! encoding: String }
 type ResearchSource { title: String! url: String! }
 type ProjectKnowledge { businessSummary: String! audience: String! goals: String! brandDirection: String! language: String! technicalRules: String! customInstructions: String! updatedAt: String! }
 input ProjectKnowledgeInput { businessSummary: String audience: String goals: String brandDirection: String language: String technicalRules: String customInstructions: String }
 type AgentStep { id: ID! category: String! title: String! detail: String status: String! createdAt: String! completedAt: String }
 type AgentRun { id: ID! projectId: ID! conversationId: ID mode: String! status: String! summary: String errorSummary: String versionId: ID steps: [AgentStep!]! createdAt: String! updatedAt: String! completedAt: String }
 type ProjectVersion { id: ID! projectId: ID! source: String! summary: String! createdBy: String! agentRunId: ID bookmarked: Boolean! sourceHash: String! previewHtml: String files: [SourceFile!]! createdAt: String! }
 type ProjectNotification { id: ID! projectId: ID! kind: String! title: String! detail: String read: Boolean! createdAt: String! }
 type Project { id: ID! name: String! brief: String! status: String! lifecycle: String! buildState: String! publishState: String! previewState: String! buildStep: String previewUrl: String deploymentUrl: String deploymentId: String providerProjectId: String publicVerified: Boolean! deploymentStatus: String paid: Boolean! html: String previewHtml: String coverImageUrl: String files: [SourceFile!]! research: String sources: [ResearchSource!]! validationStatus: String! validationProvider: String buildLog: String buildError: String knowledge: ProjectKnowledge! versions: [ProjectVersion!]! agentRuns: [AgentRun!]! notifications: [ProjectNotification!]! createdAt: String! updatedAt: String! }
 type Payment { id: ID! projectId: ID! amount: Int! currency: String! status: String! checkoutUrl: String createdAt: String! paidAt: String fulfillmentStatus: String fulfillmentError: String }
 type FulfillmentJob { id: ID! projectId: ID! paymentId: ID sourceHash: String! status: String! providerProjectId: String deploymentId: String deploymentUrl: String publicVerified: Boolean! error: String attempts: Int! createdAt: String! updatedAt: String! completedAt: String }
 type EmailStatus { configured: Boolean! provider: String! sender: String! webhookConfigured: Boolean! }
 type EmailDelivery { id: ID! kind: String! recipientMasked: String! subject: String! status: String! providerId: String attempts: Int! error: String createdAt: String! updatedAt: String! deliveredAt: String }
 type DomainQuote { id: ID! projectId: ID! domain: String! supported: Boolean! available: Boolean! currency: String! purchasePrice: Float renewalPrice: Float amount: Int years: Int! quotedAt: String! expiresAt: String! reason: String status: String! contactSchemaJson: String }
 type DomainVerification { type: String! domain: String! value: String! reason: String! }
 type DomainPayment { id: ID! quoteId: ID! projectId: ID! domain: String! amount: Int! currency: String! status: String! checkoutUrl: String createdAt: String! paidAt: String fulfillmentStatus: String error: String orderId: String verification: [DomainVerification!]! autoRenew: Boolean! years: Int! connectedAt: String }
 type DomainState { quotes: [DomainQuote!]! payments: [DomainPayment!]! }
 input DomainContactInput { firstName: String! lastName: String! email: String! phone: String! address1: String! address2: String city: String! state: String! zip: String! country: String! companyName: String fax: String additionalJson: String }
 type Pricing { configured: Boolean! amount: Int currency: String! mode: String }
 type BlogPost { id: ID! title: String! slug: String! excerpt: String! content: String! status: String! coverImage: String createdAt: String! publishedAt: String author: String! }
 type Memory { id: ID! title: String! content: String! projectId: ID publicApproved: Boolean! createdAt: String! }
 type Integration { id: ID! name: String! status: String! detail: String! }
 type Platform { name: String! integrations: [Integration!]! }
 type OutlierDiagnostics { ok: Boolean! summary: String! model: String! conversationId: String cookiePresent: Boolean! csrfTokenPresent: Boolean! autoCreateConversation: Boolean! }
 type OutlierPingResult { ok: Boolean! status: Int! model: String! conversationId: String detail: String! }
 type Settings { aiProvider: AIProvider! aiFallbackEnabled: Boolean! outlierModel: String! autoBlogEnabled: Boolean! blogHour: Int! lastBlogDate: String lastBlogError: String }
 type AdminOverview { users: Int! projects: Int! conversations: Int! publishedPosts: Int! }
 type CreditWallet { available:Float! reserved:Float! balance:Float! held:Boolean! debt:Float! }
 type CreditHistoryEntry { id:ID! kind:String! amount:Int! action:String! description:String! createdAt:String! }
 type CreditOffer { id:ID! name:String! credits:Int! amount:Int! currency:String! interval:String }
 type BillingCatalog { configured:Boolean! mode:String packs:[CreditOffer!]! plans:[CreditOffer!]! }
 type CreditCosts { enabled:Boolean! build:Int! edit:Int! images:Int! research:Int! }
 type BillingAccount { portalAvailable:Boolean! status:String! planId:ID currentPeriodEnd:String cancelAtPeriodEnd:Boolean! }
 type HostedCheckout { url:String! }
 type AdminWallet { id:ID! username:String! available:Float! reserved:Float! held:Boolean! subscriptionStatus:String! }
 type OperatorToken { id:ID! label:String! tokenPrefix:String! permissions:[String!]! expiresAt:String! revokedAt:String lastUsedAt:String createdAt:String! }
 type IssuedOperatorToken { token:String! record:OperatorToken! }
 type ConfirmedFact { field:String! value:String! source:String! confirmedAt:String! }
 input ConfirmedFactInput { field:String! value:String! source:String }
 type Lead { id:ID! businessName:String! industry:String! locality:String! normalizedPhone:String email:String existingWebsite:String websiteDomain:String websiteStatus:String! source:String! confirmedFacts:[ConfirmedFact!]! missingFields:[String!]! internalNotes:String! consentStatus:String! consentProvenance:String! consentUpdatedAt:String! optedOutAt:String createdAt:String! updatedAt:String! }
 type Proposal { id:ID! leadId:ID! projectId:ID! publicSlug:String! businessName:String! industry:String! locality:String! status:String! generationMode:String! leadScore:String! buildVerified:Boolean templateVertical:String templateVersion:String templateVariant:String costAiUnits:Int costBuildUnits:Int specJson:String confirmedFacts:[ConfirmedFact!]! missingFields:[String!]! whatsappPhone:String desktopScreenshotUrl:String! mobileScreenshotUrl:String! welcomeConversationId:ID! claimCodePrefix:String claimExpiresAt:String claimRevokedAt:String claimInvitedContact:String claimedByUserId:ID claimedAt:String agencyCostUnits:Int! lastError:String viewedAt:String viewCount:Int! createdAt:String! updatedAt:String! }
 type PreparedProposalResult { lead:Lead! proposal:Proposal! projectId:ID! claimCode:String! deduplicated:Boolean! }
 type IssuedClaimCodeResult { proposal:Proposal! claimCode:String }
 type ProposalDeliveryInfo { proposalId:ID! leadId:ID! businessName:String! publicSlug:String! publicUrl:String! claimCode:String status:String! claimExpiresAt:String reissued:Boolean! claimed:Boolean! message:String }
 type PublicProposalView { id:ID leadId:ID projectId:ID publicSlug:String! businessName:String! industry:String! locality:String! normalizedPhone:String existingWebsite:String status:String! demoNotice:String! customizationGuide:String! confirmedFacts:[ConfirmedFact!]! missingFields:[String!]! missingFacts:[String!]! whatsappHref:String desktopScreenshotUrl:String! mobileScreenshotUrl:String! desktopScreenshotSvg:String mobileScreenshotSvg:String previewHtml:String! navigablePreviewHtml:String! welcomeConversationId:ID! welcomeMessage:String welcomeMessages:[Message!]! optedOut:Boolean! claimed:Boolean! buildVerified:Boolean createdAt:String }
 type ClaimOtpResponse { sent:Boolean! success:Boolean maskedContact:String! maskedTarget:String expiresInSeconds:Int! testOtp:String }
 type ClaimWebsiteResult { projectId:ID! proposal:Proposal! alreadyClaimedByMe:Boolean! success:Boolean conversationId:String message:String }
  type ContactOptOutResult { id:ID! contact:String! status:String! }
 type AdbDeviceInfo { serial:String! state:String! model:String! canSendSms:Boolean! smsCapable:Boolean limitation:String }
 input AdbDeviceInfoInput { serial:String! state:String! model:String! canSendSms:Boolean! limitation:String }
 type OperatorDevice { id:ID! name:String! platform:String! version:String! status:String! tokenPrefix:String! capabilities:[String!]! allowedRoots:[String!]! adbStatus:String! adbDevices:[AdbDeviceInfo!]! lastHeartbeatAt:String revokedAt:String createdAt:String! updatedAt:String! }
 type DevicePairingResult { id:ID ticketId:ID! pairingCode:String! label:String allowedRoots:[String!]! expiresAt:String! }
 type PairedDeviceSession { deviceToken:String! device:OperatorDevice! }
 type OperatorJob { id:ID! actorId:ID! kind:String! targetType:String! targetId:String deviceId:ID idempotencyKey:String! status:String! requiresApproval:Boolean! approvedBy:ID approvedAt:String argsJson:String! output:String error:String exitCode:Int heartbeatAt:String timeoutMs:Int! startedAt:String completedAt:String createdAt:String! updatedAt:String! }
 type OutboundMessage { id:ID! leadId:ID proposalId:ID kind:String! adapter:String! deviceId:ID recipientPhone:String! body:String! proposalUrl:String optOutInfo:String! status:String! idempotencyKey:String! approvedBy:ID approvedAt:String deviceJobId:ID providerMessageId:String capabilityReport:String error:String createdAt:String! updatedAt:String! }
 type AgencyBudget { perDemoMaxUnits:Int! dailyMaxUnits:Int! spentTodayUnits:Int! totalSpentUnits:Int! demosBuiltToday:Int! day:String! }
 type OperatorDemoBudget { day:String totalBuilds:Int todayBuilds:Int dailyLimit:Int maxBuildsPerProposal:Int remainingToday:Int }
 type PlatformChange { id:ID! title:String! targetPath:String! diffText:String! diff:String verificationPassed:Boolean! verificationOk:Boolean verificationReport:String! verificationLog:String status:String! approvedBy:ID approvedAt:String rolledBackAt:String createdAt:String! updatedAt:String! }
 type OperatorSummary { usersCount:Int! projectsCount:Int! activeBuildsCount:Int! failedProjectsCount:Int! conversationsCount:Int! leadsCount:Int! proposalsCount:Int! proposalsByStateJson:String! devicesOnlineCount:Int! devicesTotalCount:Int! adbConnectedCount:Int! runningJobsCount:Int! awaitingApprovalJobsCount:Int! messagesCount:Int! agencyBudget:AgencyBudget! generatedAt:String! }
 type OperatorToolActivity { tool:String! ok:Boolean! summary:String! dataJson:String! }
 type OperatorMessage { id:ID! role:String! authorName:String! content:String! createdAt:String! }
 type OperatorConversation { id:ID! title:String! status:String! agentStatus:String messages:[OperatorMessage!]! createdAt:String! updatedAt:String! }
 type OperatorTurnResult { conversation:OperatorConversation! reply:OperatorMessage! jobId:ID! toolActivities:[OperatorToolActivity!]! }

  type OperatorChatTurnToolResult { tool:String! ok:Boolean! summary:String! dataJson:String! }
  type OperatorChatTurnResult { conversationId:ID! reply:String! toolResults:[OperatorChatTurnToolResult!]! }
  type OperatorTaskEvent { sequence:Int! kind:String! message:String! dataJson:String! createdAt:String! }
  type OperatorTask { id:ID! conversationId:ID! status:String! progress:String reply:String error:String lastSequence:Int! queuePosition:Int! toolResults:[OperatorChatTurnToolResult!]! createdAt:String! updatedAt:String! startedAt:String completedAt:String }
  input OperatorToolCallInput { tool:String! argumentsJson:String argsJson:String }
  input LeadInput { id:ID businessName:String! industry:String locality:String phone:String email:String existingWebsite:String consentStatus:String consentProvenance:String notes:String internalNotes:String }
  input ProposalCreateInput { leadId:ID businessName:String summary:String customBrief:String mode:String }
  type CreatedProposalPayload { proposal:Proposal claimCode:String validationErrors:[String!] }
  input ProposalInvitationInput { proposalId:ID! channel:String deviceId:ID customBody:String }

 type Query { operatorTaskEvents(id:ID!,after:Int=0,limit:Int=100):[OperatorTaskEvent!]! operatorTask(id:ID!):OperatorTask! wallet:CreditWallet! creditHistory(limit:Int=100,offset:Int=0):[CreditHistoryEntry!]! billingCatalog:BillingCatalog! creditCosts:CreditCosts! billingAccount:BillingAccount! adminWallets:[AdminWallet!]! me: User platform: Platform! conversations: [Conversation!]! conversation(id:ID!):Conversation projects:[Project!]! project(id:ID!):Project projectVersion(projectId:ID!,versionId:ID!):ProjectVersion projectPreview(projectId:ID!,path:String!,versionId:ID):String payments:[Payment!]! pricing:Pricing! fulfillmentJobs(projectId:ID):[FulfillmentJob!]! emailStatus:EmailStatus! adminEmailDeliveries:[EmailDelivery!]! domainQuotes:[DomainQuote!]! domainPayments:[DomainPayment!]! blogPosts:[BlogPost!]! blogPost(slug:String!):BlogPost memories:[Memory!]! adminOverview:AdminOverview! adminUsers:[User!]! adminAudit:[AuditEntry!]! settings:Settings! outlierDiagnostics:OutlierDiagnostics! operatorSummary:OperatorSummary! operatorPlatformStatus:String! operatorDemoBudget:OperatorDemoBudget! operatorPlatformChanges:[PlatformChange!]! operatorMessages:[OutboundMessage!]! operatorLeads(search:String):[Lead!]! operatorProposals:[Proposal!]! operatorTokens:[OperatorToken!]! operatorConversations:[OperatorConversation!]! operatorConversation(id:ID!):OperatorConversation leads:[Lead!]! lead(id:ID!):Lead proposals:[Proposal!]! proposal(id:ID!):Proposal proposalDeliveryInfo(proposalId:ID!,forceReissue:Boolean):ProposalDeliveryInfo! publicProposal(slug:String!,path:String,interactiveVisit:Boolean=true):PublicProposalView! operatorDevices:[OperatorDevice!]! operatorJobs(status:String,deviceId:ID):[OperatorJob!]! outboundMessages(proposalId:ID):[OutboundMessage!]! agencyBudget:AgencyBudget! platformChanges:[PlatformChange!]! }
 type Mutation { startOperatorTask(conversationId:ID,text:String!,requestId:String):OperatorTask! stopOperatorTask(id:ID!):OperatorTask! purchaseCredits(sku:ID!):HostedCheckout! subscribePlan(planId:ID!):HostedCheckout! openBillingPortal:HostedCheckout! adminGrantCredits(userId:ID!,amount:Int!,reason:String!,idempotencyKey:String!):CreditWallet!
 register(username:String!,password:String!,recoveryEmail:String!):User!
 login(username:String!,password:String!):User!
 logout:Boolean!
 requestPasswordReset(username:String!):Boolean!
 resetPassword(token:String!,password:String!):Boolean!
 createConversation(mode:ChatMode=STARLI,title:String,projectId:ID):Conversation!
 sendMessage(conversationId:ID!,content:String!,maxCredits:Int=0,requestId:ID,actionMode:AgentActionMode=AUTO,selectedElementContext:String,attachments:[ChatAttachmentInput!]):Message!
 createProject(name:String!,brief:String!):Project!
 updateProject(id:ID!,name:String,brief:String):Project!
 updateProjectKnowledge(projectId:ID!,input:ProjectKnowledgeInput!):Project!
 updateProjectFile(projectId:ID!,path:String!,content:String!,summary:String):Project!
 inlineTextEdit(projectId:ID!,originalText:String!,replacementText:String!):Project!
 restoreProjectVersion(projectId:ID!,versionId:ID!):Project!
 bookmarkProjectVersion(projectId:ID!,versionId:ID!,bookmarked:Boolean!):Project!
 markProjectNotificationsRead(projectId:ID!,notificationId:ID):Project!
 runProjectResearch(projectId:ID!,maxCredits:Int=0,requestId:ID):Project!
 deleteProject(id:ID!):Boolean!
 buildProject(id:ID!,maxCredits:Int=0,requestId:ID,regenerateImages:Boolean=false,summary:String,selectedElementContext:String):Project!
 verifyProject(id:ID!):Project!
 deployProject(id:ID!):Project!
 refreshDeployment(id:ID!):Project!
 retryFulfillment(id:ID!):FulfillmentJob!
 testEmail(to:String!):EmailDelivery!
 retryEmail(id:ID!):EmailDelivery!
 createDomainQuote(projectId:ID!,domain:String!,years:Int=1):DomainQuote!
 createDomainCheckout(quoteId:ID!,autoRenew:Boolean!,consent:Boolean!,contactInformation:DomainContactInput!):DomainPayment!
 createCheckout(projectId:ID!):Payment!
 saveBlogPost(id:ID,title:String!,excerpt:String!,content:String!,coverImage:String):BlogPost!
 publishBlogPost(id:ID!):BlogPost!
 unpublishBlogPost(id:ID!):BlogPost!
 deleteBlogPost(id:ID!):Boolean!
 generateBlogPost:BlogPost!
 saveMemory(title:String!,content:String!,projectId:ID,publicApproved:Boolean!):Memory!
 deleteMemory(id:ID!):Boolean!
 setMemoryPublic(id:ID!,publicApproved:Boolean!):Memory!
 updateSettings(autoBlogEnabled:Boolean!,blogHour:Int!,aiProvider:AIProvider,aiFallbackEnabled:Boolean,outlierModel:String):Settings!
 setAIProvider(provider:AIProvider!,fallbackToOpenAI:Boolean):Settings!
 updateOutlierConfig(model:String,cookie:String,csrfToken:String,conversationId:String):OutlierDiagnostics!
 pingOutlierConnection(rotateIfNeeded:Boolean=false):OutlierPingResult!
 setUserDisabled(id:ID!,disabled:Boolean!):User!
 createOperatorToken(label:String!,permissions:[String!],ttlHours:Int):IssuedOperatorToken!
  issueOperatorToken(label:String!,permissions:[String!],expiresInDays:Int,ttlHours:Int):IssuedOperatorToken!
 revokeOperatorToken(id:ID!):OperatorToken!
 sendOperatorTurn(conversationId:ID,prompt:String!):OperatorTurnResult!
 invokeOperatorTool(tool:String!,argsJson:String!):OperatorToolActivity!
 upsertLead(id:ID,businessName:String!,industry:String,locality:String,phone:String,email:String,existingWebsite:String,source:String,internalNotes:String,consentStatus:String,consentProvenance:String,confirmedFacts:[ConfirmedFactInput!],missingFields:[String!]):Lead!
 prepareProposalDemo(leadId:ID,businessName:String,industry:String,locality:String,phone:String,email:String,existingWebsite:String,includeWhatsapp:Boolean=true,customBrief:String,consentStatus:String,consentProvenance:String,mode:String):PreparedProposalResult!
 promoteProposal(proposalId:ID!,targetMode:String,toMode:String):Proposal!

  operatorChatTurn(conversationId:ID,text:String!):OperatorChatTurnResult!
  executeOperatorTool(input:OperatorToolCallInput!):OperatorToolActivity!
  upsertOperatorLead(input:LeadInput!):Lead!
  createOperatorProposal(input:ProposalCreateInput!):CreatedProposalPayload!
  revokeProposalClaim(proposalId:ID!,reason:String):Proposal
  createDevicePairingCode(label:String!,allowedRoots:[String!],ttlMinutes:Int=15):DevicePairingResult!
  enqueuePrivilegedPowerShellTask(deviceId:ID!,command:String!,reason:String!):OperatorJob!
  prepareOperatorProposalInvitation(input:ProposalInvitationInput!):OutboundMessage!
  approveOperatorMessage(messageId:ID!):OutboundMessage!
  dispatchOperatorMessage(messageId:ID!):OutboundMessage!
  stageOperatorPlatformChange(title:String!,targetPath:String!,proposedContent:String!,originalContent:String,verificationCmd:String):PlatformChange!
  approveOperatorPlatformChange(changeId:ID!):PlatformChange!
  rollbackOperatorPlatformChange(changeId:ID!):PlatformChange!

 updateProposalStatus(proposalId:ID!,status:String!,errorDetail:String):Proposal!
 rotateProposalClaimCode(proposalId:ID!,revokeOnly:Boolean=false,ttlHours:Int=336):IssuedClaimCodeResult!
 issueProposalDelivery(proposalId:ID!,forceReissue:Boolean):ProposalDeliveryInfo!
 sendProposalVisitorMessage(publicSlug:String!,content:String!):Message!
 optOutPublicProposal(publicSlug:String!,reason:String):Boolean!
 requestProposalClaimOtp(publicSlug:String,slug:String,claimCode:String!,contact:String):ClaimOtpResponse!
  recordContactOptOut(contact:String!,channel:String,reason:String):ContactOptOutResult!
 claimProposalWebsite(publicSlug:String,slug:String,claimCode:String!,otpCode:String,otp:String):ClaimWebsiteResult!
 createDevicePairing(label:String!,allowedRoots:[String!],ttlMinutes:Int=15):DevicePairingResult!
 pairWindowsDevice(pairingCode:String!,deviceName:String,platform:String,version:String,capabilities:[String!],allowedRoots:[String!]):PairedDeviceSession!
  completeDevicePairing(pairingCode:String!,name:String,deviceName:String,platform:String,version:String,capabilities:[String!]):PairedDeviceSession!
 deviceHeartbeat(deviceToken:String!,version:String,capabilities:[String!],adbStatus:String,adbDevices:[AdbDeviceInfoInput!]):OperatorDevice!
 revokeOperatorDevice(deviceId:ID!):OperatorDevice!
 enqueueDeviceJob(deviceId:ID!,kind:String!,argsJson:String!,idempotencyKey:String):OperatorJob!
 reportDeviceJob(deviceToken:String!,jobId:ID!,leaseToken:String,status:String!,output:String,error:String,exitCode:Int):OperatorJob!
 approveOperatorJob(jobId:ID!):OperatorJob!
 cancelOperatorJob(jobId:ID!,reason:String):OperatorJob!
 prepareProposalSms(proposalId:ID!,adapter:String,deviceId:ID,customBody:String,idempotencyKey:String):OutboundMessage!
 approveOutboundMessage(messageId:ID!):OutboundMessage!
 reportAdbSmsOutcome(messageId:ID!,outcome:String!,detail:String!):OutboundMessage!
 updateAgencyBudget(perDemoMaxUnits:Int!,dailyMaxUnits:Int!):AgencyBudget!
 stagePlatformChange(title:String!,targetPath:String!,originalContent:String!,proposedContent:String!):PlatformChange!
 approvePlatformChange(changeId:ID!):PlatformChange!
 rollbackPlatformChange(changeId:ID!):PlatformChange!
 }
 type Subscription { walletUpdated:CreditWallet! conversationUpdated(id:ID!):Conversation! conversationsUpdated:[Conversation!]! projectsUpdated:[Project!]! projectUpdated(id:ID!):Project paymentsUpdated:[Payment!]! memoriesUpdated:[Memory!]! blogUpdated:[BlogPost!]! platformUpdated:Platform! fulfillmentUpdated(projectId:ID):[FulfillmentJob!]! emailDeliveriesUpdated:[EmailDelivery!]! domainsUpdated:DomainState! operatorConversationUpdated(id:ID!):OperatorConversation! operatorDevicesUpdated:[OperatorDevice!]! operatorJobsUpdated:[OperatorJob!]! proposalsUpdated:[Proposal!]! leadsUpdated:[Lead!]! outboundMessagesUpdated:[OutboundMessage!]! }
`;
function deepMergeResolvers(...resolverMaps: any[]) {
  const merged: Record<string, any> = {};
  for (const map of resolverMaps) {
    if (!map || typeof map !== 'object') continue;
    for (const [typeKey, typeVal] of Object.entries(map)) {
      if (typeof typeVal === 'object' && typeVal !== null && !Array.isArray(typeVal)) {
        merged[typeKey] = { ...(merged[typeKey] || {}), ...typeVal };
      } else {
        merged[typeKey] = typeVal;
      }
    }
  }
  return merged;
}

export function createAppSchema(store:Store,events:Events,options:{customerCapabilityRuntime?:CustomerCapabilityRuntime;conversationGoalPlanner?:ConversationGoalPlanner}={}) {
  const walletFor=(userId:string)=>{const w=creditsWallet(store,creditOwnerId(userId));return {...w,balance:w.available+w.reserved,held:w.debt>0||billingAccount(store,userId).blocked};};
  const accountFor=(userId:string)=>{const a=billingAccount(store,userId);const sub=a.subscription;return {portalAvailable:a.customerConfigured,status:sub?.status==='active'&&sub.currentPeriodEnd&&Date.parse(sub.currentPeriodEnd)<=Date.now()?'pending_renewal':sub?.status||'none',planId:sub?.planId||null,currentPeriodEnd:sub?.currentPeriodEnd||null,cancelAtPeriodEnd:!!sub?.cancelAtPeriodEnd};};
  const platform=()=>({name:'Starlidigital',integrations:integrations(store)});
  const own=(collection:string,ctx:Context)=>{refresh(ctx);return ctx.user?.role==='ADMIN'?store.list(collection):ctx.user||ctx.guest?store.list(collection,ctx.user?.id||ctx.guest):[];};
  const jobs=(ctx:Context,projectId?:string)=>{requireUser(ctx);if(projectId)access(ctx,store.get('projects',projectId));return own('fulfillment-jobs',ctx).filter(job=>!projectId||job.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));};
  const posts=(ctx:Context)=>{refresh(ctx);return store.list('posts').filter(p=>p.status==='PUBLISHED'||ctx.user?.role==='ADMIN').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));};
  const conversationChange=(record:RecordData)=>{events.publish('conversation:'+record.id);events.publish('conversations');};
  const message=(role:string,content:string,authorName:string)=>({id:id(),role,content,createdAt:now(),authorName});
  const runningChats=new Set<string>();const runningBuilds=new Set<string>();const runningDeploys=new Set<string>();const runningCheckouts=new Set<string>();
  const workerQueue=new SerialQueue();
  const verifySources=(files:import('./next-template.js').SourceFile[])=>workerQueue.run(async()=>{const {verifyNextProject}=await import('./next-worker.js');return verifyNextProject(files);});
  const rememberVerifiedProject=(project:RecordData,provider:'DOCKER'|'VERCEL')=>{
    if(!Array.isArray(project.files)||!project.files.length)return;
    const memoryId=`project-${project.id}-${sourceHash(project.files)}-${provider}`;if(store.get('memories',memoryId))return;
    const images=project.files.filter((file:any)=>file.encoding==='base64').length;
    store.put('memories',{id:memoryId,projectId:project.id,title:provider==='DOCKER'?'Proiect Next.js — build verificat':'Proiect Next.js — publicare confirmată',content:`Un proiect React, Next.js și TypeScript a trecut verificarea reală prin ${provider==='DOCKER'?'workerul Docker izolat':'Vercel, cu starea READY'}. Sursa conține ${project.files.length} fișiere, dintre care ${images} imagini PNG. Acesta este un rezumat tehnic, fără date comerciale, contacte, conținutul conversației sau cod sursă. Publicarea acestui rezumat necesită aprobarea administratorului.`,publicApproved:false,createdAt:now()});events.publish('memories');
  };
  const audit=(ctx:Context,action:string,target:string)=>store.put('audit',{id:id(),actor:ctx.user?.id||'anonymous',action,target,createdAt:now()});
  const admitBuild=(ctx:Context)=>{
    refresh(ctx);const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const parseCap=(value:string|undefined,fallback:number)=>value!==undefined&&/^\d+$/.test(value)?Math.min(10000,Number(value)):fallback;
    const globalCap=parseCap(process.env.GLOBAL_DAILY_BUILD_LIMIT,100),anonymousCap=parseCap(process.env.ANONYMOUS_DAILY_BUILD_LIMIT,20);const anonymous=!ctx.user;
    limit('build:'+ctx.ip,3,3600000);const nested=store.db.isTransaction;store.db.exec(nested?'SAVEPOINT build_admission':'BEGIN IMMEDIATE');
    try{const record=store.get('usage-limits','builds-'+day)||{id:'builds-'+day,global:0,anonymous:0};if(record.global>=globalCap||(anonymous&&record.anonymous>=anonymousCap))fail('Limita zilnică de construire a fost atinsă. Reîncearcă mâine sau contactează-l pe Alex.','RATE_LIMITED');store.put('usage-limits',{...record,global:record.global+1,anonymous:record.anonymous+(anonymous?1:0),updatedAt:now()});store.db.exec(nested?'RELEASE SAVEPOINT build_admission':'COMMIT');}catch(error){if(nested){store.db.exec('ROLLBACK TO SAVEPOINT build_admission');store.db.exec('RELEASE SAVEPOINT build_admission');}else store.db.exec('ROLLBACK');throw error;}
  };
  const admitChargedBuild=(ctx:Context,input:Parameters<typeof reserveCreditAction>[2])=>{store.db.exec('BEGIN IMMEDIATE');try{const key=reserveCreditAction(store,ctx,input);admitBuild(ctx);store.db.exec('COMMIT');return key;}catch(error){store.db.exec('ROLLBACK');throw error;}};
  const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
  const defaultKnowledge=(record:RecordData)=>({
    businessSummary:record.knowledge?.businessSummary||record.name||'',
    audience:record.knowledge?.audience||'',
    goals:record.knowledge?.goals||'Prezență digitală, credibilitate și conversie clienți',
    brandDirection:record.knowledge?.brandDirection||'Editorial, curat, modern, în limba română',
    language:record.knowledge?.language||'Română',
    technicalRules:record.knowledge?.technicalRules||'Next.js App Router, React 19, TypeScript strict, responsive mobile-first',
    customInstructions:record.knowledge?.customInstructions||'',
    updatedAt:record.knowledge?.updatedAt||record.updatedAt||now()
  });
  const createVersionRecord=(project:RecordData,files:import('./next-template.js').SourceFile[],previewHtml:string|null,opts:{source:string;summary:string;createdBy:string;agentRunId?:string})=>{
    const ver={
      id:id(),
      projectId:project.id,
      source:opts.source,
      summary:opts.summary.slice(0,220),
      createdBy:opts.createdBy,
      agentRunId:opts.agentRunId||null,
      bookmarked:false,
      sourceHash:sourceHash(files),
      previewHtml:previewHtml||null,
      files:files.map(f=>({...f})),
      createdAt:now()
    };
    const existing=Array.isArray(project.versions)?project.versions:[];
    return {ver,versions:[ver,...existing].slice(0,25)};
  };
  const appendNotification=(proj:RecordData,kind:string,title:string,detail?:string)=>{
    const item={id:id(),projectId:proj.id,kind,title:title.slice(0,180),detail:detail?detail.slice(0,280):null,read:false,createdAt:now()};
    const list=Array.isArray(proj.notifications)?proj.notifications:[];
    proj.notifications=[item,...list].slice(0,40);
    return item;
  };
  const launchBuild=(record:RecordData,regenerateImages=false,opts:{conversationId?:string;summary?:string;selectedElementContext?:string|null;creditKey?:string|null}={})=>{const projectId=record.id;
        void(async()=>{
          let generated=false;let completed=false;
          const runId=id();
          const initialStep={id:id(),category:'inspect',title:'Analizez proiectul și direcția de brand',detail:record.name,status:'running',createdAt:now(),completedAt:null};
          const newRun:RecordData={id:runId,projectId,conversationId:opts.conversationId||null,mode:'BUILD',status:'running',summary:opts.summary||(Array.isArray(record.files)&&record.files.length?'Actualizare website':'Construcție inițială website'),errorSummary:null,versionId:null,steps:[initialStep],createdAt:now(),updatedAt:now(),completedAt:null};
          const pushRunUpdate=(updater:(run:RecordData,proj:RecordData)=>void)=>{
            const cur=store.get('projects',projectId);if(!cur)return;
            const runs=Array.isArray(cur.agentRuns)?[...cur.agentRuns]:[];
            const idx=runs.findIndex((r:any)=>r.id===runId);
            const targetRun=idx>=0?{...runs[idx],steps:[...(runs[idx].steps||[])]}:{...newRun,steps:[...newRun.steps]};
            updater(targetRun,cur);
            targetRun.updatedAt=now();
            if(idx>=0)runs[idx]=targetRun;else runs.unshift(targetRun);
            cur.agentRuns=runs.slice(0,20);
            cur.updatedAt=now();
            store.put('projects',cur);
            events.publish('projects');
          };
          pushRunUpdate((_r,proj)=>{appendNotification(proj,'build','Starli a pornit construcția website-ului',opts.summary||'Pregătim structura, designul și codul Next.js.');});
          try{
            const cfg=settings(store);
            const setStep=(buildStep:string,category='edit',detail?:string)=>{
              pushRunUpdate((run,proj)=>{
                proj.buildStep=buildStep;
                for(const s of run.steps)if(s.status==='running'){s.status='success';s.completedAt=now();}
                run.steps.push({id:id(),category,title:buildStep,detail:detail||null,status:'running',createdAt:now(),completedAt:null});
                if(category==='document')appendNotification(proj,'research','Analiza competiției și direcția au fost salvate',detail||'Document disponibil în studio');
              });
            };
            const {buildNextSite}=await import('./site-builder.js');
            const output=await buildNextSite(record.brief,record.name,{
              provider:cfg.aiProvider,
              fallbackToOpenAI:cfg.aiFallbackEnabled,
              existingFiles:Array.isArray(record.files)?record.files:[],
              existingResearch:record.research&&Array.isArray(record.sources)?{summary:record.research,sources:record.sources}:undefined,
              projectKnowledge:defaultKnowledge(record),
              selectedElementContext:opts.selectedElementContext||null,
              regenerateImages,
              onStep:setStep
            });
            const curBeforeSave=store.get('projects',projectId)!;
            const previewDoc=output.previewHtml||curBeforeSave.previewHtml||null;
            const {ver,versions}=createVersionRecord(curBeforeSave,output.files,previewDoc,{
              source:'agent',
              summary:opts.summary||(Array.isArray(record.files)&&record.files.length?'Versiune actualizată de Starli':'Versiune inițială construită de Starli'),
              createdBy:'Starli AI',
              agentRunId:runId
            });
            const runs=Array.isArray(curBeforeSave.agentRuns)?[...curBeforeSave.agentRuns]:[newRun];
            const rIdx=runs.findIndex((r:any)=>r.id===runId);
            if(rIdx>=0){
              for(const s of runs[rIdx].steps)if(s.status==='running'){s.status='success';s.completedAt=now();}
              runs[rIdx]={...runs[rIdx],status:process.env.NEXT_WORKER_ENABLED==='true'?'running':'success',versionId:ver.id,updatedAt:now(),completedAt:process.env.NEXT_WORKER_ENABLED==='true'?null:now()};
            }
            appendNotification(curBeforeSave,'version','Versiune nouă construită de Starli AI',ver.summary);
            store.put('projects',{...curBeforeSave,files:output.files,previewHtml:previewDoc,html:null,research:output.research||curBeforeSave.research||null,sources:output.sources||curBeforeSave.sources||[],versions,agentRuns:runs,notifications:curBeforeSave.notifications,validationProvider:null,validationStatus:'NOT_RUN',buildLog:null,status:'SOURCE_READY',buildStep:'Sursa Next.js este gata.',buildError:null,updatedAt:now()});
            generated=true;events.publish('projects');
            if(process.env.NEXT_WORKER_ENABLED==='true'){
              pushRunUpdate((run,proj)=>{
                proj.status='VERIFYING';
                proj.buildStep='Compilăm și verificăm proiectul Next.js în containerul Docker izolat…';
                proj.validationStatus='PENDING';
                proj.validationProvider='DOCKER';
                run.steps.push({id:id(),category:'test',title:'Verific build-ul în containerul izolat Docker',detail:'Next.js 16 build + static snapshot',status:'running',createdAt:now(),completedAt:null});
              });
              const verified=await verifySources(output.files);
              pushRunUpdate((run,proj)=>{
                for(const s of run.steps)if(s.status==='running'){s.status='success';s.completedAt=now();}
                run.status='success';
                run.completedAt=now();
                proj.status='PREVIEW';
                proj.buildStep=null;
                proj.validationStatus=verified.validationStatus;
                proj.validationProvider=verified.validationProvider;
                proj.previewHtml=verified.previewHtml||proj.previewHtml||null;
                proj.buildLog=verified.buildLog;
                proj.buildError=null;
                appendNotification(proj,'verified','Verificarea Docker Next.js s-a încheiat cu succes','Preview-ul compilat este pregătit.');
              });
              rememberVerifiedProject(store.get('projects',projectId)!,'DOCKER');
            }
            completed=true;
          }catch(error){
            const errMsg=error instanceof Error?error.message:'Construcția a eșuat.';
            pushRunUpdate((run,proj)=>{
              for(const s of run.steps)if(s.status==='running'){s.status='error';s.completedAt=now();}
              run.status='error';
              run.errorSummary=errMsg;
              run.completedAt=now();
              // Preserve last known good files and previewHtml when a rebuild fails!
              proj.status=generated?'BUILD_FAILED':'FAILED';
              proj.buildStep=null;
              proj.validationStatus=generated?'FAILED':proj.validationStatus||'NOT_RUN';
              proj.buildError=errMsg;
              appendNotification(proj,'error','Construcția a întâmpinat o eroare',errMsg);
            });
          }finally{finishCreditAction(store,opts.creditKey||null,completed);events.publish('wallet');runningBuilds.delete(projectId);events.publish('projects');}
        })();
  };
  const crmServices = new CrmServices(store, events);
  const crmGql = createCrmGraphQL({ services: crmServices });
  const mailboxServices = createAgencyMailbox({ store, events });
  const mailboxGql = createMailboxGraphQL({ services: mailboxServices });
  const assetServices = new AssetServices({ store, events });
  const assetGql = createAssetGraphQL({ services: assetServices });
  const videoServices = new VideoServices({ store, events, assetServices });
  const videoGql = createVideoGraphQL({ services: videoServices });
  const videoDirectorService = new VideoDirectorService({store,events,videoServices});
  const videoDirectorGql = createVideoDirectorGraphQL({service:videoDirectorService});
  const hostedAgentService=new HostedAgentService({store,events});
  const hostedAgentsGql=createHostedAgentGraphQL({service:hostedAgentService});
  const hostedProposalsGql=createHostedAgentProposalGraphQL({store,events,agentService:hostedAgentService});
  const agencyCockpitService=new AgencyCockpitService(store,hostedAgentService,events);
  const agencyCockpitGql=createAgencyCockpitGraphQL({service:agencyCockpitService});
  const approvalCenterGql=createApprovalCenterGraphQL({service:new ApprovalCenterService(store,events)});
  const businessEngineGql=createBusinessEngineGraphQL({store,events});
  ensureAgencyIntelligenceProjector(store,events);
  const socialProviders=new Map();const uploadPostKey=process.env.UPLOAD_POST_API_KEY?.trim();if(uploadPostKey)socialProviders.set('upload-post',new UploadPostAdapter(new UploadPostRestClient({apiKey:uploadPostKey}),uploadPostProfileForTenant));
  const socialPublishingService=new SocialPublishingService(new StoreSocialRepository(store),socialProviders,{authorize:async({externalWrite})=>externalWrite?{allowed:false,reason:'Customer social external execution is not enabled in this product build'}:{allowed:true}},{publish:(type,payload)=>{try{events.company({type,source:'social-publishing',entities:[],idempotencyKey:`social:${type}:${Date.now()}`,payload});}catch{}}});
  const socialPublishingGql=createSocialPublishingGraphQL({service:socialPublishingService});
  const customerCapabilityRuntime=(options.customerCapabilityRuntime??createCustomerCapabilityRuntime({store})).bindSchemaIdentity(`schema:${randomUUID()}`);
  const customerCapabilityGql=createCustomerCapabilityGraphQL({store,runtime:customerCapabilityRuntime});
  const machineryRuntime=createCanonicalMachineryExecutionRuntime({store,events,customerCapabilityRuntime});
  const governedChat=createStarliGovernedGraphQL({store,events,runtime:machineryRuntime,planner:options.conversationGoalPlanner});
  const machineryGql=createMachineryGraphQL({store,runtime:machineryRuntime});
  const mediaWorkspaceService=new MediaWorkspaceService({store,videoDirector:videoDirectorService,social:socialPublishingService});
  const starliAggregateGql=createStarliAggregateGraphQL({store,events,media:mediaWorkspaceService,connectorRegistry:customerCapabilityRuntime.connectorRegistry});

  return createSchema({
    typeDefs: [typeDefs, crmGql.typeDefs, mailboxGql.typeDefs, assetGql.typeDefs, videoGql.typeDefs, videoDirectorGql.typeDefs, hostedAgentsGql.typeDefs, hostedProposalsGql.typeDefs, agencyCockpitGql.typeDefs, approvalCenterGql.typeDefs, businessEngineGql.typeDefs, socialPublishingGql.typeDefs, customerCapabilityGql.typeDefs, machineryGql.typeDefs, governedChat.typeDefs, starliAggregateGql.typeDefs],
    resolvers: deepMergeResolvers(
      crmGql.resolvers,
      mailboxGql.resolvers,
      assetGql.resolvers,
      videoGql.resolvers,
      videoDirectorGql.resolvers,
      hostedAgentsGql.resolvers,
      hostedProposalsGql.resolvers,
      agencyCockpitGql.resolvers,
      approvalCenterGql.resolvers,
      businessEngineGql.resolvers,
      socialPublishingGql.resolvers,
      customerCapabilityGql.resolvers,
      machineryGql.resolvers,
      governedChat.resolvers,
      starliAggregateGql.resolvers,
      {
    User:{disabled:(user:RecordData)=>!!user.disabled},
    FulfillmentJob:{publicVerified:(job:RecordData)=>!!job.publicVerified,attempts:(job:RecordData)=>Number(job.attempts||0)},
    DomainPayment:{verification:(payment:RecordData)=>payment.verification||[]},
    Project:{
      coverImageUrl:(project:RecordData)=>{
        const hero=(project.files||[]).find((file:any)=>file.encoding==='base64'&&/^public\/(?:assets\/)?hero\.(png|jpe?g|webp)$/.test(file.path)&&typeof file.content==='string'&&file.content.length<=7000000);
        if(!hero)return null;
        const mime=hero.path.endsWith('.webp')?'image/webp':/\.jpe?g$/.test(hero.path)?'image/jpeg':'image/png';
        return `data:${mime};base64,${hero.content}`;
      },
      publicVerified:(project:RecordData)=>!!project.publicVerified,
      paid:(project:RecordData)=>paidForSource(store,project)||canUseSubscriptionHosting(store,project.ownerId,project.id),
      files:(project:RecordData)=>project.files||[],
      sources:(project:RecordData)=>project.sources||[],
      validationStatus:(project:RecordData)=>project.validationStatus||'NOT_RUN',
      lifecycle:(project:RecordData)=>project.lifecycle||'active',
      buildState:(project:RecordData)=>['BUILDING','VERIFYING'].includes(project.status)?'running':['FAILED','BUILD_FAILED'].includes(project.status)?'error':Array.isArray(project.files)&&project.files.length>0?'success':'idle',
      publishState:(project:RecordData)=>project.status==='LIVE'||project.deploymentStatus==='LIVE'?'live':project.status==='DEPLOYING'||project.deploymentStatus==='BUILDING'?'deploying':project.deploymentStatus==='FAILED'?'deployment_error':'never_deployed',
      previewState:(project:RecordData)=>project.previewHtml||(Array.isArray(project.files)&&project.files.length>0)?'ready':['BUILDING','VERIFYING'].includes(project.status)?'starting':'empty',
      previewHtml:(project:RecordData)=>{
        if(project.previewHtml)return project.previewHtml;
        if(Array.isArray(project.files)&&project.files.some((f:any)=>f.path==='app/page.tsx')){
          try{return renderNextPreviewHtml(project.files,{title:project.name});}catch{return null;}
        }
        return null;
      },
      knowledge:(project:RecordData)=>defaultKnowledge(project),
      versions:(project:RecordData)=>Array.isArray(project.versions)?project.versions:[],
      agentRuns:(project:RecordData)=>Array.isArray(project.agentRuns)?project.agentRuns:[],
      notifications:(project:RecordData)=>Array.isArray(project.notifications)?project.notifications:[],
      html:()=>null
    },
    AuditEntry:{actorName:(record:RecordData)=>store.user(record.actor)?.username||'Vizitator'},
    Query:{
      ...(crmGql.resolvers.Query || {}),
      ...(mailboxGql.resolvers.Query || {}),
      ...(assetGql.resolvers.Query || {}),
      operatorTaskEvents:(_:any,{id,after=0,limit=100}:any,ctx:Context)=>operatorTaskEvents(store,ctx,id,after,limit), operatorTask:(_:any,{id}:any,ctx:Context)=>operatorTask(store,ctx,id),
      wallet:(_:any,__:any,ctx:Context)=>walletFor(requireUser(ctx).id),
      creditCosts:creditCosts,billingCatalog:(_:any,__:any,ctx:Context)=>{const catalog=creditCatalog();return {...catalog,configured:catalog.configured&&sandboxCheckoutAllowed(refresh(ctx).user)};},
      creditHistory:(_:any,{limit=100,offset=0}:any,ctx:Context)=>creditLedger(store,creditOwnerId(requireUser(ctx).id),limit,offset).map(e=>({...e,action:String(e.metadata?.action||e.reason),description:({build:'Construire website',edit:'Modificare website',images:'Generare imagini',research:'Cercetare web'} as Record<string,string>)[e.reason]||e.reason,amount:['RESERVE','SETTLE','REVOKE'].includes(e.kind)?-e.amount:e.amount})),
      billingAccount:(_:any,__:any,ctx:Context)=>accountFor(requireUser(ctx).id),
      adminWallets:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.users().map(u=>({id:u.id,username:u.username,...walletFor(u.id),subscriptionStatus:accountFor(u.id).status}));},
      me:(_:any,__:any,ctx:Context)=>refresh(ctx).user||null,platform,
      conversations:(_:any,__:any,ctx:Context)=>own('conversations',ctx).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
      conversation:(_:any,{id}:any,ctx:Context)=>access(ctx,store.get('conversations',id)),
      projects:(_:any,__:any,ctx:Context)=>own('projects',ctx).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
      project:(_:any,{id}:any,ctx:Context)=>access(ctx,store.get('projects',id)),
      projectPreview:(_:any,{projectId,path,versionId}:any,ctx:Context)=>{
        const project=access(ctx,store.get('projects',projectId));
        const version=versionId?(project.versions||[]).find((v:any)=>v.id===versionId):null;
        if(versionId&&!version)fail('Versiunea nu a fost găsită.','NOT_FOUND');
        return renderNextPreviewHtml(version?version.files:project.files||[],{title:project.name,path});
      },
      projectVersion:(_:any,{projectId,versionId}:any,ctx:Context)=>{const project=access(ctx,store.get('projects',projectId));return (Array.isArray(project.versions)?project.versions:[]).find((version:any)=>version.id===versionId)||null;},
      payments:(_:any,__:any,ctx:Context)=>{requireUser(ctx);return own('payments',ctx).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},pricing,
      fulfillmentJobs:(_:any,{projectId}:any,ctx:Context)=>jobs(ctx,projectId),emailStatus,
      adminEmailDeliveries:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.list('email-outbox').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(publicEmail);},
      domainQuotes:(_:any,__:any,ctx:Context)=>listDomainQuotes(store,requireUser(ctx)),
      domainPayments:(_:any,__:any,ctx:Context)=>listDomainPayments(store,requireUser(ctx)),
      blogPosts:(_:any,__:any,ctx:Context)=>posts(ctx),
      blogPost:(_:any,{slug}:any,ctx:Context)=>posts(ctx).find(p=>p.slug===slug)||null,
      memories:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.list('memories');},
      settings:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return settings(store);},
      outlierDiagnostics:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return outlierDiagnostics();},
      adminUsers:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.users().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
      adminAudit:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.list('audit').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);},
      adminOverview:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return {users:store.users().length,projects:store.list('projects').length,conversations:store.list('conversations').length,publishedPosts:store.list('posts').filter(p=>p.status==='PUBLISHED').length};},
      operatorSummary:(_:any,__:any,ctx:Context)=>getPlatformOperationalSummary(store,ctx),
      operatorPlatformStatus:(_:any,__:any,ctx:Context)=>JSON.stringify(getPlatformOperationalSummary(store,ctx)),
      
      operatorPlatformChanges:(_:any,__:any,ctx:Context)=>{
        requireOperator(ctx,'PLATFORM_STAGE');
        return store.list('platform-changes').map((c:any)=>({
          ...c,
          diff: c.diff || c.diffText,
          verificationOk: c.verificationOk !== undefined ? c.verificationOk : c.verificationPassed,
          verificationLog: c.verificationLog || c.verificationReport
        })).sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt));
      },
      operatorLeads:(_:any,{search}:any,ctx:Context)=>{
        requireOperator(ctx,'LEADS');
        const all=store.list('leads');
        if(!search) return all.sort((a:any,b:any)=>b.updatedAt.localeCompare(a.updatedAt));
        const s=search.toLowerCase();
        return all.filter((l:any)=>
          (l.businessName&&l.businessName.toLowerCase().includes(s))||
          (l.locality&&l.locality.toLowerCase().includes(s))||
          (l.normalizedPhone&&l.normalizedPhone.includes(s))||
          (l.email&&l.email.toLowerCase().includes(s))
        ).sort((a:any,b:any)=>b.updatedAt.localeCompare(a.updatedAt));
      },
      operatorProposals:(_:any,__:any,ctx:Context)=>{
        requireOperator(ctx,'PROPOSALS');
        return store.list('proposals').map((p:any)=>({
          ...p,
          buildVerified: p.buildVerified === true
        })).sort((a:any,b:any)=>b.updatedAt.localeCompare(a.updatedAt));
      },
      operatorMessages:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'MESSAGES');return store.list('outbound-messages').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
      operatorDemoBudget:(_:any,__:any,ctx:Context)=>{
        const b = getAgencyBudget(store);
        return { day: b.day, totalBuilds: b.demosBuiltToday, todayBuilds: b.demosBuiltToday, dailyLimit: b.dailyMaxUnits, maxBuildsPerProposal: b.perDemoMaxUnits, remainingToday: Math.max(0, b.dailyMaxUnits - b.spentTodayUnits) };
      },
      operatorTokens:(_:any,__:any,ctx:Context)=>listOperatorTokens(store,ctx),
      operatorConversations:(_:any,__:any,ctx:Context)=>listOperatorSessions(store,ctx),
      operatorConversation:(_:any,{id}:any,ctx:Context)=>getOperatorSession(store,ctx,id),
      leads:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'LEADS');return store.list('leads').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
      lead:(_:any,{id}:any,ctx:Context)=>{requireOperator(ctx,'LEADS');return store.get('leads',id)||null;},
      proposals:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'PROPOSALS');return store.list('proposals').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
      proposal:(_:any,{id}:any,ctx:Context)=>{requireOperator(ctx,'PROPOSALS');return store.get('proposals',id)||null;},
      proposalDeliveryInfo:(_:any,{proposalId,forceReissue}:any,ctx:Context)=>getProposalDeliveryInfo(store,events,ctx,proposalId,{forceReissue:Boolean(forceReissue),reissueIfMissing:true}),
      publicProposal:(_:any,{slug,publicSlug,path,interactiveVisit=true}:any,_ctx:Context)=>getPublicProposalBySlug(store,events,slug||publicSlug,{path,interactiveVisit}),
      operatorDevices:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'DEVICES');return store.list('operator-devices').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
      operatorJobs:(_:any,{status,deviceId}:any,ctx:Context)=>{requireOperator(ctx,'JOBS');return store.list('operator-jobs').filter(j=>(!status||j.status===status)&&(!deviceId||j.deviceId===deviceId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);},
      outboundMessages:(_:any,{proposalId}:any,ctx:Context)=>{requireOperator(ctx,'MESSAGES');return store.list('outbound-messages').filter(m=>!proposalId||m.proposalId===proposalId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
      agencyBudget:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'READ');return getAgencyBudget(store);},
      platformChanges:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'PLATFORM_STAGE');return store.list('platform-changes').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
    },
    Mutation:{
      ...(crmGql.resolvers.Mutation || {}),
      ...(mailboxGql.resolvers.Mutation || {}),
      purchaseCredits:async(_:any,{sku}:any,ctx:Context)=>{const user=requireUser(ctx);limit('wallet-checkout:'+user.id,6,3600000);const order=await createCreditCheckout(store,user,sku);return {url:order.checkoutUrl};},
      subscribePlan:async(_:any,{planId}:any,ctx:Context)=>{const user=requireUser(ctx);limit('wallet-checkout:'+user.id,6,3600000);const order=await createSubscriptionCheckout(store,user,planId);return {url:order.checkoutUrl};},
      openBillingPortal:async(_:any,__:any,ctx:Context)=>{const user=requireUser(ctx);limit('billing-portal:'+user.id,10,3600000);return createBillingPortal(store,user);},
      adminGrantCredits:(_:any,{userId,amount,reason,idempotencyKey}:any,ctx:Context)=>{const actor=requireAdmin(ctx);if(!store.user(userId))fail('Contul nu există.','NOT_FOUND');const explanation=bounded(reason,500);if(explanation.length<3)fail('Introdu motivul ajustării.');if(amount<1||amount>1000000)fail('Numărul de credite nu este valid.');const key=bounded(idempotencyKey,100);grantCredits(store,{ownerId:creditOwnerId(userId),amount,key:'admin:'+actor.id+':'+key,reason:explanation,metadata:{actor:actor.id,userId}});audit(ctx,'wallet.grant',userId);events.publish('wallet');return walletFor(userId);},
      register:(_:any,args:any,ctx:Context)=>{
        limit('register:'+ctx.ip,5,3600000);const username=normalizeUsername(args.username);validatePassword(args.password);
        const recoveryEmail=bounded(args.recoveryEmail,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail))fail('Adresa email de recuperare nu este validă.');
        if(recoveryEmail.endsWith('@starlidigital.ro'))fail('Folosește o adresă externă existentă pentru recuperare.');
        if(store.findUser(username))fail('Acest nume de cont este deja folosit.');
        const user=store.saveUser({id:id(),username,email:username+'@starlidigital.ro',recoveryEmail,role:'USER',passwordHash:hashPassword(args.password),createdAt:now()});
        startSession(ctx,user);audit(ctx,'account.created',user.id);
        if(emailOutboxReady())try{queueWelcome(store,user);events.publish('email');}catch{console.error('[email] Welcome could not be queued');}
        events.publish('platform');return user;
      },
      login:(_:any,{username,password}:any,ctx:Context)=>{limit('login:'+ctx.ip,12,900000);if(password.length>128)fail('Date de autentificare incorecte.','UNAUTHENTICATED');const name=username.trim().toLowerCase().replace(/@starlidigital\.ro$/,'');const user=store.findUser(name);const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);const valid=verifyPassword(password,user?.passwordHash||dummy);if(!user||!valid||user.disabled)fail('Date de autentificare incorecte.','UNAUTHENTICATED');return startSession(ctx,user!);},
      logout:(_:any,__:any,ctx:Context)=>{if(ctx.user)store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(ctx.user.id);ctx.setCookie(`starli_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);ctx.user=undefined;return true;},
      requestPasswordReset:(_:any,{username}:any,ctx:Context)=>{
        limit('reset:'+ctx.ip,4,3600000);const user=store.findUser(username.trim().toLowerCase().replace(/@starlidigital\.ro$/,''));
        if(user&&!user.disabled&&emailOutboxReady()){
          const token=randomBytes(32).toString('hex');const expires=Date.now()+1800000;store.db.exec('BEGIN IMMEDIATE');
          try{store.db.prepare('DELETE FROM resets WHERE user_id=?').run(user.id);store.db.prepare('INSERT INTO resets(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),user.id,expires);queuePasswordReset(store,user,token,expires);store.db.exec('COMMIT');events.publish('email');}catch{store.db.exec('ROLLBACK');console.error('[email] Recovery could not be queued');}
        }return true;
      },
      resetPassword:(_:any,{token,password}:any,ctx:Context)=>{limit('reset-confirm:'+ctx.ip,10,900000);validatePassword(password);const row=store.db.prepare('SELECT user_id FROM resets WHERE token_hash=? AND expires_at>?').get(hashToken(token),Date.now());if(!row)fail('Linkul este invalid sau a expirat.');const user=store.user(String(row!.user_id))!;store.db.exec('BEGIN IMMEDIATE');try{store.saveUser({...user,passwordHash:hashPassword(password)});store.db.prepare('DELETE FROM resets WHERE user_id=?').run(user.id);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}return true;},
      createConversation:(_:any,{mode='STARLI',title,projectId}:any,ctx:Context)=>{
        limit('chat-create:'+ctx.ip,20,3600000);
        if(projectId){const proj=access(ctx,store.get('projects',projectId));if(proj.ownerId!==owner(ctx)&&ctx.user?.role!=='ADMIN')fail('Proiectul nu aparține acestui spațiu.','FORBIDDEN');}
        const record=store.put('conversations',{id:id(),ownerId:owner(ctx),projectId:projectId||undefined,title:title?bounded(title,100):mode==='ALEX'?'Discuție cu Alex':'Conversație cu Starli',mode,status:'OPEN',messages:[],createdAt:now(),updatedAt:now()});
        conversationChange(record);return record;
      },
      sendMessage:(_:any,{conversationId,content,actionMode='AUTO',selectedElementContext,attachments,maxCredits=0,requestId}:any,ctx:Context)=>{
        let record=access(ctx,store.get('conversations',conversationId));
        const governedIntent=record.mode==='STARLI'&&ctx.user&&!ctx.operatorTokenId?governedIntentForMessage(content):null;
        // The *legacy* chat transcript is authoritative. Admit the exact
        // client requestId before adding a user message or starting execution.
        // Typed governed-command idempotency alone does not deduplicate chat.
        const clientRequest=requestId==null?null:String(requestId);
        if(governedIntent&&clientRequest!==null&&!/^[A-Za-z0-9_.:@-]{1,160}$/.test(clientRequest))fail('Invalid conversation request ID.');
        const legacyClaim=governedIntent&&clientRequest?{
          id:`chat-send:${createHash('sha256').update(JSON.stringify([record.ownerId,record.id,clientRequest])).digest('hex')}`,
          ownerId:record.ownerId,conversationId:record.id,requestId:clientRequest,
          fingerprint:createHash('sha256').update(JSON.stringify([content,actionMode,selectedElementContext??null,attachments??null,maxCredits])).digest('hex')
        }:null;
        const checkLegacyReplay=(claim:any)=>{
          if(!legacyClaim||!claim)return null;
          if(claim.ownerId!==record.ownerId||claim.conversationId!==record.id||claim.requestId!==clientRequest||claim.fingerprint!==legacyClaim.fingerprint)fail('Conversation request ID was used for different content.','CONFLICT');
          const owned=access(ctx,store.get('conversations',record.id));
          const original=owned.messages.find((entry:any)=>entry.id===claim.messageId&&entry.role==='user');
          if(!original)fail('The original conversation request requires inspection.','CONFLICT');
          return original;
        };
        const previously=legacyClaim?store.get('starli-legacy-send-claims',legacyClaim.id):null;
        if(previously)return checkLegacyReplay(previously);
        limit('message:'+ctx.ip,30,60000);
        if(record.mode==='STARLI'&&ctx.operatorTokenId&&governedIntentForMessage(content))fail('Customer session is required for governed work.','FORBIDDEN');if(record.messages.length>=500)fail('Conversația a atins limita. Începe o conversație nouă.');
        const isAdmin=ctx.user?.role==='ADMIN'&&record.mode==='ALEX';if(ctx.user?.role==='ADMIN'&&record.mode==='STARLI'&&record.ownerId!==ctx.user.id)fail('Conversațiile Starli ale altor clienți pot fi doar consultate.','FORBIDDEN');
        const isGovernedStop=record.mode==='STARLI'&&ctx.user&&!ctx.operatorTokenId&&governedIntentForMessage(content)==='STOP';
        if(runningChats.has(record.id)&&!isGovernedStop)fail('Starli răspunde deja. Așteaptă finalizarea răspunsului.');
        if(record.mode==='STARLI'&&runningChats.size>=8&&!isGovernedStop)fail('Starli gestionează deja mai multe conversații. Reîncearcă într-un minut.','RATE_LIMITED');
        if(record.mode==='STARLI')admitFreeChat(store,ctx);
        const safeAttachments:ChatAttachmentInput[]=validateChatAttachments(attachments);
        const msg={...message(isAdmin?'human':'user',bounded(content,12000),isAdmin?'Alex':ctx.user?.username||'Vizitator'),selectedElement:selectedElementContext?bounded(selectedElementContext,600):null,attachments:safeAttachments.length?safeAttachments:null};
        const appendLegacy=(target:RecordData)=>{
          target.messages.push(msg);target.updatedAt=now();
          if(target.messages.length===1&&target.title==='Conversație cu Starli')target.title=content.trim().slice(0,70);
          if(target.mode==='STARLI'&&!isAdmin){target.agentStatus='Gândește…';target.agentStartedAt=now();}
          store.put('conversations',target);
        };
        if(legacyClaim){
          // SQLite IMMEDIATE serializes duplicate admissions across schema
          // instances/processes. Either conversation + claim commit together,
          // or neither exists. Never overwrite another sender's fresh transcript.
          store.db.exec('BEGIN IMMEDIATE');
          try{
            const existing=store.get('starli-legacy-send-claims',legacyClaim.id);
            if(existing){const prior=checkLegacyReplay(existing);store.db.exec('COMMIT');return prior;}
            const fresh=access(ctx,store.get('conversations',record.id));
            if(fresh.messages.length>=500)fail('Conversația a atins limita. Începe o conversație nouă.');
            appendLegacy(fresh);record=fresh;
            store.put('starli-legacy-send-claims',{...legacyClaim,messageId:msg.id,createdAt:now()},record.ownerId);
            store.db.exec('COMMIT');
          }catch(error){store.db.exec('ROLLBACK');throw error;}
        }else appendLegacy(record);
        conversationChange(record);
        // Only server-allowlisted intent enters the canonical governed stack;
        // never pass model-produced plan/work/approval refs into this path.
        if(governedIntent){
          const preexistingChat=runningChats.has(record.id);
          runningChats.add(record.id);
          const governedContext=ctx,legacyId=record.id,requestKey=`legacy:${createHash('sha256').update(JSON.stringify([record.id,requestId||msg.id])).digest('hex').slice(0,32)}`;
          void(async()=>{
            let replyText:string;
            try{
              const snapshot=await governedChat.inspect(governedContext,legacyId);
              const result=await governedChat.send(governedContext,legacyId,snapshot.conversationRevision,requestKey,content,false);
              replyText=result.reply;
            }catch{
              replyText='I could not confirm that step. Please check the current status before trying again.';
            }finally{if(!preexistingChat)runningChats.delete(legacyId)}
            const latest=store.get('conversations',legacyId);
            if(latest){latest.messages.push(message('assistant',replyText,'Starli AI'));latest.agentStatus=null;latest.agentStartedAt=null;latest.updatedAt=now();store.put('conversations',latest);conversationChange(latest)}
          })();
          return msg;
        }
        if(record.mode==='STARLI'&&!isAdmin){runningChats.add(record.id);void(async()=>{const streamingMsgId=id();const turnStartedMs=Date.now();let streamed=false;let lastFlush=0;let reply:any;try{const cfg=settings(store);const normalizedMode:AgentActionMode=actionMode==='CHAT'||actionMode==='PLAN'||actionMode==='BUILD'?(actionMode as AgentActionMode):'AUTO';const turn=await agentTurn(record,{provider:cfg.aiProvider,fallbackToOpenAI:cfg.aiFallbackEnabled,store,actionMode:normalizedMode,selectedElementContext:selectedElementContext||null,attachments:safeAttachments,onDelta:(partial)=>{const nowMs=Date.now();if(nowMs-lastFlush<160)return;lastFlush=nowMs;const cur=store.get('conversations',record.id);if(!cur)return;cur.agentStatus='Lucrează';const idx=cur.messages.findIndex((m:any)=>m.id===streamingMsgId);const entry={id:streamingMsgId,role:'assistant',content:partial,createdAt:now(),authorName:'Starli AI'};if(idx>=0)cur.messages[idx]=entry;else cur.messages.push(entry);cur.updatedAt=now();store.put('conversations',cur);streamed=true;events.publish('conversation:'+cur.id);}});
          const elapsedMs=Math.max(400,Date.now()-turnStartedMs);
          if(turn.question){
            reply={id:streamingMsgId,role:'assistant',content:turn.text||turn.question.question,questionJson:JSON.stringify(turn.question),suggestedFollowUp:turn.suggestedFollowUp||null,stepsCount:2,durationMs:elapsedMs,createdAt:now(),authorName:'Starli AI'};
          }else if(turn.plan){
            const latest=store.get('conversations',record.id)!;
            const existing=latest.projectId?store.get('projects',latest.projectId):undefined;
            if(!existing){
              const draft:RecordData={id:id(),ownerId:latest.ownerId,name:turn.plan.name,brief:turn.plan.brief,status:'BRIEF',previewUrl:null,deploymentUrl:null,html:null,previewHtml:null,files:[],sources:[],versions:[],agentRuns:[],notifications:[],validationStatus:'NOT_RUN',buildError:null,createdAt:now(),updatedAt:now()};
              appendNotification(draft,'plan','Planul proiectului a fost creat de Starli AI',turn.plan.objective);
              store.put('projects',draft);
              latest.projectId=draft.id;store.put('conversations',latest);events.publish('projects');
            }else{
              appendNotification(existing,'plan','Plan actualizat de Starli AI',turn.plan.objective);
              store.put('projects',{...existing,updatedAt:now()});events.publish('projects');
            }
            reply={id:streamingMsgId,role:'assistant',content:turn.text||'Am pregătit planul și direcția pentru proiect.',planJson:JSON.stringify(turn.plan),suggestedFollowUp:turn.suggestedFollowUp||'Aprobă și construiește acest plan',stepsCount:3,durationMs:elapsedMs,createdAt:now(),authorName:'Starli AI'};
          }else if(turn.build){
            const latest=store.get('conversations',record.id)!;
            const existing=latest.projectId?store.get('projects',latest.projectId):undefined;
            if(existing&&existing.ownerId!==latest.ownerId)fail('Proiectul nu aparține conversației.','FORBIDDEN');
            if(runningBuilds.size>=2||(existing&&(runningBuilds.has(existing.id)||runningDeploys.has(existing.id)||runningCheckouts.has(existing.id)||existing.deploymentStatus==='BUILDING')))fail('Un proiect este deja în lucru. Urmărește starea lui în conversație.');
            refresh(ctx);
            if(store.user(latest.ownerId)&&ctx.user?.id!==latest.ownerId&&ctx.user?.role!=='ADMIN')fail('Contul nu mai are acces la această operațiune.','FORBIDDEN');
            const creditKey=admitChargedBuild(ctx,{amount:buildCreditCost(existing),maxCredits,action:existing?.files?.length?'edit':'build',projectId:existing?.id,requestId});events.publish('wallet');
            const project=store.put('projects',{...existing,id:existing?.id||id(),ownerId:latest.ownerId,name:turn.build.name,brief:turn.build.brief,status:'BUILDING',buildStep:'Inițializăm construcția proiectului Next.js…',files:existing?.files||[],sources:existing?.sources||[],versions:existing?.versions||[],agentRuns:existing?.agentRuns||[],notifications:existing?.notifications||[],previewHtml:existing?.previewHtml||null,validationStatus:existing?.validationStatus||'NOT_RUN',buildError:null,createdAt:existing?.createdAt||now(),updatedAt:now()});
            latest.projectId=project.id;store.put('conversations',latest);runningBuilds.add(project.id);events.publish('projects');launchBuild(project,false,{creditKey,conversationId:record.id,summary:bounded(content,120),selectedElementContext:selectedElementContext||null});
            reply={id:streamingMsgId,role:'assistant',content:turn.text||'Am pornit construirea website-ului tău Next.js. Voi pregăti direcția, materialele și componentele, apoi voi verifica buildul. Urmărește progresul în proiectul de mai jos.',suggestedFollowUp:turn.suggestedFollowUp||'Personalizează culorile și textul principal din Hero',stepsCount:4,durationMs:elapsedMs,createdAt:now(),authorName:'Starli AI'};
          }else reply={id:streamingMsgId,role:'assistant',content:turn.text,suggestedFollowUp:turn.suggestedFollowUp||null,stepsCount:2,durationMs:elapsedMs,createdAt:now(),authorName:'Starli AI'};}catch(error){reply=message('system',error instanceof Error?error.message:'Starli nu poate răspunde momentan.','Sistem');}finally{runningChats.delete(record.id);}const latest=store.get('conversations',record.id);if(latest){latest.agentStatus=null;latest.agentStartedAt=null;const idx=latest.messages.findIndex((m:any)=>m.id===streamingMsgId);if(streamed&&idx>=0){if(reply.role==='system')latest.messages.splice(idx,1,reply);else latest.messages[idx]=reply;}else latest.messages.push(reply);latest.updatedAt=now();store.put('conversations',latest);conversationChange(latest);}})();}
        return msg;
      },
      createProject:(_:any,{name,brief}:any,ctx:Context)=>{const projectName=bounded(name,120),projectBrief=bounded(brief,16000);limit('project:'+ctx.ip,20,3600000);const draft:RecordData={id:id(),ownerId:owner(ctx),name:projectName,brief:projectBrief,status:'BRIEF',previewUrl:null,deploymentUrl:null,html:null,previewHtml:null,files:[],sources:[],versions:[],agentRuns:[],notifications:[],validationStatus:'NOT_RUN',buildError:null,createdAt:now(),updatedAt:now()};appendNotification(draft,'created','Proiect creat în Starli Studio',projectName);const record=store.put('projects',draft);events.publish('projects');audit(ctx,'project.created',record.id);return record;},
      updateProject:(_:any,args:any,ctx:Context)=>{const record=access(ctx,store.get('projects',args.id));if(runningBuilds.has(record.id))fail('Așteaptă finalizarea construcției.');if(args.name!==undefined)record.name=bounded(args.name,120);if(args.brief!==undefined)record.brief=bounded(args.brief,16000);appendNotification(record,'updated','Setările proiectului au fost actualizate',record.name);record.updatedAt=now();store.put('projects',record);events.publish('projects');return record;},
      updateProjectKnowledge:(_:any,{projectId,input}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        const cur=defaultKnowledge(record);
        record.knowledge={
          businessSummary:input.businessSummary!==undefined?bounded(input.businessSummary,1000):cur.businessSummary,
          audience:input.audience!==undefined?bounded(input.audience,1000):cur.audience,
          goals:input.goals!==undefined?bounded(input.goals,1000):cur.goals,
          brandDirection:input.brandDirection!==undefined?bounded(input.brandDirection,1000):cur.brandDirection,
          language:input.language!==undefined?bounded(input.language,120):cur.language,
          technicalRules:input.technicalRules!==undefined?bounded(input.technicalRules,1500):cur.technicalRules,
          customInstructions:input.customInstructions!==undefined?bounded(input.customInstructions,4000):cur.customInstructions,
          updatedAt:now()
        };
        appendNotification(record,'knowledge','ADN-ul și instrucțiunile proiectului au fost salvate',record.knowledge.brandDirection);
        record.updatedAt=now();store.put('projects',record);audit(ctx,'project.knowledge-updated',projectId);events.publish('projects');return record;
      },
      updateProjectFile:(_:any,{projectId,path,content,summary}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        if(runningBuilds.has(projectId))fail('Așteaptă finalizarea construcției înainte de editare.');
        const files=Array.isArray(record.files)?record.files.map((f:any)=>({...f})):[];
        const idx=files.findIndex((f:any)=>f.path===path);
        if(idx<0||files[idx].encoding==='base64')fail('Fișierul selectat nu poate fi editat ca text.');
        files[idx]={...files[idx],content:bounded(content,180000)};
        validateNextProjectFiles(files);
        const previewHtml=renderNextPreviewHtml(files,{title:record.name});
        const {versions}=createVersionRecord(record,files,previewHtml,{source:'manual',summary:summary?bounded(summary,160):`Editare cod: ${path}`,createdBy:ctx.user?.username||'Editor'});
        appendNotification(record,'code',`Fișierul ${path} a fost salvat`,summary||'Preview actualizat instant');
        const updated=store.put('projects',{...record,...sourceDraftEvidence(),files,previewHtml,versions,updatedAt:now()});
        audit(ctx,'project.file-edited',projectId);events.publish('projects');return updated;
      },
      inlineTextEdit:(_:any,{projectId,originalText,replacementText}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        if(runningBuilds.has(projectId))fail('Așteaptă finalizarea construcției.');
        const orig=String(originalText||'').trim();
        const repl=bounded(String(replacementText||'').trim(),2000);
        if(!orig||orig===repl)return record;
        const files=Array.isArray(record.files)?record.files.map((f:any)=>({...f})):[];
        let changed=false;
        for(const f of files){
          if(!f.encoding&&f.path.endsWith('.tsx')&&f.content.includes(orig)){
            f.content=f.content.replace(orig,repl);
            changed=true;
            break;
          }
        }
        if(!changed)fail('Textul selectat provine dintr-o expresie dinamică. Folosește „Spune-i lui Starli” pentru a-l modifica.');
        validateNextProjectFiles(files);
        const previewHtml=renderNextPreviewHtml(files,{title:record.name});
        const {versions}=createVersionRecord(record,files,previewHtml,{source:'visual-edit',summary:`Text actualizat: „${repl.slice(0,48)}”`,createdBy:ctx.user?.username||'Editor vizual'});
        appendNotification(record,'edit',`Text editat direct în pagină`,`„${repl.slice(0,48)}”`);
        const updated=store.put('projects',{...record,...sourceDraftEvidence(),files,previewHtml,versions,updatedAt:now()});
        audit(ctx,'project.inline-edit',projectId);events.publish('projects');return updated;
      },
      restoreProjectVersion:(_:any,{projectId,versionId}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        if(runningBuilds.has(projectId))fail('Așteaptă finalizarea construcției curente.');
        const versions=Array.isArray(record.versions)?record.versions:[];
        const target=versions.find((v:any)=>v.id===versionId);
        if(!target||!Array.isArray(target.files)||!target.files.length)fail('Versiunea nu a fost găsită.','NOT_FOUND');
        const restoredFiles=target.files.map((f:any)=>({...f}));
        const previewHtml=target.previewHtml||renderNextPreviewHtml(restoredFiles,{title:record.name});
        const {versions:nextVersions}=createVersionRecord(record,restoredFiles,previewHtml,{source:'restore',summary:`Revenire la: ${target.summary}`,createdBy:ctx.user?.username||'Utilizator'});
        appendNotification(record,'restore','Versiune restaurată cu succes',target.summary);
        const updated=store.put('projects',{...record,...sourceDraftEvidence(),files:restoredFiles,previewHtml,versions:nextVersions,updatedAt:now()});
        audit(ctx,'project.version-restored',versionId);events.publish('projects');return updated;
      },
      bookmarkProjectVersion:(_:any,{projectId,versionId,bookmarked}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        const versions=(Array.isArray(record.versions)?record.versions:[]).map((v:any)=>v.id===versionId?{...v,bookmarked:Boolean(bookmarked)}:v);
        const updated=store.put('projects',{...record,versions,updatedAt:now()});
        events.publish('projects');return updated;
      },
      markProjectNotificationsRead:(_:any,{projectId,notificationId}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        const notifications=(Array.isArray(record.notifications)?record.notifications:[]).map((n:any)=>(!notificationId||n.id===notificationId)?{...n,read:true}:n);
        const updated=store.put('projects',{...record,notifications,updatedAt:now()});
        events.publish('projects');return updated;
      },
      runProjectResearch:async(_:any,{projectId,maxCredits=0,requestId}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',projectId));
        const creditKey=reserveCreditAction(store,ctx,{amount:creditCosts().research,maxCredits,action:'research',projectId,requestId});events.publish('wallet');
        const runId=id();
        const step1={id:id(),category:'web',title:'Caut pe web competitori și repere din sector',detail:record.name,status:'running',createdAt:now(),completedAt:null};
        const researchRun:RecordData={id:runId,projectId,conversationId:null,mode:'PLAN',status:'running',summary:'Cercetare web și analiza competiției',errorSummary:null,versionId:null,steps:[step1],createdAt:now(),updatedAt:now(),completedAt:null};
        const runs=[researchRun,...(Array.isArray(record.agentRuns)?record.agentRuns:[])].slice(0,20);
        store.put('projects',{...record,agentRuns:runs,updatedAt:now()});
        events.publish('projects');
        const researchFailed=(error:unknown)=>{finishCreditAction(store,creditKey,false);events.publish('wallet');const cur=store.get('projects',projectId);if(cur)store.put('projects',{...cur,agentRuns:(cur.agentRuns||[]).map((r:any)=>r.id===runId?{...r,status:'error',errorSummary:error instanceof Error?error.message:'Cercetarea a eșuat.',steps:r.steps.map((step:any)=>({...step,status:step.status==='running'?'error':step.status,completedAt:now()})),completedAt:now(),updatedAt:now()}:r)});events.publish('projects');};
        let summaryText='';
        let sourcesList:{title:string;url:string}[]=[];
        try{
          if(process.env.OPENAI_API_KEY){
            const {researchBusiness}=await import('./research.js');
            const res=await researchBusiness(record.brief||record.name);
            summaryText=res.summary;
            sourcesList=res.sources||[];
          }
        }catch(error){researchFailed(error);throw error;}
        if(!summaryText){researchFailed(new Error('Cercetarea web nu este disponibilă.'));fail('Cercetarea web nu este disponibilă. Creditele rezervate au fost eliberate.');}
        const cur=store.get('projects',projectId)!;
        const completedSteps:any[]=[{...step1,status:'success',completedAt:now()}];
        for(const s of sourcesList.slice(0,4)){
          try{
            const host=new URL(s.url).hostname.replace(/^www\./,'');
            completedSteps.push({id:id(),category:'web',title:`Am citit ${host}`,detail:s.title,status:'success',createdAt:now(),completedAt:now()});
          }catch{/* ignore */}
        }
        completedSteps.push({id:id(),category:'document',title:'Am salvat documentul · Analiza competiției',detail:'Analiza competiției și direcția',status:'success',createdAt:now(),completedAt:now()});
        const updatedRuns=(Array.isArray(cur.agentRuns)?cur.agentRuns:[]).map((r:any)=>r.id===runId?{...r,status:'success',steps:completedSteps,updatedAt:now(),completedAt:now()}:r);
        appendNotification(cur,'research','Starli a finalizat cercetarea web și analiza competiției',sourcesList.length?`${sourcesList.length} surse web analizate`:'Document disponibil în studio');
        const updated=store.put('projects',{...cur,research:summaryText,sources:sourcesList,agentRuns:updatedRuns,notifications:cur.notifications,updatedAt:now()});
        finishCreditAction(store,creditKey,true);events.publish('wallet');
        events.publish('projects');
        return updated;
      },
      deleteProject:(_:any,{id}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',id));
        if(runningBuilds.has(id)||runningDeploys.has(id)||runningCheckouts.has(id)||record.deploymentStatus==='BUILDING')fail('Așteaptă finalizarea operațiunii curente înainte de ștergere.');
        for(const conv of store.list('conversations')){if(conv.projectId===id){const updated={...conv,projectId:null,updatedAt:now()};store.put('conversations',updated);events.publish('conversation:'+conv.id);}}
        store.remove('projects',id);audit(ctx,'project.deleted',id);events.publish('projects');events.publish('conversations');return true;
      },
      buildProject:(_:any,{id,regenerateImages=false,summary,selectedElementContext,maxCredits=0,requestId}:any,ctx:Context)=>{
        const record=access(ctx,store.get('projects',id));
        const cfg=settings(store);
        if(!aiConfigured(cfg.aiProvider)&&!(cfg.aiFallbackEnabled&&!!process.env.OPENAI_API_KEY))fail('Configurează conexiunea AI înainte de construire.','INTEGRATION_UNAVAILABLE');
        if(runningBuilds.has(id))fail('Proiectul este deja în construcție.');
        if(runningDeploys.has(id)||record.deploymentStatus==='BUILDING'||runningCheckouts.has(id))fail('Așteaptă finalizarea publicării sau checkout-ului.');
        if(runningBuilds.size>=2)fail('Starli construiește deja două proiecte. Reîncearcă în câteva minute.','RATE_LIMITED');
        const creditKey=admitChargedBuild(ctx,{amount:buildCreditCost(record,regenerateImages),maxCredits,action:record.files?.length?'edit':'build',projectId:id,requestId});events.publish('wallet');runningBuilds.add(id);record.status='BUILDING';record.buildStep='Inițializăm construcția proiectului Next.js…';record.buildError=null;record.updatedAt=now();store.put('projects',record);events.publish('projects');
        launchBuild(record,Boolean(regenerateImages),{creditKey,summary:summary?bounded(summary,160):undefined,selectedElementContext:selectedElementContext||null});return record;
      },
      verifyProject:(_:any,{id}:any,ctx:Context)=>{
        const project=access(ctx,store.get('projects',id));if(process.env.NEXT_WORKER_ENABLED!=='true')fail('Workerul Next.js nu este activat.','INTEGRATION_UNAVAILABLE');
        if(!Array.isArray(project.files)||!project.files.length)fail('Generează sursa Next.js înainte de verificare.');
        if(runningBuilds.has(id)||runningDeploys.has(id)||runningCheckouts.has(id)||project.deploymentStatus==='BUILDING')fail('Așteaptă finalizarea operațiunii curente.');
        if(runningBuilds.size>=2)fail('Workerii sunt ocupați. Reîncearcă în câteva minute.','RATE_LIMITED');limit('verify:'+ctx.ip,6,3600000);runningBuilds.add(id);
        const record=store.put('projects',{...project,status:'VERIFYING',validationStatus:'PENDING',validationProvider:'DOCKER',buildError:null,updatedAt:now()});events.publish('projects');
        void(async()=>{try{const verified=await verifySources(project.files);store.put('projects',{...store.get('projects',id)!,status:'PREVIEW',previewHtml:verified.previewHtml||null,validationStatus:verified.validationStatus,validationProvider:verified.validationProvider,buildLog:verified.buildLog,buildError:null,updatedAt:now()});rememberVerifiedProject(store.get('projects',id)!,'DOCKER');}catch(error){store.put('projects',{...store.get('projects',id)!,status:'BUILD_FAILED',validationStatus:'FAILED',buildError:error instanceof Error?error.message:'Verificarea a eșuat.',updatedAt:now()});}finally{runningBuilds.delete(id);events.publish('projects');}})();return record;
      },
      createCheckout:async(_:any,{projectId}:any,ctx:Context)=>{const user=requireUser(ctx);if(creditCosts().enabled)fail('Alege abonamentul Starli din pagina Credite și abonament.','PAYMENT_REQUIRED');const project=access(ctx,store.get('projects',projectId));if(project.ownerId!==user.id)fail('Checkout-ul este rezervat proprietarului website-ului.','FORBIDDEN');if(runningBuilds.has(projectId)||runningCheckouts.has(projectId)||runningDeploys.has(projectId))fail('Așteaptă finalizarea operațiunii curente.');limit('checkout:'+user.id,6,3600000);runningCheckouts.add(projectId);try{const payment=await createCheckout(store,project,user);audit(ctx,'payment.checkout-created',payment.id);events.publish('payments');return payment;}catch(error){fail(error instanceof Error?error.message:'Checkout indisponibil.','INTEGRATION_UNAVAILABLE');}finally{runningCheckouts.delete(projectId);}},
      deployProject:(_:any,{id}:any,ctx:Context)=>{
        const user=requireUser(ctx);const project=access(ctx,store.get('projects',id));if(!project.files?.length)fail('Generează sursa Next.js înainte de publicare.');
        if(runningBuilds.has(id)||runningCheckouts.has(id))fail('Așteaptă finalizarea operațiunii curente.');limit('deploy:'+user.id,5,3600000);
        let job:RecordData|undefined;
        if(user.role==='ADMIN')job=enqueueAdminFulfillment(store,project,user);
        else if(canUseSubscriptionHosting(store,user.id,id))job=enqueueSubscriptionFulfillment(store,project,user);
        else{const hash=sourceHash(project.files);const payment=store.list('payments',user.id).find(p=>p.projectId===id&&p.sourceHash===hash&&p.status==='PAID'&&p.verifiedEventId&&store.get('stripe-events',p.verifiedEventId));if(!payment)fail('Publicarea necesită plata confirmată pe server pentru această versiune.','PAYMENT_REQUIRED');job=store.get('fulfillment-jobs','payment-'+payment!.id);if(!job)fail('Comanda achitată este în curs de sincronizare. Reîncearcă în câteva secunde.');}
        const record=store.put('projects',{...project,status:job!.status==='LIVE'?'LIVE':'DEPLOYING',deploymentStatus:job!.status,buildError:job!.error||null,updatedAt:now()});audit(ctx,'project.fulfillment-requested',job!.id);events.publish('fulfillment');events.publish('projects');return record;
      },
      refreshDeployment:async(_:any,{id}:any,ctx:Context)=>{requireUser(ctx);access(ctx,store.get('projects',id));const job=jobs(ctx,id)[0];if(!job)fail('Proiectul nu are o operațiune de publicare înregistrată.');if(!['LIVE','FAILED','BLOCKED','NEEDS_REVIEW'].includes(job!.status))store.put('fulfillment-jobs',{...job!,nextAttemptAt:0});limit('deployment-refresh:'+ctx.ip,30,60000);await tickFulfillment(store,events);return store.get('projects',id);},
      retryFulfillment:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);const job=retryJob(store,id);audit(ctx,'fulfillment.retry',id);events.publish('fulfillment');return job;},
      testEmail:(_:any,{to}:any,ctx:Context)=>{const user=requireAdmin(ctx);limit('email-test:'+user.id,3,3600000);try{const mail=enqueueEmail(store,{kind:'TEST',reference:randomBytes(16).toString('hex'),ownerId:user.id,to:bounded(to,254),subject:'Test email tranzacțional — Starlidigital',text:'Acesta este un email de test trimis din panoul de administrare Starlidigital. Acceptarea de către furnizor nu confirmă livrarea în inbox.'});events.publish('email');audit(ctx,'email.test-queued',mail.id);return publicEmail(mail);}catch(error){fail(error instanceof Error?error.message:'Emailul nu poate fi pus în coadă.','INTEGRATION_UNAVAILABLE');}},
      retryEmail:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);try{const mail=retryOutbox(store,id);events.publish('email');audit(ctx,'email.retry',id);return publicEmail(mail);}catch(error){fail(error instanceof Error?error.message:'Emailul nu poate fi retrimis.');}},
      createDomainQuote:async(_:any,{projectId,domain,years=1}:any,ctx:Context)=>{const user=requireUser(ctx);const project=access(ctx,store.get('projects',projectId));limit('domain-quote:'+user.id,10,3600000);try{const quote=await quoteDomainCheckout(store,project,user,bounded(domain,253),years);events.publish('domains');return quote;}catch(error){fail(error instanceof Error?error.message:'Oferta domeniului nu este disponibilă.','INTEGRATION_UNAVAILABLE');}},
      createDomainCheckout:async(_:any,{quoteId,autoRenew,consent,contactInformation}:any,ctx:Context)=>{const user=requireUser(ctx);limit('domain-checkout:'+user.id,5,3600000);try{const {additionalJson,...contact}=contactInformation;if(additionalJson){const extra=JSON.parse(bounded(additionalJson,10000));if(!extra||typeof extra!=='object'||Array.isArray(extra)||Object.keys(extra).some(key=>['__proto__','constructor','prototype'].includes(key))||Object.values(extra).some(value=>value!==null&&!['string','number','boolean'].includes(typeof value)))fail('Câmpurile suplimentare trebuie să formeze un obiect JSON simplu.');contact.additional=extra;}const payment=await checkoutDomain(store,quoteId,user,{autoRenew,consent,contactInformation:contact});audit(ctx,'domain.checkout-created',payment.id);events.publish('domains');return payment;}catch(error){fail(error instanceof Error?error.message:'Checkout-ul domeniului nu este disponibil.','INTEGRATION_UNAVAILABLE');}},
      saveBlogPost:(_:any,args:any,ctx:Context)=>{requireAdmin(ctx);const existing=args.id?store.get('posts',args.id):undefined;if(args.id&&!existing)fail('Articolul nu există.','NOT_FOUND');const title=bounded(args.title,180);if(args.coverImage&&!/^(\/(?:assets|brand)\/|https:\/\/)/.test(args.coverImage))fail('Imaginea trebuie să folosească HTTPS sau /assets/.');const record=store.put('posts',{...existing,id:existing?.id||id(),title,slug:existing?.slug||slugify(title)+'-'+id().slice(0,6),excerpt:bounded(args.excerpt,300),content:bounded(args.content,60000),coverImage:args.coverImage||null,status:existing?.status||'DRAFT',createdAt:existing?.createdAt||now(),publishedAt:existing?.publishedAt||null,author:'Starli AI'});audit(ctx,'blog.saved',record.id);events.publish('blog');return record;},
      publishBlogPost:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);const record=store.get('posts',id);if(!record)fail('Articolul nu există.','NOT_FOUND');record!.status='PUBLISHED';record!.publishedAt=record!.publishedAt||now();store.put('posts',record!);audit(ctx,'blog.published',id);events.publish('blog');return record;},
      unpublishBlogPost:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);const record=store.get('posts',id);if(!record)fail('Articolul nu există.','NOT_FOUND');record!.status='DRAFT';record!.publishedAt=null;store.put('posts',record!);audit(ctx,'blog.unpublished',id);events.publish('blog');return record;},
      deleteBlogPost:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);store.remove('posts',id);audit(ctx,'blog.deleted',id);events.publish('blog');return true;},
      generateBlogPost:async(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);limit('blog-generate:'+ctx.user!.id,4,3600000);try{const article=await generateArticle(store);events.publish('blog');audit(ctx,'blog.generated',article.id);return article;}catch(error){fail(error instanceof Error?error.message:'Generarea a eșuat.','INTEGRATION_UNAVAILABLE');}},
      saveMemory:(_:any,args:any,ctx:Context)=>{requireAdmin(ctx);if(args.projectId&&!store.get('projects',args.projectId))fail('Proiectul nu există.');const record=store.put('memories',{id:id(),title:bounded(args.title,160),content:bounded(args.content,12000),projectId:args.projectId||null,publicApproved:args.publicApproved,createdAt:now()});audit(ctx,'memory.created',record.id);events.publish('memories');return record;},
      deleteMemory:(_:any,{id}:any,ctx:Context)=>{requireAdmin(ctx);store.remove('memories',id);audit(ctx,'memory.deleted',id);events.publish('memories');return true;},
      setMemoryPublic:(_:any,{id,publicApproved}:any,ctx:Context)=>{requireAdmin(ctx);const memory=store.get('memories',id);if(!memory)fail('Memoria nu există.','NOT_FOUND');const record=store.put('memories',{...memory!,publicApproved});audit(ctx,publicApproved?'memory.public-approved':'memory.public-revoked',id);events.publish('memories');return record;},
      updateSettings:(_:any,args:any,ctx:Context)=>{requireAdmin(ctx);if(args.blogHour<0||args.blogHour>23)fail('Ora trebuie să fie între 0 și 23.');const current=settings(store);const aiProvider=args.aiProvider?normalizeProvider(args.aiProvider):current.aiProvider;const aiFallbackEnabled=args.aiFallbackEnabled!==undefined?Boolean(args.aiFallbackEnabled):current.aiFallbackEnabled;let outlierModel=current.outlierModel;if(args.outlierModel&&String(args.outlierModel).trim()){const diag=updateOutlierCredentials({model:String(args.outlierModel).trim()});outlierModel=diag.model;}store.put('settings',{...current,autoBlogEnabled:args.autoBlogEnabled,blogHour:args.blogHour,aiProvider,aiFallbackEnabled,outlierModel});audit(ctx,'settings.updated',aiProvider);events.publish('platform');return settings(store);},
      setAIProvider:(_:any,{provider,fallbackToOpenAI}:any,ctx:Context)=>{requireAdmin(ctx);const current=settings(store);const aiProvider=normalizeProvider(provider);const aiFallbackEnabled=fallbackToOpenAI!==undefined?Boolean(fallbackToOpenAI):current.aiFallbackEnabled;store.put('settings',{...current,aiProvider,aiFallbackEnabled});audit(ctx,'ai.provider-switched',aiProvider);events.publish('platform');return settings(store);},
      updateOutlierConfig:(_:any,args:any,ctx:Context)=>{requireAdmin(ctx);const diag=updateOutlierCredentials(args);const current=settings(store);store.put('settings',{...current,outlierModel:diag.model});audit(ctx,'ai.outlier-updated',diag.model);events.publish('platform');return diag;},
      pingOutlierConnection:async(_:any,{rotateIfNeeded=false}:any,ctx:Context)=>{requireAdmin(ctx);const res=await pingOutlier(Boolean(rotateIfNeeded));audit(ctx,'ai.outlier-ping',res.ok?'ok':'failed');events.publish('platform');return res;},
      setUserDisabled:(_:any,{id,disabled}:any,ctx:Context)=>{const actor=requireAdmin(ctx);const user=store.user(id);if(!user)fail('Contul nu există.','NOT_FOUND');if(disabled&&actor.id===id)fail('Nu poți dezactiva propriul cont de administrator.');if(disabled&&user!.role==='ADMIN'&&store.users().filter(u=>u.role==='ADMIN'&&!u.disabled).length<=1)fail('Ultimul administrator activ nu poate fi dezactivat.');store.db.exec('BEGIN IMMEDIATE');try{store.saveUser({...user!,disabled});if(disabled)store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);audit(ctx,disabled?'account.disabled':'account.enabled',id);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}events.publish('platform');events.publish('conversations');events.publish('projects');return store.user(id);},
      createOperatorToken:(_:any,{label,permissions,ttlHours}:any,ctx:Context)=>issueOperatorToken(store,ctx,{label,permissions,ttlHours}),
      issueOperatorToken:(_:any,{label,permissions,expiresInDays,ttlHours}:any,ctx:Context)=>issueOperatorToken(store,ctx,{label,permissions,ttlHours:ttlHours||(expiresInDays?expiresInDays*24:undefined)}),
      revokeOperatorToken:(_:any,{id}:any,ctx:Context)=>revokeOperatorToken(store,ctx,id),
      sendOperatorTurn:async(_:any,{conversationId,prompt}:any,ctx:Context)=>{const res=await runOperatorTurn(store,events,ctx,{conversationId,prompt});return {conversation:res.conversation,reply:res.reply,jobId:res.jobId,toolActivities:res.toolActivities.map(t=>({tool:t.tool,ok:t.ok,summary:t.summary,dataJson:JSON.stringify(t.data)}))};},
      invokeOperatorTool:(_:any,{tool,argsJson}:any,ctx:Context)=>{let parsedArgs:Record<string,unknown>={};try{parsedArgs=argsJson?JSON.parse(argsJson):{};}catch{fail('Argumentele JSON ale instrumentului sunt invalide.');}const res=executeOperatorTool(store,events,ctx,{tool,args:parsedArgs});return {tool:res.tool,ok:res.ok,summary:res.summary,dataJson:JSON.stringify(res.data)};},
      upsertLead:(_:any,args:any,ctx:Context)=>upsertLead(store,events,ctx,args).lead,
      prepareProposalDemo:async(_:any,args:any,ctx:Context)=>{const res=createOrUpdateProposalDemo(store,events,ctx,args);if(args.mode==='bespoke')await buildBespokeOperatorProposal(store,events,ctx,res.proposal.id,args.customBrief);return {lead:res.lead,proposal:store.get('proposals',res.proposal.id),projectId:res.project.id,claimCode:res.claimCode,deduplicated:res.deduplicated};},
      promoteProposal:async(_:any,{proposalId,targetMode,toMode}:any,ctx:Context)=>{const res=promoteOperatorProposal(store,events,ctx,proposalId,targetMode||toMode||'bespoke');if(res.generationMode==='bespoke')await buildBespokeOperatorProposal(store,events,ctx,res.id);return store.get('proposals',res.id);},

      startOperatorTask:(_:any,args:any,ctx:Context)=>startOperatorTask(store,events,ctx,args),
      stopOperatorTask:(_:any,{id}:any,ctx:Context)=>stopOperatorTask(store,ctx,id),
      operatorChatTurn:async(_:any,{conversationId,text}:any,ctx:Context)=>{
        const res=await runOperatorTurn(store,events,ctx,{conversationId,prompt:text});
        return { conversationId:res.conversation.id, reply:res.reply.content, toolResults:res.toolActivities.map(t=>({tool:t.tool,ok:t.ok,summary:t.summary,dataJson:JSON.stringify(t.data)})) };
      },
      executeOperatorTool:(_:any,{input}:any,ctx:Context)=>{
        let parsedArgs:Record<string,unknown>={};
        const raw=input.argumentsJson||input.argsJson;
        try{parsedArgs=raw?JSON.parse(raw):{};}catch{fail('Argumentele JSON sunt invalide.');}
        const res=executeOperatorTool(store,events,ctx,{tool:input.tool,args:parsedArgs});
        return {tool:res.tool,ok:res.ok,summary:res.summary,dataJson:JSON.stringify(res.data)};
      },
      upsertOperatorLead:(_:any,{input}:any,ctx:Context)=>{
        return upsertLead(store,events,ctx,{id:input.id,businessName:input.businessName,industry:input.industry,locality:input.locality,phone:input.phone,email:input.email,existingWebsite:input.existingWebsite,consentStatus:input.consentStatus,consentProvenance:input.consentProvenance,internalNotes:input.notes||input.internalNotes});
      },
      createOperatorProposal:async(_:any,{input}:any,ctx:Context)=>{
        const res=await createOrUpdateProposalDemo(store,events,ctx,{leadId:input.leadId,businessName:input.businessName,customBrief:input.summary||input.customBrief,mode:input.mode||'snapshot'});
        if(input.mode==='bespoke')await buildBespokeOperatorProposal(store,events,ctx,res.proposal.id,input.summary||input.customBrief);
        return {proposal:store.get('proposals',res.proposal.id),claimCode:res.claimCode,validationErrors:[]};
      },
      revokeProposalClaim:(_:any,{proposalId}:any,ctx:Context)=>{
        rotateOrRevokeClaimCode(store,events,ctx,proposalId,true);
        return store.get('proposals',proposalId)||null;
      },
      createDevicePairingCode:(_:any,{label,allowedRoots,ttlMinutes=15}:any,ctx:Context)=>{
        const res = createDevicePairingCode(store, ctx, { label, allowedRoots, ttlMinutes });
        return { id: res.ticket.id, ticketId: res.ticket.id, pairingCode: res.pairingCode, expiresAt: res.ticket.expiresAt, allowedRoots: res.ticket.allowedRoots, label };
      },
      enqueuePrivilegedPowerShellTask:(_:any,{deviceId,command,reason}:any,ctx:Context)=>enqueueDeviceTask(store,events,ctx,{deviceId,kind:'device.powershell',args:{command,reason}}),
      prepareOperatorProposalInvitation:(_:any,{input}:any,ctx:Context)=>{
        return prepareProposalMessage(store,events,ctx,{proposalId:input.proposalId,adapter:input.channel==='SMS_ADB'?'WINDOWS_ADB':'SMS_API',deviceId:input.deviceId,customBody:input.customBody}).message;
      },
      approveOperatorMessage:(_:any,{messageId}:any,ctx:Context)=>approveAndDispatchMessage(store,events,ctx,messageId),
      dispatchOperatorMessage:(_:any,{messageId}:any,ctx:Context)=>approveAndDispatchMessage(store,events,ctx,messageId),
      stageOperatorPlatformChange:(_:any,{title,targetPath,proposedContent,originalContent}:any,ctx:Context)=>stagePlatformChange(store,events,ctx,{title,targetPath,originalContent:originalContent||'',proposedContent}),
      approveOperatorPlatformChange:(_:any,{changeId}:any,ctx:Context)=>approveStagedPlatformChange(store,events,ctx,changeId),
      rollbackOperatorPlatformChange:(_:any,{changeId}:any,ctx:Context)=>rollbackPlatformChange(store,events,ctx,changeId),

      updateProposalStatus:(_:any,{proposalId,status,errorDetail}:any,ctx:Context)=>transitionProposalState(store,events,ctx,proposalId,status,errorDetail),
      rotateProposalClaimCode:(_:any,{proposalId,revokeOnly=false,ttlHours=336}:any,ctx:Context)=>rotateOrRevokeClaimCode(store,events,ctx,proposalId,Boolean(revokeOnly),Number(ttlHours)),
      issueProposalDelivery:(_:any,{proposalId,forceReissue}:any,ctx:Context)=>getProposalDeliveryInfo(store,events,ctx,proposalId,{forceReissue:forceReissue??true,reissueIfMissing:true}),
      sendProposalVisitorMessage:(_:any,{publicSlug,content}:any,ctx:Context)=>sendProposalVisitorMessage(store,events,ctx,{publicSlug,content}),
      optOutPublicProposal:(_:any,{publicSlug,reason}:any,ctx:Context)=>publicOptOutFromProposal(store,events,ctx,{publicSlug,reason}),
      requestProposalClaimOtp:async(_:any,{publicSlug,slug,claimCode,contact}:any,ctx:Context)=>{
        const res=requestProposalClaimOtp(store,events,ctx,{publicSlug:publicSlug||slug,claimCode,contact:contact||''});
        return { sent:res.sent, success:res.sent, maskedContact:res.maskedContact, maskedTarget:res.maskedContact, expiresInSeconds:res.expiresInSeconds, testOtp:res._testOtp||null };
      },
      recordContactOptOut:(_:any,{contact,reason}:any,ctx:Context)=>{
        recordContactOptOut(store,events,{normalizedPhone:contact.includes('@')?undefined:contact,email:contact.includes('@')?contact:undefined,reason:reason||'Cerere de dezabonare publică',actor:ctx.user?.id||'visitor:'+ctx.ip});
        return { id:id(), contact, status:'OPTED_OUT' };
      },
      claimProposalWebsite:async(_:any,{publicSlug,slug,claimCode,otpCode,otp}:any,ctx:Context)=>{
        const res=claimProposalWebsite(store,events,ctx,{publicSlug:publicSlug||slug,claimCode,otpCode:otpCode||otp});
        return { projectId:res.project.id, proposal:res.proposal, alreadyClaimedByMe:res.alreadyClaimedByMe, success:true, conversationId:res.proposal.welcomeConversationId||'', message:'Website revendicat cu succes!' };
      },
      createDevicePairing:(_:any,{label,allowedRoots,ttlMinutes=15}:any,ctx:Context)=>{const res=createDevicePairingCode(store,ctx,{label,allowedRoots,ttlMinutes});return {id:res.ticket.id,pairingCode:res.pairingCode,ticketId:res.ticket.id,expiresAt:res.ticket.expiresAt,allowedRoots:res.ticket.allowedRoots,label};},
      pairWindowsDevice:(_:any,args:any,ctx:Context)=>completeDevicePairing(store,events,{...args,ip:ctx.ip}),
      completeDevicePairing:(_:any,args:any,ctx:Context)=>completeDevicePairing(store,events,{...args,deviceName:args.deviceName||args.name,ip:ctx.ip}),
      deviceHeartbeat:(_:any,{deviceToken,version,capabilities,adbStatus,adbDevices}:any)=>recordDeviceHeartbeat(store,events,deviceToken,{version,capabilities,adbStatus,adbDevices}).device,
      revokeOperatorDevice:(_:any,{deviceId}:any,ctx:Context)=>revokeDevice(store,events,ctx,deviceId),
      enqueueDeviceJob:(_:any,{deviceId,kind,argsJson,idempotencyKey}:any,ctx:Context)=>{let parsedArgs:Record<string,unknown>={};try{parsedArgs=argsJson?JSON.parse(argsJson):{};}catch{fail('Argumentele JSON ale lucrării sunt invalide.');}return enqueueDeviceTask(store,events,ctx,{deviceId,kind,args:parsedArgs,idempotencyKey});},
      reportDeviceJob:(_:any,{deviceToken,jobId,leaseToken,status,output,error,exitCode}:any)=>reportDeviceJobOutcome(store,events,deviceToken,{jobId,leaseToken,status,output,error,exitCode}),
      approveOperatorJob:(_:any,{jobId}:any,ctx:Context)=>{const {user}=requireOperator(ctx,'JOBS');const job=approveOperatorJob(store,events,jobId,user.id);if(job.deviceId&&job.status==='QUEUED_DEVICE')pushJobToDeviceSocket(job.deviceId,job);return job;},
      cancelOperatorJob:(_:any,{jobId,reason}:any,ctx:Context)=>{const {user}=requireOperator(ctx,'JOBS');return cancelOperatorJob(store,events,jobId,user.id,reason);},
      prepareProposalSms:(_:any,{proposalId,adapter,deviceId,customBody,idempotencyKey}:any,ctx:Context)=>prepareProposalMessage(store,events,ctx,{proposalId,adapter,deviceId,customBody,idempotencyKey}).message,
      approveOutboundMessage:(_:any,{messageId}:any,ctx:Context)=>approveAndDispatchMessage(store,events,ctx,messageId),
      reportAdbSmsOutcome:(_:any,{messageId,outcome,detail}:any,ctx:Context)=>{requireOperator(ctx,'MESSAGES');return recordAdbSmsOutcome(store,events,{messageId,outcome,detail});},
      updateAgencyBudget:(_:any,{perDemoMaxUnits,dailyMaxUnits}:any,ctx:Context)=>updateAgencyBudgetLimits(store,ctx,{perDemoMaxUnits,dailyMaxUnits}),
      stagePlatformChange:(_:any,{title,targetPath,originalContent,proposedContent}:any,ctx:Context)=>stagePlatformChange(store,events,ctx,{title,targetPath,originalContent,proposedContent}),
      approvePlatformChange:(_:any,{changeId}:any,ctx:Context)=>approveStagedPlatformChange(store,events,ctx,changeId),
      rollbackPlatformChange:(_:any,{changeId}:any,ctx:Context)=>rollbackPlatformChange(store,events,ctx,changeId)
    },
    Subscription:{
      walletUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireUser(ctx);return events.iterator('wallet');},resolve:(_:any,__:any,ctx:Context)=>walletFor(requireUser(ctx).id)},
      conversationUpdated:{subscribe:(_:any,{id}:any,ctx:Context)=>{access(ctx,store.get('conversations',id));return events.iterator('conversation:'+id);},resolve:(_:any,{id}:any,ctx:Context)=>access(ctx,store.get('conversations',id))},
      conversationsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{if(!ctx.user&&!ctx.guest)fail('Deschide întâi o conversație.','UNAUTHENTICATED');return events.iterator('conversations');},resolve:(_:any,__:any,ctx:Context)=>own('conversations',ctx)},
      projectUpdated:{subscribe:(_:any,{id}:any,ctx:Context)=>{access(ctx,store.get('projects',id));return events.iterator('projects');},resolve:(_:any,{id}:any,ctx:Context)=>access(ctx,store.get('projects',id))},
      projectsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{refresh(ctx);if(!ctx.user&&!ctx.guest)fail('Creează întâi un proiect.','UNAUTHENTICATED');return events.iterator('projects');},resolve:(_:any,__:any,ctx:Context)=>own('projects',ctx)},
      paymentsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireUser(ctx);return events.iterator('payments');},resolve:(_:any,__:any,ctx:Context)=>own('payments',ctx)},
      memoriesUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return events.iterator('memories');},resolve:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.list('memories');}},
      blogUpdated:{subscribe:()=>events.iterator('blog'),resolve:(_:any,__:any,ctx:Context)=>posts(ctx)},
      platformUpdated:{subscribe:()=>events.iterator('platform'),resolve:platform},
      fulfillmentUpdated:{subscribe:(_:any,{projectId}:any,ctx:Context)=>{jobs(ctx,projectId);return events.iterator('fulfillment');},resolve:(_:any,{projectId}:any,ctx:Context)=>jobs(ctx,projectId)},
      emailDeliveriesUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return events.iterator('email');},resolve:(_:any,__:any,ctx:Context)=>{requireAdmin(ctx);return store.list('email-outbox').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(publicEmail);}},
      domainsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireUser(ctx);return events.iterator('domains');},resolve:(_:any,__:any,ctx:Context)=>{const user=requireUser(ctx);return {quotes:listDomainQuotes(store,user),payments:listDomainPayments(store,user)};}},
      operatorConversationUpdated:{subscribe:(_:any,{id}:any,ctx:Context)=>{getOperatorSession(store,ctx,id);return events.iterator('operator-conversation:'+id);},resolve:(_:any,{id}:any,ctx:Context)=>getOperatorSession(store,ctx,id)},
      operatorDevicesUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'DEVICES');return events.iterator('operator-devices');},resolve:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'DEVICES');return store.list('operator-devices').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}},
      operatorJobsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'JOBS');return events.iterator('operator-jobs');},resolve:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'JOBS');return store.list('operator-jobs').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);}},
      proposalsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'PROPOSALS');return events.iterator('proposals');},resolve:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'PROPOSALS');return store.list('proposals').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}},
      leadsUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'LEADS');return events.iterator('leads');},resolve:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'LEADS');return store.list('leads').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}},
      outboundMessagesUpdated:{subscribe:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'MESSAGES');return events.iterator('outbound-messages');},resolve:(_:any,__:any,ctx:Context)=>{requireOperator(ctx,'MESSAGES');return store.list('outbound-messages').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}}
    }
    }
  )
  });
}
