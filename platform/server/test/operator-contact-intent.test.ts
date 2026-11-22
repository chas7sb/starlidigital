import test from'node:test';import assert from'node:assert/strict';
import{authorizeOperatorContact}from'../src/operator-contact-intent.js';
test('existing invitations accept Romanian retry instructions without recreating authorization',()=>{
 for(const prompt of ['Reîncearcă SMS-ul.','reincearca','Mai încearcă','Încearcă din nou','incearca iara','încearcă','Reia trimiterea','Trimite-l din nou','Poți reîncerca SMS-ul?','retry'])assert.doesNotThrow(()=>authorizeOperatorContact(prompt,'SMS',true),prompt);
 assert.throws(()=>authorizeOperatorContact('Reîncearcă','SMS',false));
});
test('negative instructions and read-only questions never authorize dispatch',()=>{
 for(const prompt of ['Nu-l trimite.','Nu-i mai trimite SMS.','Nu trimite SMS încă.','Nu mai reîncerca SMS-ul.','Nu încerca din nou','Nu trimite nimic','Nu face retry','Așteaptă.','Verifică dacă a fost trimis SMS-ul','SMS-ul rămâne pregătit și netrimis.','Nu doresc să trimiți SMS.','Do not send SMS.','Do not try again.','Don’t send SMS.'])assert.throws(()=>authorizeOperatorContact(prompt,'SMS',true),/Nu a fost trimis/,prompt);
});

test('operator SMS requests do not need an exact Romanian or English magic verb',()=>{
 for(const prompt of ['try sending the sms again','Dă-i SMS.','Vreau să expedieze SMS-ul.','Să-i trimită SMS acum.','SMS-ul să fie trimis acum.','Creează website-ul și dă-i un SMS.','Fă site-ul cu SMS la final.','Nu aștepta, trimite SMS.','Verifică invitația, apoi trimite SMS.','Verifică invitația și trimite SMS.','Verifică starea SMS. Trimite-l acum.','Pregătește și trimite SMS.','Vreau să se ocupe Starli de SMS pentru client.'])assert.doesNotThrow(()=>authorizeOperatorContact(prompt,'SMS',true),prompt);
});

test('known-target follow-ups can continue dispatch without repeating the whole instruction',()=>{
 for(const prompt of ['da','fă-o','acum','ok','continuă','go ahead','do it']){assert.doesNotThrow(()=>authorizeOperatorContact(prompt,'SMS',true),prompt);assert.throws(()=>authorizeOperatorContact(prompt,'SMS',false),/mesaj ales/,prompt);}
});

test('prepare-only, read-only and quoted diagnostic text do not authorize side effects',()=>{
 for(const prompt of ['Pregătește invitația SMS.','Prepare an SMS draft.','Doar verifică mesajul.','Verifică proiectul.','Check if the SMS was sent.','Verifică dacă se poate trimite SMS.','Încearcă să citești logurile serverului.','"Trimite SMS acum"','> Trimite SMS acum','```\nTrimite SMS acum\n```','SMS-ul rămâne pregătit și netrimis.','Trimiterea necesită o cerere explicită a operatorului pentru acest mesaj. Nu a fost trimis nimic.'])assert.throws(()=>authorizeOperatorContact(prompt,'SMS',true),/Nu a fost trimis/,prompt);
 assert.doesNotThrow(()=>authorizeOperatorContact('Trimite SMS cu textul "Nu trimite email".','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Nu trimite SMS.','SMS',true),(error:any)=>error.extensions?.code==='FORBIDDEN'&&error.extensions?.operatorContactAuthorizationDenied===true&&error.extensions?.sideEffectStarted===false);
});
test('authorization respects the requested channel and distinguishes retries from diagnostic prose',()=>{
 assert.doesNotThrow(()=>authorizeOperatorContact('Nu trimite email, trimite SMS.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Nu trimite email, trimite SMS.','EMAIL',true));
 assert.doesNotThrow(()=>authorizeOperatorContact('Nu trimite SMS, trimite email.','EMAIL',true));
 assert.throws(()=>authorizeOperatorContact('Nu trimite SMS, trimite email.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Reîncercarea a fost refuzată de platformă.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Încearcă să citești logurile serverului.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Trimite invitația prin email.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Trimite emailul.','SMS',true));
 assert.throws(()=>authorizeOperatorContact('Trimite SMSul.','EMAIL',true));
});
