import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {DatabaseSync,backup} from 'node:sqlite';
import {createReadStream,createWriteStream} from 'node:fs';import{createGzip}from'node:zlib';import{pipeline}from'node:stream/promises';
mkdirSync('output/private',{recursive:true});
const db=new DatabaseSync('server/data/starli.sqlite',{readOnly:true});try{await backup(db,'output/private/starlidigital-migration.sqlite');}finally{db.close();}
await pipeline(createReadStream('output/private/starlidigital-migration.sqlite'),createGzip(),createWriteStream('output/private/starlidigital-migration.sqlite.gz'));
const entries=['server/src','video-engine/engine','video-engine/requirements.txt','server/package.json','server/tsconfig.json','control-plane/src','control-plane/package.json','control-plane/tsconfig.json','package.json','package-lock.json','web/package.json','cli','device','infra/next-worker','infra/production/install-video-runtime.sh','scripts/backup.mjs'];
const result=spawnSync('tar',['--exclude=__pycache__','--exclude=*.pyc','-czf','output/private/starlidigital-release.tar.gz',...entries],{stdio:'inherit',shell:false});if(result.status!==0)throw new Error('Backend archive failed');
copyFileSync('output/private/production.env','output/private/starlidigital-production.env');
writeFileSync('output/private/release-id.txt',new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14));
console.log('Backend source, SQLite snapshot and private configuration packaged separately.');
