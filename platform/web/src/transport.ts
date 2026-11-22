/** Only public endpoint addresses belong in VITE_* variables. */
export function resolvePublicEndpoints(apiInput:string|undefined,wsInput:string|undefined,origin:string){
 const page=new URL(origin);
 const rawApi=apiInput?.trim()||'/graphql';
 if(rawApi.startsWith('//')||(!rawApi.startsWith('/')&&!/^https?:\/\//.test(rawApi)))throw new Error('VITE_API_URL must be an HTTP(S) URL or relative path.');
 const api=new URL(rawApi,page);
 if(!['http:','https:'].includes(api.protocol)||api.username||api.password||api.search||api.hash)throw new Error('The public API URL cannot contain credentials or query parameters.');
 if(page.protocol==='https:'&&api.protocol!=='https:')throw new Error('An HTTPS page requires an HTTPS API.');
 const rawWs=wsInput?.trim();
 if(rawWs&&!/^wss?:\/\//.test(rawWs))throw new Error('VITE_WS_URL must be a WS(S) URL.');
 const ws=rawWs?new URL(rawWs):new URL(api);
 if(!rawWs)ws.protocol=api.protocol==='https:'?'wss:':'ws:';
 if(!['ws:','wss:'].includes(ws.protocol)||ws.username||ws.password||ws.search||ws.hash)throw new Error('The public WebSocket URL cannot contain credentials or query parameters.');
 if(page.protocol==='https:'&&ws.protocol!=='wss:')throw new Error('An HTTPS page requires a secure WebSocket.');
 return {api:rawApi.startsWith('/')?api.pathname:api.href,ws:ws.href};
}
