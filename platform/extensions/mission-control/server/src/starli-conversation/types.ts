export const STARLI_CONVERSATION_SCHEMA_VERSION=1 as const;

export type ConversationRole='CUSTOMER'|'ASSISTANT';
export type ConversationTaskState='IDLE'|'AWAITING_ASSISTANT'|'AWAITING_CUSTOMER'|'ACTIVE'|'PAUSED'|'CLOSED';
export type ConversationReference=
 |{kind:'INTENT';id:string}
 |{kind:'ORCHESTRATION_PLAN';id:string;revision?:number}
 |{kind:'QUESTION';id:string;workPackageId?:string}
 |{kind:'APPROVAL';id:string;actionPlanId?:string}
 |{kind:'WORK';id:string;orchestrationPlanId:string;executionRequestId?:string}
 |{kind:'RECEIPT';id:string;receiptKind:'ORCHESTRATION'|'AGENCY_EXECUTION'|'CAPABILITY'}
 |{kind:'ARTIFACT';id:string;projectId?:string};

export type ConversationCardKind='QUESTION'|'APPROVAL'|'WORK_STATUS'|'RECEIPT'|'ARTIFACT'|'CONNECTION'|'NOTICE';
export type ConversationCardActionKind='OPEN_WORK'|'OPEN_APPROVAL'|'OPEN_CONNECTION'|'ANSWER_QUESTION'|'INSPECT_RECEIPT'|'OPEN_ARTIFACT';
export type ConversationCardAction={id:string;kind:ConversationCardActionKind;label:string;reference?:ConversationReference|null};
export type ConversationCard={id:string;kind:ConversationCardKind;title:string;body:string|null;references:ConversationReference[];actions:ConversationCardAction[]};

export type ConversationBindings={
 intentRef:{id:string}|null;
 orchestrationPlanRef:{id:string;revision?:number}|null;
 questionRefs:{id:string;workPackageId?:string}[];
 approvalRefs:{id:string;actionPlanId?:string}[];
 runningWorkRefs:{id:string;orchestrationPlanId:string;executionRequestId?:string}[];
 receiptRefs:{id:string;receiptKind:'ORCHESTRATION'|'AGENCY_EXECUTION'|'CAPABILITY'}[];
 artifactRefs:{id:string;projectId?:string}[];
};

export type StarliConversationSession={
 id:string;
 schemaVersion:typeof STARLI_CONVERSATION_SCHEMA_VERSION;
 tenantId:string;
 ownerId:string;
 title:string|null;
 taskState:ConversationTaskState;
 bindings:ConversationBindings;
 revision:number;
 lastSequence:number;
 createdAt:string;
 updatedAt:string;
};

export type StarliConversationMessage={
 id:string;
 schemaVersion:typeof STARLI_CONVERSATION_SCHEMA_VERSION;
 conversationId:string;
 tenantId:string;
 ownerId:string;
 sequence:number;
 role:ConversationRole;
 content:string;
 cards:ConversationCard[];
 references:ConversationReference[];
 createdAt:string;
};

export type ConversationActor={userId:string;workspaceTenantId?:string;role?:string};
export type CreateConversationInput={idempotencyKey:string;title?:string|null};
export type SubmitCustomerMessageInput={idempotencyKey:string;content:string};
export type AppendAssistantResponseInput={idempotencyKey:string;content:string;cards?:ConversationCard[];references?:ConversationReference[];taskState?:ConversationTaskState};
export type UpdateConversationBindingsInput={
 taskState?:ConversationTaskState;
 bindings:Partial<ConversationBindings>;
};
export type ConversationReplayPage={
 session:StarliConversationSession;
 messages:StarliConversationMessage[];
 nextCursor:string|null;
 hasMore:boolean;
 lastSequence:number;
};
