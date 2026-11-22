import {useEffect,useState,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Coins,LoaderCircle} from 'lucide-react';
import {gql,subscribe} from './api';
import './credit-consent.css';
import{creditActionCost,type CreditCosts,type CreditAction}from'./credit-consent-utils';
export{creditActionCost,type CreditCosts,type CreditAction}from'./credit-consent-utils';
type Options={hasFiles?:boolean;scopeKey?:string};
export function useCreditConsent(options:Options={}):{costs:CreditCosts|null;maxCredits:number;consent:ReactNode;confirmAction:(action:CreditAction,hasFiles?:boolean,regenerateImages?:boolean)=>Promise<number|null>;reset:()=>void}{
 const[wallet,setWallet]=useState<{available:number;held:boolean}|null>(null);
 const[costs,setCosts]=useState<CreditCosts|null>(null),[identity,setIdentity]=useState<'unknown'|'guest'|'user'|'admin'>('unknown'),[approved,setApproved]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{let current=true;setError('');void gql<{me:{role:string}|null;creditCosts:CreditCosts}>('{me{role} creditCosts{enabled build edit images research}}').then(data=>{if(!current)return;for(const key of ['build','edit','images','research']as const){if(!Number.isSafeInteger(data.creditCosts[key])||data.creditCosts[key]<0)throw new Error('Credit costs could not be verified.');}setCosts(data.creditCosts);setIdentity(data.me?.role==='ADMIN'?'admin':data.me?'user':'guest');}).catch(error=>{if(current){setCosts(null);setIdentity('unknown');setError(error instanceof Error?error.message:'Costs could not be loaded.');}});return()=>{current=false;};},[reload]);
 useEffect(()=>{
  if(identity!=='user'){setWallet(null);return;}
  let current=true;const refresh=()=>{void gql<{wallet:{available:number;held:boolean}}>('{wallet{available held}}').then(data=>{if(current)setWallet(data.wallet);}).catch(()=>{if(current)setWallet(null);});};
  refresh();const stop=subscribe<{walletUpdated:{available:number;held:boolean}}>('subscription{walletUpdated{available held}}',{},data=>{if(current)setWallet(data.walletUpdated);});
  window.addEventListener('focus',refresh);return()=>{current=false;stop();window.removeEventListener('focus',refresh);};
 },[identity]);
 const cap=costs?(options.hasFiles?costs.edit:Math.max(costs.build,costs.edit)):0;
 useEffect(()=>{setApproved(false);},[options.scopeKey,cap,costs?.enabled,identity]);
 const paid=identity==='user'&&costs?.enabled===true;
 const maxCredits=paid&&approved&&!wallet?.held?cap:0;
 async function confirmAction(action:CreditAction,hasFiles=options.hasFiles||false,regenerateImages=false){
  if(!costs||identity==='unknown')throw new Error('Costs could not be verified. Please refresh the page before continuing.');
  if(!costs.enabled||identity==='admin'||identity==='guest')return 0;
  if(wallet?.held)throw new Error('Wallet is held for verification. Please check your wallet or contact support.');
  const amount=creditActionCost(costs,action,hasFiles,regenerateImages);
  if(wallet&&wallet.available<amount)throw new Error(`Insufficient credits. Operation requires ${amount} credits; you have ${wallet.available} available.`);
  const label=action==='research'?'web research':action==='images'?'image generation':hasFiles||action==='edit'?'modifying website':'building website';
  if(!window.confirm(`Authorize up to ${new Intl.NumberFormat('en-US').format(amount)} credits for ${label}${regenerateImages?', including image regeneration':''}?\nCredits are reserved before execution. Consumption and released credits appear in your wallet.`))return null;
  return amount;
 }
 const consent=<div className="credit-consent" aria-live="polite">{error?<div className="credit-consent-error"><span>Could not verify costs. Messages will not authorize credit consumption.</span><button type="button" onClick={()=>setReload(value=>value+1)}>Retry</button></div>:!costs?<span className="credit-consent-loading"><LoaderCircle size={12} className="spin"/> Checking costs…</span>:paid?<label><input type="checkbox" disabled={wallet?.held===true} checked={approved&&!wallet?.held} onChange={event=>setApproved(event.target.checked)}/><span>Authorize up to <strong>{new Intl.NumberFormat('en-US').format(cap)} credits</strong> for this request.<small>Standard chat does not consume credits. Building or modifying requires your consent.{wallet&&<> Available: {new Intl.NumberFormat('en-US').format(wallet.available)} credits.{wallet.held&&' Wallet suspended for review.'}</>}</small></span></label>:identity==='guest'?<span className="credit-consent-note">You can chat with Starli and test available previews. Additional operations require an account and credits.</span>:identity==='admin'?<span className="credit-consent-note">Administrator account · operations do not debit the wallet.</span>:<span className="credit-consent-note">Credit usage is not enabled for Starli actions.</span>}<Link to="/app/billing" className="credit-consent-wallet"><Coins size={12}/> My Wallet</Link></div>;
 return {costs,maxCredits,consent,confirmAction,reset:()=>setApproved(false)};
}
