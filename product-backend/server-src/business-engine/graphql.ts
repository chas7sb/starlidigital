import type {Context} from '../security.js';
import {limit,requireUser} from '../security.js';
import type {Events} from '../events.js';
import type {Store} from '../store.js';
import {BusinessEngineCompiler} from './compiler.js';
import type {RecipeId} from './domain.js';
import {BusinessEngineService} from './service.js';

const RECIPES:Array<{id:RecipeId;name:string;description:string}>=[
  {id:'local-service',name:'Local Service Engine',description:'Presence, lead capture, qualification and conversion review.'},
  {id:'clinic-dental',name:'Clinic / Dental Engine',description:'Patient discovery, enquiry support, booking requests and acquisition review.'},
  {id:'restaurant-cafe',name:'Restaurant / Cafe Engine',description:'Local discovery, menu/creative system and guest enquiry support.'},
  {id:'ecommerce',name:'Ecommerce Engine',description:'Store presence, commerce backend, checkout conversion and distribution.'},
  {id:'saas',name:'SaaS Launch Engine',description:'Marketing presence, product backend, activation, support and analytics.'},
  {id:'booking-business',name:'Booking Business Engine',description:'Discovery, booking infrastructure, conversion and operations.'},
  {id:'professional-services',name:'Professional Services Engine',description:'Authority, lead acquisition, proposals and client onboarding.'},
  {id:'ai-support',name:'AI Support Engine',description:'AI support agent, knowledge integration and support-quality review.'},
  {id:'ai-sales',name:'AI Sales Engine',description:'AI sales agent, lead capture and qualification analytics.'},
  {id:'b2b-lead-generation',name:'B2B Lead Engine',description:'Targeting plan, qualification/follow-up and outbound funnel analytics.'},
];
const recipeIds=new Set(RECIPES.map(recipe=>recipe.id));
const cleanList=(value:unknown)=>Array.isArray(value)?value.map(v=>String(v).trim()).filter(Boolean).slice(0,20):[];

export function createBusinessEngineGraphQL({store,events}:{store:Store;events:Events}){
  const sink={emit(event:any){events.company({type:event.type,source:event.source,occurredAt:event.occurredAt,entities:event.entities,payload:event.payload,idempotencyKey:`${event.type}:${event.entities?.[0]?.id||'engine'}:${event.occurredAt}`});}};
  const service=new BusinessEngineService(store,sink);
  const compiler=new BusinessEngineCompiler();
  const typeDefs=/* GraphQL */`
    type BusinessEngineRecipe { id: String! name: String! description: String! }
    type BusinessEngineListPayload { schemaVersion: Int! enginesJson: String! }
    type BusinessEnginePayload { schemaVersion: Int! engineJson: String! }
    type BusinessEngineCreatePayload { schemaVersion: Int! engineJson: String! compilerJson: String! }
    input BusinessEngineGoalInput { name: String! objective: String! customerPromise: String targetCustomer: String offers: [String!] }
    input BusinessEngineCreateInput { recipeId: String! goal: BusinessEngineGoalInput! idempotencyKey: String! }
    extend type Query {
      businessEngineRecipes: [BusinessEngineRecipe!]!
      businessEngines: BusinessEngineListPayload!
      businessEngine(id: ID!): BusinessEnginePayload!
    }
    extend type Mutation { createBusinessEngine(input: BusinessEngineCreateInput!): BusinessEngineCreatePayload! }
  `;
  const actor=(context:Context)=>{const user=requireUser(context);return{userId:String(user.id),role:user.role==='ADMIN'?'ADMIN':'CUSTOMER'} as const;};
  const resolvers={
    Query:{
      businessEngineRecipes:()=>RECIPES,
      businessEngines:(_:unknown,__:unknown,context:Context)=>{const a=actor(context);return{schemaVersion:1,enginesJson:JSON.stringify(service.listEngines(a).slice(0,50).map(engine=>service.summary(a,engine.id)))}} ,
      businessEngine:(_:unknown,{id}:{id:string},context:Context)=>{const a=actor(context),engine=service.getEngine(a,id);return{schemaVersion:1,engineJson:JSON.stringify({engine,summary:service.summary(a,id),versions:service.listVersions(a,id).slice(-25)})};},
    },
    Mutation:{
      createBusinessEngine:(_:unknown,{input}:any,context:Context)=>{const a=actor(context);limit(`business-engine-create:${a.userId}`,12,3600000);const recipeId=String(input.recipeId||'') as RecipeId;if(!recipeIds.has(recipeId))throw new Error('Unknown Business Engine recipe.');const idempotencyKey=String(input.idempotencyKey||'').trim();if(!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey))throw new Error('Invalid Business Engine request key.');const goal={name:String(input.goal?.name||''),objective:String(input.goal?.objective||''),customerPromise:input.goal?.customerPromise?String(input.goal.customerPromise):undefined,targetCustomer:input.goal?.targetCustomer?String(input.goal.targetCustomer):undefined,offers:cleanList(input.goal?.offers)};const compiled=compiler.compile({goal,recipeId,policy:{autonomy:'LOW',defaultApprovalClass:'REVIEW'}});let engine=service.createEngine(a,{name:goal.name,objective:goal.objective,idempotencyKey});if(!engine.blueprint)engine=service.saveBlueprint(a,engine.id,compiled.blueprint);else if(JSON.stringify(engine.blueprint)!==JSON.stringify(compiled.blueprint))throw new Error('Business Engine request key already exists with a different blueprint.');const version=service.createVersion(a,engine.id,{idempotencyKey:`version:${idempotencyKey}`});return{schemaVersion:1,engineJson:JSON.stringify({engine:service.getEngine(a,engine.id),summary:service.summary(a,engine.id),version}),compilerJson:JSON.stringify({artifactPlan:compiled.artifactPlan,backendPlan:compiled.backendPlan,agentPlan:compiled.agentPlan,channelPlan:compiled.channelPlan,workflowPlan:compiled.workflowPlan,kpiPlan:compiled.kpiPlan,approvalPlan:compiled.approvalPlan,buildPhases:compiled.buildPhases,operatingRoutines:compiled.operatingRoutines})};},
    }
  };
  return{typeDefs,resolvers};
}
