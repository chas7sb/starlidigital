// Trusted loader entry. Agent11's registry controls authenticated service availability.
export const emailPanelManifest=Object.freeze({version:'starli.panel.v1',type:'resource.email',title:'Email Studio',scopes:['company'],capabilities:['read'],resourceKinds:['email'],editable:true});
export const emailPanelExtension=Object.freeze({manifest:emailPanelManifest,loader:()=>import('./EmailStudioPanel.svelte')});
export function registerEmailPanel(registry,{authenticatedServiceMounted=false}={}){
 if(authenticatedServiceMounted!==true)return false;
 registry.register(emailPanelManifest,emailPanelExtension.loader);return true;
}
