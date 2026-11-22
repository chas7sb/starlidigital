const sensitive = /medical|health condition|religion|race|ethnic|sexual orientation|political|criminal|precise location|latitude|longitude|fingerprint/i;
const rawish = /message body|raw message|email body|chat body|transcript|snippet/i;
export function assertSafeEvidence(kind: string, category?: string, value?: string) {
  const joined=[kind,category||'',value||''].join(' ');
  if (sensitive.test(joined)) throw new Error('Sensitive inference prohibited');
  if (rawish.test(joined)) throw new Error('Raw private message content prohibited');
}
export const bound = <T>(items:T[], max:number) => items.slice(Math.max(0,items.length-max));
export const scoreBand=(n:number):'LOW'|'MEDIUM'|'HIGH'=>n>=70?'HIGH':n>=35?'MEDIUM':'LOW';
