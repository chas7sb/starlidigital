import fs from 'node:fs';

let s = fs.readFileSync('web/src/main.tsx', 'utf8');

const targetStr = "{tab==='crm'&&<AdminCRM client={{}} currentUserId={user?.id} onNavigateProject={(pid)=>navigate('/project/'+pid)}/>}{tab==='mailbox'&&<AdminMailbox userEmail={user?.email}/>}";
const replacementStr = "{tab==='crm'&&<AdminCRM client={{ request: (q: string, v?: any) => gql(q, v) }} currentUserId={user?.id} />}{tab==='mailbox'&&<AdminMailbox />}";

if (s.includes(targetStr)) {
  s = s.replace(targetStr, replacementStr);
  fs.writeFileSync('web/src/main.tsx', s, 'utf8');
  console.log('Successfully replaced CRM & Mailbox component props');
} else {
  console.log('Target string not found');
}
