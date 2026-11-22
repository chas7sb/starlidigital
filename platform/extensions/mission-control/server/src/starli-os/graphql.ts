import type {Events} from '../events.js';
import type {Context} from '../security.js';
import {requireUser,limit} from '../security.js';
import type {Store} from '../store.js';
import {StarliAggregateService} from './service.js';
import type {MediaWorkspaceService} from '../media-workspace/service.js';
import type {CustomerConnectorRegistry} from '../customer-capabilities/connectors/registry.js';
export function createStarliAggregateGraphQL({store,events,media,connectorRegistry}:{store:Store;events?:Events;media?:MediaWorkspaceService;connectorRegistry?:CustomerConnectorRegistry}){
 const service=new StarliAggregateService(store,events,media,connectorRegistry);
 const payload=(data:unknown)=>({schemaVersion:1,dataJson:JSON.stringify(data)});
 const tenant=(ctx:Context)=>{const user=requireUser(ctx);limit(`starli-aggregate:${user.id}`,120,60000);return String(user.id);};
 const typeDefs=`type StarliAggregatePayload { schemaVersion:Int! dataJson:String! }
 extend type Query {
 starliHomeSnapshot:StarliAggregatePayload!
 starliWorkspaceSnapshot(projectId:ID!,artifactCursor:String):StarliAggregatePayload!
 starliConnections:StarliAggregatePayload!
 starliTrust:StarliAggregatePayload!
 starliHomeActivity(afterSequence:Int,limit:Int):StarliAggregatePayload!
 }
 extend type Mutation { starliSetGlobalPause(paused:Boolean!):StarliAggregatePayload! }`;
 return {typeDefs,resolvers:{Query:{
 starliHomeSnapshot:(_:unknown,_a:unknown,c:Context)=>payload(service.home(tenant(c))),
 starliWorkspaceSnapshot:(_:unknown,a:{projectId:string;artifactCursor?:string},c:Context)=>payload(service.workspace(tenant(c),String(a.projectId),a.artifactCursor)),
 starliConnections:(_:unknown,_a:unknown,c:Context)=>payload(service.connections(tenant(c))),
 starliTrust:(_:unknown,_a:unknown,c:Context)=>payload(service.trust(tenant(c))),
 starliHomeActivity:(_:unknown,a:{afterSequence?:number;limit?:number},c:Context)=>payload(service.activity(tenant(c),a.afterSequence??0,a.limit??30))
 },Mutation:{starliSetGlobalPause:(_:unknown,a:{paused:boolean},c:Context)=>{const id=tenant(c);limit(`starli-pause:${id}`,30,60000);service.policy.setPauseAll(id,a.paused);return payload(service.trust(id));}}}};
}
