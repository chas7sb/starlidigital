/** Stable company panel IDs. Services advertise capabilities and safe summaries. */
export const companyPanels=[
 {id:'people',name:'People and bot roles',description:'Company administration and explicit bot grants.'},
 {id:'bots',name:'AI AGENT BOTS',description:'Discover templates, review their permissions and install into this company.'},
 {id:'integrations',name:'Integrations',description:'Company connections and your integration drafts.'},
 {id:'drive',name:'Drive',description:'Authorized company files and folders.'},
 {id:'mail',name:'Mail',description:'Connected company mailboxes.'},
 {id:'email-studio',name:'Email Studio',description:'Draft and review company email content.'},
 {id:'sheets',name:'Sheets',description:'Authorized company spreadsheets.'},
 {id:'domains',name:'Domains',description:'Actual zone state and permitted company DNS operations.'}
] as const;
export type CompanyPanelId=typeof companyPanels[number]['id'];
