const fail=code=>{throw Object.assign(Error(code),{status:422})};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,allowed)=>{if(!object(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('APP_SCHEMA_SHAPE_INVALID')};
const name=x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(x)&&!['id','constructor','prototype','__proto__'].includes(x);
const text=(x,n)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
export function validateAppSchema(app,routes){
 exact(app,['schemaVersion','name','description','collections']);
 if(app.schemaVersion!==1||!text(app.name,100)||!text(app.description,500)||!Array.isArray(app.collections)||app.collections.length<1||app.collections.length>4)fail('APP_SCHEMA_INVALID');
 const collections=new Set();
 for(const c of app.collections){
  exact(c,['name','label','fields']);if(!name(c.name)||collections.has(c.name)||!text(c.label,100)||!Array.isArray(c.fields)||c.fields.length<1||c.fields.length>10)fail('APP_COLLECTION_INVALID');
  collections.add(c.name);const fields=new Set();
  for(const f of c.fields){
   exact(f,['name','label','type','required','options']);
   if(!name(f.name)||fields.has(f.name)||!text(f.label,100)||!['text','email','number','boolean','select','date'].includes(f.type)||typeof f.required!=='boolean')fail('APP_FIELD_INVALID');
   fields.add(f.name);
   if(f.type==='select'){if(!Array.isArray(f.options)||f.options.length<1||f.options.length>20||f.options.some(v=>!text(v,100))||new Set(f.options).size!==f.options.length)fail('APP_SELECT_INVALID')}
   else if(f.options!==undefined)fail('APP_FIELD_OPTIONS_DENIED');
  }
 }
 exact(routes,['schemaVersion','collections']);
 if(routes.schemaVersion!==1||!Array.isArray(routes.collections)||routes.collections.length!==collections.size)fail('APP_ROUTES_INVALID');
 const seen=new Set();
 for(const r of routes.collections){exact(r,['name','operations']);if(!collections.has(r.name)||seen.has(r.name)||!Array.isArray(r.operations)||JSON.stringify([...r.operations].sort())!==JSON.stringify(['create','delete','list','update']))fail('APP_ROUTE_INVALID');seen.add(r.name)}
 return app;
}
export function validateRecord(schema,collection,value){
 const c=schema.collections.find(c=>c.name===collection);if(!c)throw Object.assign(Error('COLLECTION_NOT_FOUND'),{status:404});
 if(!object(value)||Object.keys(value).some(k=>!c.fields.some(f=>f.name===k)))fail('RECORD_FIELD_DENIED');
 const result={};
 for(const f of c.fields){
  const v=value[f.name],empty=v===undefined||v===null||v==='';
  if(empty){if(f.required)fail('REQUIRED_FIELD_'+f.name.toUpperCase());continue}
  if(f.type==='number'){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)fail('INVALID_NUMBER');}
  else if(f.type==='boolean'){if(typeof v!=='boolean')fail('INVALID_BOOLEAN')}
  else{
   if(typeof v!=='string'||v.length>4000)fail('INVALID_TEXT');
   if(f.type==='email'&&!/^[^ @]+@[^ @]+[.][^ @]+$/.test(v))fail('INVALID_EMAIL');
   if(f.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(v))fail('INVALID_DATE');
   if(f.type==='select'&&!f.options.includes(v))fail('INVALID_OPTION');
  }
  Object.defineProperty(result,f.name,{value:v,enumerable:true,writable:false});
 }
 return result;
}
