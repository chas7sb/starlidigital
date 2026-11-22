export const VERSION:'starli.panel.v1';
export type Scope={userId:string;kind:'company'|'personal';ownerId:string};
export type ResourceRef={scope:Scope['kind'];ownerId:string;kind:string;id:string};
export type PanelManifest={version:typeof VERSION;type:string;title:string;scopes:Scope['kind'][];capabilities:string[];resourceKinds?:string[];editable?:boolean};
export type Snapshot={value:unknown;revision:number};
export interface PanelAdapter {
 authorize(scope:Scope,ref:ResourceRef,capabilities:readonly string[],signal:AbortSignal):Promise<{allowed:boolean}>;
 read(scope:Scope,ref:ResourceRef,signal:AbortSignal):Promise<Snapshot>;
 edit(scope:Scope,ref:ResourceRef,value:unknown,expectedRevision:number,signal:AbortSignal):Promise<Snapshot>;
 subscribe(scope:Scope,ref:ResourceRef,listener:(event:Snapshot & {revoked?:boolean})=>void,signal:AbortSignal):Promise<()=>void>;
}
export type PanelCommand={version?:typeof VERSION;action?:'open';type:string;ref:ResourceRef;mode?:'docked'|'expanded'|'closed';draft?:unknown};
export interface Panel {key:string;type:string;ref:ResourceRef;mode:'docked'|'expanded'|'closed';state:'loading'|'ready'|'empty'|'error'|'capability';data?:unknown;draft:unknown;revision?:number;renderer?:any;message?:string}
export function resourceKey(ref:ResourceRef):string;
export class PanelRegistry {register(manifest:PanelManifest,loader:()=>Promise<any>):void;get(type:string):any}
export class PanelHost {panels:Map<string,Panel>;constructor(registry:PanelRegistry,adapter:PanelAdapter,storage:Pick<Storage,'getItem'|'setItem'>);subscribe(listener:(panels:Panel[])=>void):()=>void;switchScope(scope:Scope):Promise<void>;open(command:PanelCommand):Promise<Panel|undefined>;assistantOutput(command:PanelCommand):Promise<Panel|undefined>;setMode(key:string,mode:Panel['mode']):void;draft(key:string,value:unknown):void;edit(key:string,value:unknown):Promise<void>;destroy():void}
