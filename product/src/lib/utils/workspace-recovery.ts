/** A recovery destination is local navigation, never an external redirect or secret store. */
export function workspaceReturnPath(value:unknown):string{
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/.test(value))return '/';
 try{const url=new URL(value,'https://workspace.invalid');if(url.origin!=='https://workspace.invalid'||url.pathname.replace(/\/+$/,'')==='/error')return '/';
  for(const key of [...url.searchParams.keys()])if(/^(token|access_token|id_token|code|password|secret|key|signature|state)$/i.test(key))url.searchParams.delete(key);
  return url.pathname+url.search+url.hash;
 }catch{return '/';}
}
