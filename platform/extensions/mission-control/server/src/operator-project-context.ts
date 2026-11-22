type BusinessDetails={businessName?:string;industry?:string;locality?:string};
const clean=(value:string)=>value.trim().replace(/^["'„“]+|["'”“.!,;:]+$/g,'').trim();
function label(prompt:string,names:string):string|undefined{
 const match=new RegExp('(?:^|[\\s;])(?:'+names+')\\s*:\\s*([^\\r\\n]+)','i').exec(prompt);
 if(!match)return;
 return clean(match[1].split(/\s+(?:Nume(?:le)?(?:\s+afacerii)?|Denumire(?:a)?|Domeniu|Localitate|Ora[șs]|Stil|Telefon|E-?mail|Adres[ăa]|Program)\s*:/i)[0]);
}
function safeName(value:string|undefined):string|undefined{
 if(!value)return;const name=clean(value.replace(/^(?:pentru|la|de\s+la)\s+/i,'').replace(/^nou[ăa]?\s*:\s*/i,''));
 if(name.length<2||name.length>160||/[\r\n]/.test(name)||/\b(?:nume|domeniu|localitate|stil)\s*:/i.test(name)||/^(?:o\s+)?afacere\s+(?:fictiv|nou)|^(?:un\s+)?(?:website|site|proiect)\b/i.test(name))return;
 return name;
}
/** Extract business data, never use the instruction paragraph as a client-facing name. */
export function parseOperatorBusinessDetails(prompt:string,fallback:{businessName?:string;locality?:string}={}):BusinessDetails{
 prompt=prompt.replace(/\\n/g,'\n');
 const named=label(prompt,'Nume(?:le)?(?:\\s+afacerii)?|Denumire(?:a)?(?:\\s+afacerii)?');
 const location=label(prompt,'Localitate|Ora[șs]');
 const industry=label(prompt,'Domeniu(?:\\s+de\\s+activitate)?|Industrie');
 const conversational=/(?:pentru|\bpt)\s+([^\r\n.,;]+?)(?:\s+din\s+([^\r\n.,;]+?))?(?=[\r\n.,;]|$)/i.exec(prompt);
 const businessName=safeName(named)||safeName(conversational?.[1])||safeName(fallback.businessName);
 const locality=clean(location||conversational?.[2]||fallback.locality||'');
 return{businessName,industry:industry&&industry.length<=100?industry:undefined,locality:locality&&locality.length<=100?locality:undefined};
}
export function publicOperatorBrief({businessName,industry,locality}:{businessName:string;industry?:string;locality?:string}):string{
 return `Website de prezentare pentru ${businessName}${industry?' · '+industry:''}${locality?' · '+locality:''}. Pagini dedicate pentru prezentare, servicii, despre afacere și contact. O experiență clară, adaptată pentru desktop și mobil, cu informațiile confirmate ale afacerii.`;
}
