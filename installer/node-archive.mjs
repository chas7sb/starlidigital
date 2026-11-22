import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

function matches(bytes, expectedSha256) {
  return /^[a-f0-9]{64}$/.test(expectedSha256) && createHash('sha256').update(bytes).digest('hex') === expectedSha256;
}

export async function cacheVerifiedNodeArchive(archive, expectedSha256, download) {
  function reuse() {
    const info=lstatSync(archive);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || !matches(readFileSync(archive),expectedSha256)) throw new Error(`Existing Node archive failed checksum or regular-file validation; preserved at ${archive}. Inspect or move that file aside before retrying.`);
    return {reused:true};
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Official Node archive checksum is invalid.');
  if (existsSync(archive)) return reuse();
  const bytes=Buffer.from(await download());
  if (!matches(bytes,expectedSha256)) throw new Error('Downloaded Node archive checksum mismatch; archive was not cached.');
  try {writeFileSync(archive,bytes,{flag:'wx'});}
  catch(error){if(error.code==='EEXIST')return reuse();throw error;}
  return {reused:false};
}

export function extractCheckedNodeArchive(archive, destination, expectedSha256) {
  if (!matches(readFileSync(archive),expectedSha256)) throw new Error('Node archive checksum mismatch; extraction refused.');
  // System32 bsdtar supports official Windows ZIPs without loading any PS modules.
  const command = process.platform === 'win32' ? resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/tar.exe') : 'tar';
  const result = spawnSync(command, ['-xf', resolve(archive), '-C', resolve(destination)], {stdio:'inherit',windowsHide:true});
  if (result.error || result.status !== 0) throw new Error(`Verified Node archive extraction failed: ${result.error?.message || `tar exited ${result.status}`}`);
}
