/** Native WebUI service identities must never enter password login or recovery. */
export type PasswordAccount={disabled?:unknown;passwordLoginEnabled?:unknown;identityAuthority?:unknown};
export function passwordAuthAllowed<T extends object>(user:T|null|undefined):user is T{
 const account=user as (T & PasswordAccount)|null|undefined;
 return !!account&&!account.disabled&&account.passwordLoginEnabled!==false&&account.identityAuthority!=='OPENWEBUI_NATIVE';
}
