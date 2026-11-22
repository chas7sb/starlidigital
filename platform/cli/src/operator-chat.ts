import {createInterface} from 'node:readline';
import {stdin,stdout} from 'node:process';
import {randomUUID} from 'node:crypto';
import {OperatorConsole} from './operator-console.js';
import {OperatorTerminal,type OperatorEvent} from './operator-terminal.js';
import type {CliConfig,ParsedArgs} from './index.js';
type Options={parsed:ParsedArgs;config:CliConfig;save:()=>void;query:<T=any>(query:string,variables?:Record<string,unknown>)=>Promise<T>;out:(text:string)=>void;tty:boolean};
const active=new Set(['QUEUED','RUNNING','CANCELING']);
const rejected=new Set(['CONFLICT','FORBIDDEN','UNAUTHENTICATED','NOT_FOUND','BAD_USER_INPUT','RATE_LIMITED']);
const help='/help  /new  /sessions  /use <id>  /history  /tasks  /status  /stop [id]  /resume  /retry  /draft  /paste … /end  /exit';
export async function runOperatorChat({parsed,config,save,query,out,tty}:Options):Promise<any>{
 const prompt=parsed.positionals.slice(1).join(' ').trim();
 let conversationId=typeof parsed.flags.conversation==='string'?parsed.flags.conversation:parsed.flags.new?undefined:config.activeConversationId;
 const pending=[...new Set([...(config.pendingTaskIds||[]),...(config.activeTaskId?[config.activeTaskId]:[])])];
 const monitors=new Map<string,Promise<any>>(),controllers=new Map<string,AbortController>(),taskConversations=new Map<string,string>();
 if(config.activeTaskId&&config.activeConversationId)taskConversations.set(config.activeTaskId,config.activeConversationId);
 let screen:OperatorConsole|undefined,rl:ReturnType<typeof createInterface>|OperatorConsole|undefined,closed=false,eventApi=true,lastResult:any,lastInterrupt=0,sessionVersion=0;
 let submissions=Promise.resolve();const pendingStops=new Set<string>(),pendingVersions=new Map<string,number>(Object.keys(config.pendingStarts||{}).map(id=>[id,0]));
 const fields='id conversationId status progress reply error toolResults{tool ok summary dataJson}';
 const remember=()=>{config.pendingTaskIds=pending.slice(-100);config.activeTaskId=conversationId?pending.find(id=>taskConversations.get(id)===conversationId):undefined;config.taskCursors=Object.fromEntries(Object.entries(config.taskCursors||{}).slice(-100));config.renderedTaskIds=(config.renderedTaskIds||[]).slice(-100);save();screen?.setContext(`${conversationId?.slice(0,8)||'Conversație nouă'} · ${pending.length} sarcini`);};
 const emit=(text:string)=>{if(screen){screen.write(text);return;}if(rl&&tty)stdout.write('\r\x1b[2K');out(text);if(rl&&tty&&!closed)rl.prompt(true);};
 const status=(text:string)=>{if(screen){screen.setActivity(text);return;}if(!tty)return;if(rl){rl.setPrompt(`starli · ${text.slice(0,60)} > `);if(!rl.line)rl.prompt(true);}else stdout.write('\r\x1b[2K'+text.slice(0,Math.max(30,(stdout.columns||100)-2)));};
 const clearStatus=()=>{if(screen){screen.setActivity(pending.length?'Actualizez sarcinile…':'Pregătit');return;}if(tty&&!rl)stdout.write('\r\x1b[2K');};
 const removePending=(id:string)=>{const index=pending.indexOf(id);if(index>=0)pending.splice(index,1);};
 const accepted=(requestId:string,task:any,select=false)=>{if(!task?.id||!task?.conversationId)throw Error('Pornirea nu a fost confirmată. Cererea originală este păstrată pentru /resume.');const index=pending.indexOf(requestId);if(index>=0)pending[index]=task.id;else if(!pending.includes(task.id))pending.push(task.id);taskConversations.set(task.id,task.conversationId);if(select){conversationId=task.conversationId;config.activeConversationId=conversationId;}if(config.pendingStarts)delete config.pendingStarts[requestId];if(config.draftPrompt?.requestId===requestId)config.draftPrompt=undefined;remember();if(pendingStops.delete(requestId))void query<any>('mutation($id:ID!){stopOperatorTask(id:$id){id status error}}',{id:task.id}).then(data=>{if(!parsed.json)emit('Oprire solicitată · '+data.stopOperatorTask.status);}).catch(error=>emit('Oprirea după reconectare nu a fost confirmată: '+String(error)));return task;};
 const recoverStart=async(requestId:string,select=false)=>{const entry=config.pendingStarts?.[requestId];if(!entry)return;
  try{const data=await query<any>(`query($id:ID!){operatorTask(id:$id){${fields}}}`,{id:requestId});return accepted(requestId,data.operatorTask,select);}catch(error){if(String((error as any)?.code)!=='NOT_FOUND')throw error;}
  const data=await query<any>('mutation($conversationId:ID,$text:String!,$requestId:String!){startOperatorTask(conversationId:$conversationId,text:$text,requestId:$requestId){id conversationId status}}',{conversationId:entry.conversationId,text:entry.text,requestId});return accepted(requestId,data.startOperatorTask,select);
 };
 const stop=async(id=config.activeTaskId||pending.find(id=>config.pendingStarts?.[id]&&pendingVersions.get(id)===sessionVersion&&config.pendingStarts[id].conversationId===conversationId))=>{if(!id){if(!parsed.json)emit('Nu există o sarcină activă.');return;}if(config.pendingStarts?.[id]){pendingStops.add(id);if(!parsed.json)emit('Oprirea este înregistrată; o aplic imediat ce serverul confirmă pornirea.');return;}const data=await query<any>('mutation($id:ID!){stopOperatorTask(id:$id){id status error}}',{id});if(!parsed.json)emit('Oprire solicitată · '+data.stopOperatorTask.status);return data.stopOperatorTask;};
 const watch=(taskId:string):Promise<any>=>{const existing=monitors.get(taskId);if(existing)return existing;const controller=new AbortController();controllers.set(taskId,controller);
  const renderer=new OperatorTerminal({write:emit,status,clearStatus,json:parsed.json,receipt:{cursor:config.taskCursors?.[taskId]||0,finalRendered:(config.renderedTaskIds||[]).includes(taskId)},save:receipt=>{config.taskCursors={...config.taskCursors,[taskId]:receipt.cursor};if(receipt.finalRendered&&!config.renderedTaskIds?.includes(taskId))config.renderedTaskIds=[...(config.renderedTaskIds||[]),taskId];remember();}});
  const work=(async()=>{if(config.pendingStarts?.[taskId]){const recovered=await recoverStart(taskId);if(recovered?.id&&recovered.id!==taskId)return await watch(recovered.id);}let failures=0;
   while(!controller.signal.aborted){let data:any;
    try{data=await query<any>(eventApi?`query($id:ID!,$after:Int!){operatorTask(id:$id){${fields}} operatorTaskEvents(id:$id,after:$after,limit:100){sequence kind message dataJson createdAt}}`:`query($id:ID!){operatorTask(id:$id){${fields}}}`,eventApi?{id:taskId,after:renderer.receipt.cursor}:{id:taskId});failures=0;}
    catch(error){const message=error instanceof Error?error.message:String(error);if(eventApi&&/Cannot query field "operatorTaskEvents"|Unknown argument "after"/.test(message)){eventApi=false;if(!parsed.json)emit('Serverul folosește protocolul anterior; afișez numai rezultatul final.');continue;}if(String((error as any)?.code)==='NOT_FOUND'&&!config.pendingStarts?.[taskId]){removePending(taskId);remember();throw Error('Sarcina salvată nu mai există pe server. Nu am retrimis-o. Verifică /history sau formulează o cerere nouă.');}if(rejected.has(String((error as any)?.code))||++failures>3)throw error;if(!parsed.json)status('Reconectez aceeași sarcină…');await new Promise(resolve=>setTimeout(resolve,Math.min(4000,500*2**failures)));continue;}
    const task=data.operatorTask;if(!task)throw Error('Serverul nu a returnat starea sarcinii.');if(task.conversationId)taskConversations.set(taskId,task.conversationId);if(!parsed.json)status(`${task.status==='QUEUED'?'În așteptare':task.status==='RUNNING'?'Lucrează':task.status} · ${task.progress||task.id.slice(0,8)}`);
    const events:OperatorEvent[]=Array.isArray(data.operatorTaskEvents)?data.operatorTaskEvents:[];renderer.events(events);
    if(!active.has(task.status)){if(eventApi&&events.length===100)continue;renderer.final(task.reply||task.error||'Sarcina s-a încheiat: '+task.status,task.status,task);removePending(taskId);remember();if(screen&&!pending.length)screen.setActivity(task.status==='SUCCEEDED'?'Finalizat · pregătit pentru următoarea cerere':`${task.status} · verifică rezultatul`);lastResult=task;return task;}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }return{status:'DETACHED',id:taskId};
  })().finally(()=>{monitors.delete(taskId);controllers.delete(taskId);});monitors.set(taskId,work);return work;
 };
 const start=async(text:string,targetConversation=conversationId,version=sessionVersion,requestId=randomUUID())=>{const entry={text,conversationId:targetConversation,createdAt:new Date().toISOString()};if(!pending.includes(requestId))pending.push(requestId);config.pendingStarts={...config.pendingStarts,[requestId]:entry};config.draftPrompt={...entry,requestId};remember();status('Trimit cererea…');
  try{const data=await query<any>('mutation($conversationId:ID,$text:String!,$requestId:String!){startOperatorTask(conversationId:$conversationId,text:$text,requestId:$requestId){id conversationId status}}',{conversationId:targetConversation,text,requestId});return accepted(requestId,data.startOperatorTask,version===sessionVersion);}
  catch(error){if(rejected.has(String((error as any)?.code))){removePending(requestId);delete config.pendingStarts?.[requestId];if(config.draftPrompt?.requestId===requestId)config.draftPrompt={...entry,error:error instanceof Error?error.message:String(error)};remember();throw error;}try{return await recoverStart(requestId,version===sessionVersion);}catch(recoveryError){remember();throw Error('Confirmarea pornirii s-a pierdut. Cererea originală este salvată; /resume o verifică fără duplicare. '+(recoveryError instanceof Error?recoveryError.message:String(recoveryError)));}}
 };
 const attach=(id:string)=>{void watch(id).catch(error=>{if(!parsed.json)emit('Conexiunea sarcinii s-a oprit: '+(error instanceof Error?error.message:String(error))+'. Folosește /resume; sarcina nu este retrimisă.');});};
 const launch=(text:string)=>{const version=sessionVersion,target=conversationId,requestId=randomUUID(),entry={text,conversationId:target,createdAt:new Date().toISOString()};pending.push(requestId);pendingVersions.set(requestId,version);config.pendingStarts={...config.pendingStarts,[requestId]:entry};config.draftPrompt={...entry,requestId};remember();
  submissions=submissions.then(async()=>{if(closed)return;try{const task=await start(text,version===sessionVersion?conversationId:target,version,requestId);if(!closed)attach(task.id);}catch(error){emit('Eroare: '+(error instanceof Error?error.message:String(error)));screen?.setActivity('Cererea este păstrată · /draft /retry /resume');}});
 };

 if(prompt){let foregroundTask=config.activeTaskId;const interrupt=()=>{void stop(foregroundTask).catch(error=>{if(!parsed.json)emit('Oprirea nu a fost confirmată: '+String(error));});};process.once('SIGINT',interrupt);try{const task=await start(prompt);foregroundTask=task.id;return await watch(task.id);}finally{process.off('SIGINT',interrupt);}}
 if(parsed.flags.reconnect&&pending.length)return await watch(pending[0]);
 if(tty&&!parsed.flags.plain&&!parsed.json&&stdin.isTTY){screen=new OperatorConsole();screen.setContext(`${conversationId?.slice(0,8)||'Conversație nouă'} · ${pending.length} sarcini`);}
 if(!parsed.json){emit('STARLI  /  Agentul privat al platformei');emit(help);}
 rl=screen||createInterface({input:stdin,output:stdout,terminal:tty});rl.setPrompt('starli > ');
 rl.on('SIGINT',()=>{const now=Date.now();if(now-lastInterrupt<1200||!pending.length){closed=true;rl?.close();for(const controller of controllers.values())controller.abort();}else void stop().catch(error=>emit('Oprirea nu a fost confirmată: '+String(error)));lastInterrupt=now;});
 for(const id of pending)attach(id);let paste:string[]|null=null;
 try{if(tty)rl.prompt();for await(const raw of rl){const line=raw.trim();
   if(paste){if(line==='/end'){const text=paste.join('\n').trim();paste=null;try{if(text){emit('Tu\n'+text);launch(text);}}catch(error){emit('Eroare: '+String(error));}if(tty)rl.prompt();}else paste.push(raw);continue;}
   if(!line){if(tty)rl.prompt();continue;}
   try{
    if(['/exit','/iesire','/quit'].includes(line)){closed=true;break;}
    if(['/help','/?'].includes(line))emit(help);
    else if(['/paste','/multiline'].includes(line)){paste=[];emit('Lipește instrucțiunile pe mai multe linii. Încheie cu /end.');}
    else if(['/new','/nou'].includes(line)){sessionVersion++;conversationId=undefined;config.activeConversationId=undefined;remember();emit('Conversație nouă. Sarcinile anterioare continuă separat.');}
    else if(line==='/resume'){for(const id of pending)attach(id);if(!pending.length)emit('Nu există sarcini de reluat.');}
    else if(line==='/retry'){const draft=config.draftPrompt;if(draft?.requestId&&config.pendingStarts?.[draft.requestId])attach(draft.requestId);else if(draft){const task=await start(draft.text,draft.conversationId);attach(task.id);}else emit('Nu există o cerere netrimisă de reîncercat. /resume urmărește sarcinile acceptate.');}
    else if(line==='/draft'){if(config.draftPrompt&&screen){screen.setInput(config.draftPrompt.text);emit('Cererea salvată este în editor. Modific-o sau apasă Enter.');}else if(config.draftPrompt)emit('Cerere netrimisă, păstrată privat:\n'+config.draftPrompt.text+'\n/retry pentru reîncercare.');else emit('Nu există o cerere netrimisă salvată.');}
    else if(line.startsWith('/stop'))await stop(line.split(/\s+/)[1]||config.activeTaskId);
    else if(line==='/sessions'){const data=await query<any>('{operatorConversations{id title status updatedAt}}');emit((data.operatorConversations||[]).slice(0,20).map((session:any)=>`${session.id}  ${session.title}`).join('\n')||'Nicio conversație.');}
    else if(line.startsWith('/use ')){const id=line.slice(5).trim();const data=await query<any>('query($id:ID!){operatorConversation(id:$id){id title}}',{id});if(!data.operatorConversation)throw Error('Conversația nu există.');sessionVersion++;conversationId=data.operatorConversation.id;config.activeConversationId=conversationId;remember();emit('Conversație activă: '+data.operatorConversation.title);}
    else if(line==='/history'){if(!conversationId)emit('Alege o conversație cu /use <id>.');else{const data=await query<any>('query($id:ID!){operatorConversation(id:$id){messages{role content createdAt}}}',{id:conversationId});emit((data.operatorConversation?.messages||[]).slice(-20).map((message:any)=>`${message.role==='user'?'Tu':'Starli'} · ${message.createdAt}\n${message.content}`).join('\n\n')||'Conversația nu are încă mesaje.');}}
    else if(line==='/tasks')emit(pending.map(id=>`${id} · ${taskConversations.get(id)===conversationId?'conversația activă':taskConversations.get(id)||'reconectare'}`).join('\n')||'Nicio sarcină în așteptare.');
    else if(line==='/status'){if(pending.length){for(const id of pending){const data=await query<any>('query($id:ID!){operatorTask(id:$id){id status progress}}',{id});emit(`${data.operatorTask.id} · ${data.operatorTask.status}${data.operatorTask.progress?' · '+data.operatorTask.progress:''}`);}}else emit('Starli este pregătit. Nicio sarcină activă în acest CLI.');}
    else if(line.startsWith('/'))emit('Comandă necunoscută. '+help);
    else{if(screen)emit('Tu\n'+raw);launch(raw);}
   }catch(error){emit('Eroare: '+(error instanceof Error?error.message:String(error)));if(screen)screen.setActivity('Cererea este păstrată · /draft /retry /resume');}
   if(tty)rl.prompt();
  }if(!closed&&!tty){await submissions;await Promise.allSettled([...monitors.values()]);}
 }finally{closed=true;rl.close();for(const controller of controllers.values())controller.abort();}
 return lastResult||{ok:true,conversationId,pendingTaskIds:[...pending]};
}
