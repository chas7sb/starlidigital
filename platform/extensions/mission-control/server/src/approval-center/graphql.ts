import type {Context} from '../security.js';
import {limit,requireUser} from '../security.js';
import type {ApprovalCenterService} from './service.js';
export function createApprovalCenterGraphQL({service}:{service:ApprovalCenterService}){
  const typeDefs=/* GraphQL */`
    type ApprovalCenterPayload { schemaVersion:Int! generatedAt:String! snapshotJson:String! }
    extend type Query { approvalCenterSnapshot(receiptLimit:Int,receiptBefore:String):ApprovalCenterPayload! }
    extend type Mutation { approvalCenterResolve(approvalId:ID!,decision:String!):ApprovalCenterPayload! }
  `;
  const customer=(context:Context)=>{const user=requireUser(context);return{id:String(user.id)};};
  const resolvers={Query:{approvalCenterSnapshot:(_:unknown,args:{receiptLimit?:number;receiptBefore?:string},context:Context)=>{const user=customer(context);limit(`approval-center-read:${user.id}`,120,60000);const snapshot=service.snapshot(user.id,args);return{schemaVersion:1,generatedAt:snapshot.generatedAt,snapshotJson:JSON.stringify(snapshot)}}},Mutation:{approvalCenterResolve:(_:unknown,{approvalId,decision}:{approvalId:string;decision:string},context:Context)=>{const user=customer(context);limit(`approval-center-write:${user.id}`,30,60000);if(decision!=='APPROVE'&&decision!=='REJECT')throw new Error('Invalid approval decision.');service.resolve(user.id,String(approvalId),decision,user.id);const snapshot=service.snapshot(user.id);return{schemaVersion:1,generatedAt:snapshot.generatedAt,snapshotJson:JSON.stringify(snapshot)}}}};
  return{typeDefs,resolvers};
}
