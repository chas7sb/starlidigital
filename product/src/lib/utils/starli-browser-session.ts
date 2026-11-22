export function browserURL(value: string): string {
 const url = new URL(value.includes('://') ? value : 'https://' + value);
 if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Enter a public HTTP or HTTPS website.');
 return url.href;
}

/** Serializes screenshots and actions; an invalidated account cannot deliver late frames. */
export class BrowserRequestError extends Error {constructor(message:string,readonly status:number){super(message);}}
export class BrowserSession {
 private generation = 0;
 private queue: Promise<unknown> = Promise.resolve();
 private controllers = new Set<AbortController>();
 constructor(private token: string, private currentToken: () => string, private transport: typeof fetch = fetch) {}
 invalidate() { this.generation++; for (const c of this.controllers) c.abort(); this.controllers.clear(); }
 request(path: string, method = 'GET', payload?: unknown): Promise<any> {
  const generation = this.generation;
  const run = async () => {
   if (generation !== this.generation || this.currentToken() !== this.token) throw Error('Account changed. Reopen the browser.');
   const controller = new AbortController(); this.controllers.add(controller);
   const timeout = setTimeout(() => controller.abort(), 30000);
   try {
    const response = await this.transport('/api/v1/starli/browser/' + path, {
     method, headers: {Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json'},
     ...(payload === undefined ? {} : {body: JSON.stringify(payload)}), signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (generation !== this.generation || this.currentToken() !== this.token) throw Error('Account changed. Reopen the browser.');
    if (!response.ok) throw new BrowserRequestError(response.status === 403 ? 'Interactive access is no longer available for this conversation. Check access again.' : typeof data.detail === 'string' ? data.detail : 'Browser request failed (' + response.status + ')',response.status);
    if (path === 'session') {
     if (data.closed !== true) throw Error('Browser returned an invalid close response.');
    } else if (typeof data.available !== 'boolean' || (data.available && (typeof data.url !== 'string' || typeof data.image !== 'string' || !data.image.startsWith('data:image/jpeg;base64,')))) {
     throw Error('Browser returned an invalid frame. Try refreshing.');
    }
    return data;
   } finally { clearTimeout(timeout); this.controllers.delete(controller); }
  };
  const result = this.queue.then(run); this.queue = result.catch(() => {}); return result;
 }
}

export async function verifyBrowserIdentity(token: string, userId: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<void> {
 const bounded=new AbortController(),abort=()=>bounded.abort();if(signal.aborted)bounded.abort();else signal.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(()=>bounded.abort(),10000);
 try{
  const response = await transport('/api/v1/auths/', {headers:{Authorization:'Bearer '+token},signal:bounded.signal});
  const principal = await response.json().catch(()=>null);
  if (!response.ok || principal?.id !== userId) throw Error('Native account identity could not be confirmed. Refresh and sign in again.');
 }finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
}

export type ManualBrowserScope={chatId:string;expectedAgentId:string};
export function browserScopeQuery(scope:ManualBrowserScope){return new URLSearchParams(scope).toString();}
export function manualBrowserPayload(scope:ManualBrowserScope,frame:any,action:Record<string,unknown>){
 if(!scope.chatId||!scope.expectedAgentId||typeof frame?.browserSessionId!=='string'||frame.browserSessionId.length<16||!Number.isInteger(frame.frameVersion)||frame.frameVersion<1)throw Error('Refresh the interactive browser before acting.');
 return {...action,...scope,browserSessionId:frame.browserSessionId,frameVersion:frame.frameVersion};
}
