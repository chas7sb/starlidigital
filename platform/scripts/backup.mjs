import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
config({path:resolve(root,'.env'),quiet:true});
const source=process.env.DATABASE_PATH?resolve(process.env.DATABASE_PATH):resolve(root,'server/data/starli.sqlite');
if(!existsSync(source))throw new Error('Baza de date nu există. Pornește întâi API-ul.');
const folder=resolve(process.argv[2]||resolve(root,'backups'));mkdirSync(folder,{recursive:true});
const target=resolve(folder,`starli-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try{
  await backup(db,target);
  const copy=new DatabaseSync(target,{readOnly:true});
  try{const result=copy.prepare('PRAGMA integrity_check').get();if(Object.values(result||{})[0]!=='ok')throw new Error('Verificarea backupului a eșuat.');const tables=copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();if(!tables.some(t=>t.name==='users')||!tables.some(t=>t.name==='records'))throw new Error('Backupul nu conține schema platformei.');}
  finally{copy.close();}
  console.log(`Backup SQLite verificat: ${target}`);
  console.log('Copiază backupul într-un spațiu protejat în afara acestei mașini. Conține date private.');
}finally{db.close();}
