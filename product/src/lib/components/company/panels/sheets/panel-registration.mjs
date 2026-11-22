export const sheetsManifest=Object.freeze({version:'starli.panel.v1',type:'resource.sheet',title:'Sheets',scopes:['company'],capabilities:['read'],resourceKinds:['sheet'],editable:true});
export function registerSheetsPanel(registry,loader=()=>import('./SheetsPanel.svelte')) {
  registry.register(sheetsManifest,loader);
  return registry;
}
