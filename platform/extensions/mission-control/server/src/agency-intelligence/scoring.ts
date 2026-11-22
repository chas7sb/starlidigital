import type { EngagementScore, VisitorProfileEvidence } from './types.js';
import { scoreBand } from './policy.js';
export function scoreEngagement(evidence: VisitorProfileEvidence[]): EngagementScore {
  let score=0; const reasons:string[]=[];
  const routes=evidence.filter(e=>e.kind==='ROUTE');
  const categories=new Map<string,number>(); for(const e of routes) if(e.category) categories.set(e.category,(categories.get(e.category)||0)+1);
  if(evidence.some(e=>e.kind==='SESSION')){score+=15;reasons.push('active first-party session evidence');}
  const repeat=Math.max(0,...categories.values()); if(repeat>=2){score+=Math.min(30,repeat*10);reasons.push('repeated relevant route interest');}
  if(evidence.some(e=>e.kind==='CONVERSATION_STATE')){score+=20;reasons.push('hosted-agent conversation activity');}
  if(evidence.some(e=>e.kind==='PROPOSAL_ACTIVITY')){score+=25;reasons.push('proposal activity');}
  if(evidence.some(e=>e.kind==='EXPLICIT_CONTACT'||e.kind==='CRM_LINK')){score+=10;reasons.push('authoritative identified relationship');}
  score=Math.min(100,score); return {value:score,band:scoreBand(score),reasons,version:'v1'};
}
