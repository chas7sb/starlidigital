import {GraphQLError} from 'graphql';

const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘]/g,"'");
/** Inspect human control text, never quoted message bodies, logs, or instructions from tools. */
function humanControlText(prompt:string){
 return normalize(prompt).replace(/```[\s\S]*?```/g,' ').replace(/^\s*>.*$/gm,' ').replace(/"[^"\n]*"|“[^”\n]*”|«[^»\n]*»/g,' ').trim();
}

/** Private operator dispatch is preauthorized; preserve only contrary human instructions and task scope. */
export function authorizeOperatorContact(prompt:string,channel:'SMS'|'EMAIL',knownTarget=false):void{
 const text=humanControlText(prompt),sms=/\bsms(?:-?ul(?:ui)?|-?uri(?:le)?)?\b/,email=/\be-?mail(?:-?ul(?:ui)?|-?uri(?:le)?|s)?\b/;
 const specific=channel==='SMS'?sms:email,other=channel==='SMS'?email:sms;
 const relevant=(clause:string)=>!other.test(clause)||specific.test(clause);
 const clauses=text.split(/[.!?;,\n]+/).map(clause=>clause.trim()).filter(Boolean),scoped=clauses.filter(relevant);
 // An exception to a prepare/read-only veto, not an authorization allowlist.
 const action=/\b(?:trimit(?:e|i|a|em|eti)(?:-\w+)?|retrimite(?:-\w+)?|expedi\w*|send\w*|resend\w*|retry\w*|reincea?rca|reia|invita|contacteaza|da(?:-i|-le|-l)?\s+(?:un\s+)?(?:sms|mesaj)|dai\s+(?:un\s+)?(?:sms|mesaj))\b/;
 const negative=/\bnu(?:-l|-i|-le|-o)?\s+(?:(?:mai|il|l|o|le|i)\s+)*(?:trimit\w*|retrimit\w*|expedi\w*|contact\w*|reince\w*|ince\w*|repeta|relu\w*|reia|sms|e-?mail|mesaje)\b|\bnu\s+(?:vreau|doresc)\b.{0,65}\b(?:trimit\w*|expedi\w*|reincerc\w*)\b|\bnu\s+face\s+retry\b|\b(?:do not|don't|dont|never)\s+(?:send\w*|resend\w*|retry\w*|try|deliver\w*)\b|\bfara\s+(?:trimitere|sms|e-?mail|mesaje)\b/;
 const stop=/^(?:opreste(?:\s+(?:trimiterea|sms|mesajele))?|asteapta|stop(?:\s+(?:sending|sms|messages))?|wait)[\s.]*$|\b(?:asteapta|wait for)\s+(?:aprobarea|confirmarea|my approval|my confirmation)\b/;
 const onlyPrepare=/\b(?:pregat\w*|prepar\w*|redact\w*|compune|draft)\b/;
 const readOnly=/\b(?:doar|numai|only|just)\s+(?:citire|verific\w*|inspect\w*|check\w*|read\w*|status|starea)\b|\bread[ -]?only\b|\b(?:verific\w*|check|inspect\w*|citest\w*|read)\b|^(?:status|starea|diagnostic\w*)\b/;
 const diagnostic=/\b(?:reincercarea|trimiterea)\s+(?:a fost|este)\s+(?:refuzata|blocata)|\btrimiterea necesita o cerere explicita\b|\bnu a fost trimis nimic\b|\bsms(?:-ul)?\s+ramane\s+(?:pregatit|netrimis)|\berrorcode\s*=|\bfailureid\s*:|^(?:error|eroare|forbidden)\s*:/;
 const denied=scoped.some(clause=>negative.test(clause)||stop.test(clause)),hasAction=scoped.some(clause=>action.test(clause)&&!negative.test(clause));
 const prepareOnly=scoped.some(clause=>onlyPrepare.test(clause))&&!hasAction;
 const inspecting=scoped.some(clause=>readOnly.test(clause))&&!scoped.some(clause=>clause.split(/\b(?:si|apoi|then|and)\s+/).some(part=>action.test(part)&&!readOnly.test(part)&&!negative.test(part)));
 const quotedOrDiagnostic=!text||scoped.length===0||diagnostic.test(text)&&!hasAction;
 const followup=/^(?:da|da-i|fa-o|fa asta|acum|ok|okay|continua|continue|reincearca|mai incearca|incearca(?: din nou)?|retry|try again|go ahead|do it)$/;
 const noTarget=followup.test(text)&&!knownTarget,question=/^(?:ce|cum|cine|unde|cand|de ce|what|how|why|when|where)\b/.test(text)&&!hasAction;
 const reason=denied?'Ai cerut oprirea explicită a trimiterii.':prepareOnly?'Ai cerut doar pregătirea invitației.':inspecting||question?'Ai cerut doar verificare sau informații.':noTarget?'Nu există un mesaj ales pentru această continuare.':quotedOrDiagnostic?'Textul primit conține doar un citat, diagnostic sau o cerere pentru alt canal.':null;
 if(reason)throw new GraphQLError(reason+' Nu a fost trimis nimic.',{extensions:{code:'FORBIDDEN',operatorContactAuthorizationDenied:true,sideEffectStarted:false}});
}
