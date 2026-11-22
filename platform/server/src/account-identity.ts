/** Account addresses are local identifiers; they do not provision mailboxes. */
export function accountEmailDomain():string{
 const domain=(process.env.ACCOUNT_EMAIL_DOMAIN||'local.invalid').trim().toLowerCase();
 if(domain.length>253||!domain.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw new Error('ACCOUNT_EMAIL_DOMAIN is invalid.');
 return domain;
}
export function accountEmail(username:string):string{return `${username}@${accountEmailDomain()}`;}
export function accountUsername(value:string):string{
 const name=value.trim().toLowerCase(),suffix='@'+accountEmailDomain();
 return name.endsWith(suffix)?name.slice(0,-suffix.length):name;
}
export function administratorEmail(username:string):string{
 const email=process.env.ADMIN_EMAIL?.trim()||accountEmail(username);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('ADMIN_EMAIL is invalid.');
 return email;
}
