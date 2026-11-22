import {useState,useEffect} from 'react';
import {Layers,RefreshCw,Mail,ShieldCheck,Check,Sparkles,Brain,Activity,LoaderCircle} from 'lucide-react';
import {gql,subscribe} from './api';
import type {Integration} from './api';

type OutlierDiag = {
  ok: boolean;
  summary: string;
  model: string;
  conversationId?: string | null;
  cookiePresent: boolean;
  csrfTokenPresent: boolean;
  autoCreateConversation: boolean;
};

type OutlierPing = {
  ok: boolean;
  status: number;
  model: string;
  conversationId?: string | null;
  detail: string;
};

const requirements:Record<string,string[]>={ai:['OPENAI_API_KEY / STARLI_COOKIE','OPENAI_MODEL / STARLI_MODEL'],outlier:['STARLI_COOKIE','STARLI_CSRF_TOKEN','STARLI_MODEL','STARLI_AUTO_CREATE_CONVERSATION=1'],images:['OPENAI_API_KEY (always OpenAI)','ENABLE_IMAGE_GENERATION=true','OPENAI_IMAGE_MODEL'],research:['OPENAI_API_KEY','ENABLE_MARKET_RESEARCH=true'],vercel:['VERCEL_TOKEN','VERCEL_TEAM_ID (if team is used)'],payments:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_SITE_PRICE_CENTS','STRIPE_CURRENCY'],email:['RESEND_API_KEY','EMAIL_OUTBOX_KEY','EMAIL_FROM','RESEND_WEBHOOK_SECRET (delivery webhooks)'],domains:['Registrar connected','Supported extension & current quote'],runtime:['NEXT_WORKER_ENABLED','Docker Worker available']};

export function IntegrationDiagnostics({activeProvider,aiFallbackEnabled=true,onSwitchProvider}:{activeProvider?:'OPENAI'|'OUTLIER';aiFallbackEnabled?:boolean;onSwitchProvider?:(provider:'OPENAI'|'OUTLIER',fallback?:boolean)=>void}){
  const[integrations,setIntegrations]=useState<Integration[]>([]),[error,setError]=useState('');
  const[diag,setDiag]=useState<OutlierDiag|null>(null);
  const[model,setModel]=useState(''),[cookie,setCookie]=useState(''),[csrf,setCsrf]=useState(''),[convId,setConvId]=useState('');
  const[pingResult,setPingResult]=useState<OutlierPing|null>(null),[busy,setBusy]=useState(false),[savedMsg,setSavedMsg]=useState('');

  async function load(){
    try{
      const d=await gql<{platform:{integrations:Integration[]};outlierDiagnostics:OutlierDiag}>('{platform{integrations{id name status detail}} outlierDiagnostics{ok summary model conversationId cookiePresent csrfTokenPresent autoCreateConversation}}');
      setIntegrations(d.platform.integrations);
      setDiag(d.outlierDiagnostics);
      setModel(d.outlierDiagnostics.model||'claude-opus-4-6');
      setConvId(d.outlierDiagnostics.conversationId||'');
      setError('');
    }catch(e){setError((e as Error).message);}
  }
  useEffect(()=>{void load();return subscribe<{platformUpdated:{integrations:Integration[]}}>('subscription{platformUpdated{integrations{id name status detail}}}',{},d=>setIntegrations(d.platformUpdated.integrations));},[]);

  async function saveOutlier(e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('');setSavedMsg('');
    try{
      const d=await gql<{updateOutlierConfig:OutlierDiag}>('mutation($model:String,$cookie:String,$csrfToken:String,$conversationId:String){updateOutlierConfig(model:$model,cookie:$cookie,csrfToken:$csrfToken,conversationId:$conversationId){ok summary model conversationId cookiePresent csrfTokenPresent autoCreateConversation}}',{model,cookie:cookie||undefined,csrfToken:csrf||undefined,conversationId:convId||undefined});
      setDiag(d.updateOutlierConfig);setCookie('');setCsrf('');setSavedMsg('Outlier configuration saved.');await load();
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }

  async function testOutlier(rotateIfNeeded=false){
    setBusy(true);setError('');setPingResult(null);
    try{
      const d=await gql<{pingOutlierConnection:OutlierPing}>('mutation($rotateIfNeeded:Boolean){pingOutlierConnection(rotateIfNeeded:$rotateIfNeeded){ok status model conversationId detail}}',{rotateIfNeeded});
      setPingResult(d.pingOutlierConnection);
      if(d.pingOutlierConnection.conversationId)setConvId(d.pingOutlierConnection.conversationId);
      await load();
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }

  return <section>
    <div className="users-heading"><div><h3>Integrations & Settings</h3><p>Configuration is held on the server. No secret API keys are exposed to the browser.</p></div><button className="icon-button" aria-label="Refresh integrations" onClick={()=>void load()}><RefreshCw size={16}/></button></div>
    {onSwitchProvider&&<div className="settings-panel provider-panel">
      <div>
        <h3><Brain size={18}/> Active Provider for Starli AI</h3>
        <p>Switch between OpenAI API and Outlier Client for real-time streaming chat, Next.js iterative build generation, and blog writing. Hero/logo PNG image generation always runs on OpenAI.</p>
        <label className="toggle-label" style={{marginTop:'12px'}}><input type="checkbox" checked={aiFallbackEnabled} onChange={e=>onSwitchProvider(activeProvider||'OPENAI',e.target.checked)}/> Automatic fallback to OpenAI if Outlier session expires</label>
      </div>
      <div className="provider-switcher" role="group" aria-label="Select Starli AI provider">
        <button type="button" className={`subtle-button ${activeProvider==='OPENAI'?'active-provider':''}`} onClick={()=>onSwitchProvider('OPENAI',aiFallbackEnabled)}><Sparkles size={14}/> OpenAI API{activeProvider==='OPENAI'&&<Check size={13}/>}</button>
        <button type="button" className={`subtle-button ${activeProvider==='OUTLIER'?'active-provider':''}`} onClick={()=>onSwitchProvider('OUTLIER',aiFallbackEnabled)}><Brain size={14}/> Outlier Client{activeProvider==='OUTLIER'&&<Check size={13}/>}</button>
      </div>
    </div>}

    {diag&&<div className="settings-panel outlier-config-panel" style={{marginBottom:'20px'}}>
      <div className="integration-title"><Brain size={20}/><strong>Outlier Client Control & Session Diagnostics</strong><span className={`status ${diag.ok?'configured':'setup_required'}`}>{diag.ok?'SESSION READY':'INCOMPLETE'}</span></div>
      <p>{diag.summary}</p>
      <div className="outlier-actions-row">
        <button type="button" className="subtle-button" disabled={busy} onClick={()=>void testOutlier(false)}>{busy?<LoaderCircle size={14} className="spin"/>:<Activity size={14}/>} Test connection (Ping)</button>
        <button type="button" className="subtle-button" disabled={busy} onClick={()=>void testOutlier(true)}><RefreshCw size={14}/> Create new Outlier session now</button>
        {diag.conversationId&&<small className="muted">Active session: <code>{diag.conversationId}</code></small>}
      </div>
      {pingResult&&<div className={`notice ${pingResult.ok?'':'error'}`} style={{marginTop:'14px'}}><ShieldCheck size={16}/><span>{pingResult.detail}</span></div>}
      {savedMsg&&<div className="notice" style={{marginTop:'14px'}}><Check size={16}/><span>{savedMsg}</span></div>}
      <details className="domain-contact" style={{marginTop:'16px'}}>
        <summary>Update model or Outlier session credentials (hot reload)</summary>
        <form onSubmit={saveOutlier} className="domain-contact-grid" style={{marginTop:'15px'}}>
          <label>Outlier Model (STARLI_MODEL)<input value={model} onChange={e=>setModel(e.target.value)} placeholder="gpt-6.1-sol or claude-opus-4-6"/></label>
          <label>Outlier Conversation ID (optional)<input value={convId} onChange={e=>setConvId(e.target.value)} placeholder="Auto-rotated when full"/></label>
          <label>STARLI_COOKIE (leave empty to keep current {diag.cookiePresent?'✓':''})<input type="password" value={cookie} onChange={e=>setCookie(e.target.value)} placeholder={diag.cookiePresent?'Configured on server':'Enter new session cookie'}/></label>
          <label>STARLI_CSRF_TOKEN (leave empty to keep current {diag.csrfTokenPresent?'✓':''})<input type="password" value={csrf} onChange={e=>setCsrf(e.target.value)} placeholder={diag.csrfTokenPresent?'Configured on server':'Enter new CSRF token'}/></label>
          <div style={{gridColumn:'1 / -1',marginTop:'6px'}}><button className="pill-button light" disabled={busy}>{busy?<LoaderCircle size={15} className="spin"/>:<Check size={15}/>} Save Outlier configuration</button></div>
        </form>
      </details>
    </div>}

    <div className="notice"><ShieldCheck size={17}/> "Configured" confirms configuration presence. Availability and outcomes are verified on each live operation.</div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <div className="integration-grid">{integrations.map(i=><div className="settings-panel" key={i.id}><div className="integration-title">{i.id==='email'?<Mail size={20}/>:<Layers size={20}/>}<span className={`status ${i.status.toLowerCase()}`}>{i.status==='CONFIGURED'?'CONFIGURED':'NEEDS SETUP'}</span></div><h3>{i.name}</h3><p>{i.detail}</p>{requirements[i.id]&&<div className="integration-requirements"><span>SERVER CONFIGURATION</span>{requirements[i.id].map(item=><div key={item}><Check size={11}/><code>{item}</code></div>)}</div>}</div>)}</div>
  </section>;
}
