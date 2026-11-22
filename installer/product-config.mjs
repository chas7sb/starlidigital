import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

export function validateFirstRunStatus(value) {
  if (!value || typeof value.setupRequired !== 'boolean' || value.singleCompany !== true || value.registrationAllowed !== false) throw new Error('Authoritative single-company first-run status is unavailable or invalid.');
  return {setupRequired:value.setupRequired,singleCompany:true,registrationAllowed:false};
}

// Metadata only: never create credentials, replace an existing instance, or reset state.
export function persistNewInstanceConfig(path, config) {
  mkdirSync(dirname(path),{recursive:true});
  try {writeFileSync(path,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});return true;}
  catch(error){if(error.code==='EEXIST')return false;throw error;}
}
