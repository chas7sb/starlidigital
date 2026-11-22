import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Store} from '../store.js';

/** Preview state is independent. Existing first-party login is consulted through
 * a read-only SQLite attachment; no production users, sessions or tokens are copied. */
export function attachReadOnlyOperatorAuth(store:Store,path:string){
 if(!isAbsolute(path))throw Error('MC_AUTH_ABSOLUTE_PATH_REQUIRED');
 const url=pathToFileURL(path);url.searchParams.set('mode','ro');
 store.db.prepare('ATTACH DATABASE ? AS mc_auth').run(url.href);
 store.db.exec(`CREATE TEMP VIEW sessions AS SELECT token_hash,user_id,expires_at FROM mc_auth.sessions;
 CREATE TEMP VIEW users AS SELECT id,username,payload FROM mc_auth.users;`);
}
