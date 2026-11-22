/** Fail-closed tenant view for legacy domain services. No unowned/global rows. */
export function tenantStore(store:any,owner:string){
 const storageId=(id:string)=>['default-pipeline','bprof-starlidigital-default'].includes(id)?owner+':'+id:id;
 const owns=(collection:string,id:string)=>!!store.db.prepare('SELECT 1 FROM records WHERE collection=? AND id=? AND owner=?').get(collection,storageId(id),owner);
 return new Proxy(store,{
  get(target,key){
   if(key==='list')return(collection:string)=>target.list(collection,owner);
   if(key==='get')return(collection:string,id:string)=>{const row=target.db.prepare('SELECT payload FROM records WHERE collection=? AND id=? AND owner=?').get(collection,storageId(id),owner);return row?JSON.parse(row.payload):undefined;};
   if(key==='put')return(collection:string,value:any)=>{
    const row=target.db.prepare('SELECT owner FROM records WHERE collection=? AND id=?').get(collection,storageId(value.id));
    if(row&&row.owner!==owner)throw Error('RESOURCE_NOT_FOUND');
    const owned={...value,ownerId:owner};
    target.db.prepare('INSERT INTO records(collection,id,owner,payload) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET owner=excluded.owner,payload=excluded.payload').run(collection,storageId(value.id),owner,JSON.stringify(owned));return owned;
   };
   if(key==='remove')return(collection:string,id:string)=>{if(!owns(collection,id))throw Error('RESOURCE_NOT_FOUND');target.remove(collection,storageId(id));};
   if(key==='user')return(id:string)=>id===owner?target.user(id):undefined;
   if(['users','findUser','saveUser','transferGuest','session','createSession'].includes(String(key)))return()=>{throw Error('CUSTOMER_IDENTITY_OPERATION_DENIED');};
   if(key==='db')return {exec:(sql:string)=>{if(!/^(BEGIN IMMEDIATE|COMMIT|ROLLBACK)$/.test(sql))throw Error('RAW_DATABASE_ACCESS_DENIED');return target.db.exec(sql);}};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }
 });
}
export const CUSTOMER_TOOLS=new Set(('projects_list project_get project_manage website_get_structure website_generate assets_list '+
 'crm_search_prospects crm_get_prospect crm_upsert_prospect crm_add_activity crm_list_opportunities '+
 'inbox_search inbox_read outreach_create_draft outreach_get_thread '+
 'agent_create agent_get agent_update agent_configure agent_add_knowledge agent_list_conversations agent_list_customer_leads '+
 'video_project_create video_project_get video_project_list video_project_apply_spec video_project_patch_spec video_validate video_preview_frame video_render_start video_render_status video_output_get video_voiceover_create brand_profile_create brand_profile_get video_asset_upload video_asset_import').split(/\s+/));
