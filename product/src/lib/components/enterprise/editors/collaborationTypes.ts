import type {Extension} from '@codemirror/state';
import type {EnterpriseFileRef,NativeFileSession} from './enterpriseFileClient';
export type CollaborativeState={connected:boolean;readOnly:boolean;revoked:boolean;conflict:boolean;dirty:boolean;revision:number;seq:number;pending:number;peers:number;error?:string};
export interface CollaborativeFileSession{readonly ref:EnterpriseFileRef;readonly text:string;extension:Extension;state:CollaborativeState;subscribe(listener:(state:CollaborativeState)=>void):()=>void;checkpoint():Promise<{revision:number;seq:number}>;dispose():void;}
export type CollaborationFactory=(ref:EnterpriseFileRef,session:NativeFileSession)=>Promise<CollaborativeFileSession>;
