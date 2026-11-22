import fs from 'node:fs';

let s = fs.readFileSync('web/src/main.tsx', 'utf8');

// 1. Add imports at the top
const importsToAdd = "import { AdminCRM } from './crm';\r\nimport { AdminMailbox } from './mailbox';\r\n";
s = importsToAdd + s;

// 2. Add tabs in Admin
const oldTabs = "[['overview','Overview'],['proposals','Client Proposals'],['operator','Starli Operator']";
const newTabs = "[['overview','Overview'],['crm','Starli CRM'],['mailbox','Alex Mailbox'],['proposals','Client Proposals'],['operator','Starli Operator']";
s = s.replace(oldTabs, newTabs);

// 3. Add tab content renderers
const tabAnchor = "{tab==='proposals'&&<OperatorConsole initialTab=\"proposals\"/>}";
const newTabContent = "{tab==='crm'&&<AdminCRM client={{}} currentUserId={user?.id} onNavigateProject={(pid)=>navigate('/project/'+pid)}/>}{tab==='mailbox'&&<AdminMailbox userEmail={user?.email}/>}" + tabAnchor;
s = s.replace(tabAnchor, newTabContent);

fs.writeFileSync('web/src/main.tsx', s, 'utf8');
console.log('web/src/main.tsx successfully updated with CRM and Mailbox tabs');
