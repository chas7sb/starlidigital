import type {Context} from '../security.js';
import {limit,requireUser} from '../security.js';
import type {AgencyCockpitService} from './service.js';

export function createAgencyCockpitGraphQL({service}:{service:AgencyCockpitService}){
  const typeDefs=/* GraphQL */`
    type AgencyCockpitSnapshotPayload { schemaVersion: Int! generatedAt: String! snapshotJson: String! }
    type AgencyCockpitMutationPayload { schemaVersion: Int! mutationJson: String! }
    input AgencyQuietHoursInput { enabled: Boolean! timezone: String! startLocal: String! endLocal: String! days: [String!]! channels: [String!]! }
    extend type Query { agencyCockpitSnapshot: AgencyCockpitSnapshotPayload! }
    extend type Mutation { agencySetPauseAll(paused:Boolean!):AgencyCockpitMutationPayload! agencySetAutonomyLevel(kind:String!,scopeId:ID!,level:String!,paused:Boolean!):AgencyCockpitMutationPayload! agencyUpdateQuietHours(input:AgencyQuietHoursInput!):AgencyCockpitMutationPayload! agencyResolveApproval(approvalId:ID!,decision:String!):AgencyCockpitMutationPayload! }
  `;
  const customer=(context:Context)=>{const user=requireUser(context);return{id:String(user.id),username:String(user.username||''),role:String(user.role||'CUSTOMER')};};
  const resolvers={Query:{agencyCockpitSnapshot:async(_:unknown,__:unknown,context:Context)=>{const user=customer(context);const snapshot=await service.snapshot(user);return{schemaVersion:1,generatedAt:snapshot.generatedAt,snapshotJson:JSON.stringify(snapshot)};}},Mutation:{agencySetPauseAll:(_:unknown,{paused}:{paused:boolean},context:Context)=>{const user=customer(context);limit(`agency-policy:${user.id}`,60,60000);return{schemaVersion:1,mutationJson:JSON.stringify(service.setPauseAll(user,paused))};},agencySetAutonomyLevel:(_:unknown,input:any,context:Context)=>{const user=customer(context);limit(`agency-policy:${user.id}`,60,60000);return{schemaVersion:1,mutationJson:JSON.stringify(service.setAutonomyLevel(user,{kind:String(input.kind) as any,scopeId:String(input.scopeId),level:String(input.level) as any,paused:!!input.paused}))};},agencyUpdateQuietHours:(_:unknown,{input}:{input:any},context:Context)=>{const user=customer(context);limit(`agency-policy:${user.id}`,60,60000);return{schemaVersion:1,mutationJson:JSON.stringify(service.updateQuietHours(user,input))};},agencyResolveApproval:async(_:unknown,{approvalId,decision}:{approvalId:string;decision:string},context:Context)=>{const user=customer(context);limit(`agency-approval:${user.id}`,30,60000);if(decision!=='APPROVE'&&decision!=='REJECT')throw new Error('Invalid approval decision.');service.resolveApproval(user,String(approvalId),decision);const snapshot=await service.snapshot(user);return{schemaVersion:1,mutationJson:JSON.stringify({snapshot})};}}};
  return{typeDefs,resolvers};
}
