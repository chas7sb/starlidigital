from pathlib import Path
p=Path('src/routes/enterprise/+page.svelte');s=p.read_text();s=s.replace(" import {CompanyClient}"," import {parseNativeAuthority} from '$lib/utils/company-authority';\n import {CompanyClient}")
s=s.replace("const current=token;const r=await fetch", "const current=token,lifecycle=ctrl;const r=await fetch")
s=s.replace("if(ctrl.signal.aborted||token!==current)","if(signal.aborted||lifecycle!==ctrl||token!==current)")
s=s.replace("return r.json();}","const data=await r.json();if(signal.aborted||lifecycle!==ctrl||token!==current)throw new DOMException('Session changed','AbortError');return data;}")
start=s.index(' async function initialize()')
helpers="""
 function revoke(status:number,message:string){epoch++;ctrl.abort();client?.close();client=null;ctrl=new AbortController();clearTimeout(refreshTimer);company=null;bots=[];people=[];channels=[];bot=null;channel=null;room=null;messages=[];turns={};draft='';dispatchBot='';pending=null;drafts.clear();writeKeys.clear();reading=false;sending=false;stopping=false;loading=false;menu=false;view='Bots';if(status===401){actor=null;token='';localStorage.removeItem('token');}error=message;}
 async function verifyCompany(version=epoch){if(!company||!actor)return false;const companyId=company.id,actorId=actor.id;let raw;try{raw=await api('/api/v1/companies/'+enc(companyId)+'/capabilities');}catch(e){if(version!==epoch||(e as Error).name==='AbortError')return false;const status=(e as any).status;if([401,403,404].includes(status)){revoke(status,status===401?'Your session expired. Sign in to continue.':'Company access changed. Reload to open an available workspace.');return false;}throw e;}if(version!==epoch)return false;try{const scope=parseNativeAuthority(raw,companyId,actorId);company={...company,scope,role:scope.role,revision:scope.membership_revision};return true;}catch{revoke(403,'Company authority could not be verified. Reload to continue.');return false;}}
 async function accessDenied(status:number,version=epoch){if(version!==epoch)return;if(status===401){revoke(401,'Your session expired. Sign in to continue.');return;}if(![403,404].includes(status))return;try{if(!await verifyCompany(version)||version!==epoch)return;}catch{if(version!==epoch)return;revoke(403,'Access could not be verified. Reload to continue.');return;}if(version!==epoch)return;const key=draftKey();drafts.delete(key);epoch++;room=null;messages=[];turns={};draft='';dispatchBot='';pending=null;error='This conversation is no longer available. Select another conversation.';}
"""
s=s[:start]+helpers+s[start:]
s=s.replace("async function initialize(){loading=true;", "async function initialize(){const lifecycle=ctrl;loading=true;")
s=s.replace("if((e as any).status===401){actor=null;token='';localStorage.removeItem('token');}error=(e as Error).message;}finally{loading=false;}", "if([401,403,404].includes((e as any).status)){revoke((e as any).status,(e as Error).message);return;}error=(e as Error).message;}finally{if(lifecycle===ctrl)loading=false;}")
s=s.replace("async function signin(){signing=true;", "async function signin(){if(ctrl.signal.aborted)ctrl=new AbortController();const lifecycle=ctrl;signing=true;")
s=s.replace("}catch(e){error=(e as Error).message;}finally{signing=false;}","}catch(e){if(lifecycle===ctrl&&(e as Error).name!=='AbortError')error=(e as Error).message;}finally{if(lifecycle===ctrl)signing=false;}")
s=s.replace("stopping=false;loading=false;", "stopping=false;signing=false;loading=false;")
s=s.replace("catch(e){if(version===epoch)error=(e as Error).message;}","catch(e){if(version===epoch){error=(e as Error).message;await accessDenied((e as any).status,version);}}")
s=s.replace("if(!room||reading||ctrl.signal.aborted)return;reading=true;const id=room.id;try{", "if(!company||reading||ctrl.signal.aborted)return;reading=true;const lifecycle=ctrl;try{if(!await verifyCompany(version)||version!==epoch||!room)return;const id=room.id;")
s=s.replace("if([401,403,404].includes((e as any).status)){room=null;messages=[];turns={};}","await accessDenied((e as any).status,version);")
s=s.replace("}finally{reading=false;}","}finally{if(lifecycle===ctrl)reading=false;}")
s=s.replace("if(version===epoch)error=(e as Error).message+' Your draft is kept. Refresh before retrying an unconfirmed delivery.';", "if(version===epoch){error=(e as Error).message+' Your draft is kept. Refresh before retrying an unconfirmed delivery.';await accessDenied((e as any).status,version);}")
s=s.replace("async function stop(){if(stopping)return;stopping=true;", "async function stop(){if(stopping)return;const version=epoch;stopping=true;")
s=s.replace("const t=verifiedCompanyTurn(d,company.id,room.id,turn.assistantMessageId);", "if(version!==epoch||!company||!room)return;const t=verifiedCompanyTurn(d,company.id,room.id,turn.assistantMessageId);")
s=s.replace("error=(e as Error).message+' Stop is unconfirmed. Refresh to check the run.';", "if(version===epoch){error=(e as Error).message+' Stop is unconfirmed. Refresh to check the run.';await accessDenied((e as any).status,version);}")
a=s.index(' function session(');b=s.index('\n onMount(',a)
s=s[:a]+" function session(e:StorageEvent){if(e.key==='token'||e.key===null){revoke(0,'Your session changed. Sign in to continue.');actor=null;token='';password='';}}"+s[b:]
s=s.replace("<Activity turn={turns[m.id]}","<Activity accessSignal={ctrl.signal} turn={turns[m.id]}").replace("<Activity {turn}","<Activity accessSignal={ctrl.signal} {turn}")
s=s.replace("on:refresh={refreshSoon} on:state=", "on:denied={e=>void accessDenied(e.detail.status)} on:refresh={refreshSoon} on:state=")
p.write_text(s)
p=Path('src/lib/components/enterprise/Activity.svelte');s=p.read_text().replace(' export let turn:CompanyTurn;', ' export let turn:CompanyTurn;export let accessSignal:AbortSignal;')
s=s.replace("if(!r.ok)throw Error('Live activity unavailable');", "if([401,403,404].includes(r.status)){dispatch('denied',{status:r.status});halt();throw Error('Activity access changed');}if(!r.ok)throw Error('Live activity unavailable');")
s=s.replace("if(token!==localStorage.token||controller.signal.aborted)return;", "if(token!==localStorage.token||controller.signal.aborted||accessSignal.aborted)return;")
s=s.replace(" onMount(()=>{mounted=true;", " function halt(){controller.abort();state={cursor:0,status:'',tools:[]};error='';}\n onMount(()=>{mounted=true;accessSignal.addEventListener('abort',halt,{once:true});if(accessSignal.aborted){halt();return;}" )
s=s.replace("void follow();});onDestroy", "void follow();return()=>accessSignal.removeEventListener('abort',halt);});onDestroy")
p.write_text(s)
