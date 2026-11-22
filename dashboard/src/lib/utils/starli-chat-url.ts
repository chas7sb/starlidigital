/** Human-readable canonical routes; UUID remains the stable conversation identity. */
export function botChatPath(name:unknown,id:unknown):string {
 const ident=String(id??'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ident))return '/';
 const slug=String(name??'starli').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'starli';
 return '/'+slug+'-'+ident;
}
export function chatPath(chat:any):string{return botChatPath(chat?.botName??chat?.title??'starli',chat?.id);}
export function chatIdFromPath(path:string):string|null{return path.match(/^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1]??path.match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1]??null;}
