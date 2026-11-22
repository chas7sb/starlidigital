from pathlib import Path
folder=Path('src/lib/components/enterprise/agents')
for name in ['AddBot.svelte','AgentSettings.svelte']:
 p=folder/name;s=p.read_text(encoding='utf-8');s=s.replace(' export let companyId:string;',' export let accessSignal:AbortSignal;\n export let companyId:string;')
 if name=='AddBot.svelte':
  s=s.replace('let client:AddBotClient|null=null','let boundSignal:AbortSignal|undefined;let client:AddBotClient|null=null')
  revoke="function parentRevoked(){client?.forgetSession();client=null;templates=[];canCreate=false;busy=false;loading=false;templateId='';name='';purpose='';instructions='';error='Company access changed. Reopen your workspace.';dispatch('accesschanged',{status:403});}"
  s=s.replace('A new teammate,<br/>ready for their role.','Add a bot').replace('Start with a specialist, then make them your own. Your bot belongs to','Choose a template and configure a new teammate for').replace('font-size:35px;line-height:1.15;letter-spacing:-1.2px','font-size:27px;line-height:1.2;letter-spacing:-.7px')
 else:
  s=s.replace('let client:AgentClient|null=null','let boundSignal:AbortSignal|undefined;let client:AgentClient|null=null')
  revoke='function parentRevoked(){deny({status:403});}'
 binding="\n $: if(ready&&boundSignal!==accessSignal){boundSignal?.removeEventListener('abort',parentRevoked);boundSignal=accessSignal;boundSignal?.addEventListener('abort',parentRevoked,{once:true});if(boundSignal?.aborted)parentRevoked();}\n"
 s=s.replace(' async function load(){',' '+revoke+binding+' async function load(){if(accessSignal?.aborted){parentRevoked();return;}')
 s=s.replace('onDestroy(()=>client?.close());',"onDestroy(()=>{client?.close();boundSignal?.removeEventListener('abort',parentRevoked);});")
 groups={
 '#17243F':['#efeff4','#eeeef2','#dcdce5','#dedee7','#dddde6','#dddde7','#dddde8','#e9e9ef'],
 '#3466F6':['#efb098','#efb299','#efb8a2','#eeb299','#f6c5b9','#f0b29e','#eaa48b','#e8aa92','#db9d8d','#d69a81','#d99a82','#cf927b','#b47e6c'],
 '#71809A':['#77778a','#777789','#9292a3','#9494a5','#9696a6','#9898a7','#9999aa','#9b9baa','#9d9dab','#a7a7b6','#aaaaba','#adadba','#b1b1be','#a0a0b1','#878798','#89899b','#8d8d9e'],
 '#E6EBF4':['#34343f','#33333e','#2e2e39','#2d2d38','#31313c','#30303b'],
 '#FFFFFF':['#20202a','#30252a','#302629','#292024'],
 '#EEF3FF':['#2b262b','#583530'], '#EAF0FF':['#453335','#292431'],
 '#FFF4F4':['#6d2c2828'],'#A62D35':['#ffc0b6'],'#F3D2D5':['#8d474744'],
 '#EFF8F2':['#2d5f3f28'],'#286A46':['#a9d2b6'],'#D8EDDF':['#4a7c5044'],
 '#F6F8FC':['#30303d'],'#AFC2FA':['#786358'],'#C7D2E5':['#656571'],'#DCE6FF':['#a65f5580']}
 for color,old in groups.items():
  for c in old:s=s.replace(c,color)
 s=s.replace('.back:hover{color:white}','.back:hover{color:#3466F6}').replace('#f5bda7','#2855D8')
 p.write_text(s,encoding='utf-8')

