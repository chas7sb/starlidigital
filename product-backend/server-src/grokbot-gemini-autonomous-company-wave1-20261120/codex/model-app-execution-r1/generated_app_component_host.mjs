// Component host for actual worker-generated backend source. Not a native preview authority.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const [source,dbPath,companyId]=process.argv.slice(2);
const {createPetRepository}=await import(pathToFileURL(source).href);
const db=new DatabaseSync(dbPath),repository=createPetRepository(db);
let active=true;
const server=createServer(async(req,res)=>{
 if(!active){res.writeHead(403);res.end('revoked component lease');return}
 try{
  if(req.method==='POST'){let text='';for await(const part of req)text+=part;res.setHeader('content-type','application/json');res.end(JSON.stringify(repository.create(companyId,JSON.parse(text))))}
  else {res.setHeader('content-type','application/json');res.end(JSON.stringify(repository.list(companyId)))}
 }catch{res.writeHead(400);res.end('invalid component request')}
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port,pid:process.pid})+'\n'));
process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{if(text.includes('REVOKE'))active=false;if(text.includes('CLOSE'))server.close(()=>{db.close();process.exit(0)})});
