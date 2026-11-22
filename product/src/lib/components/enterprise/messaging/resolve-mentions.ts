type Person={id:string;kind:'human'|'agent';name:string};
type Range={id:string;kind:'human'|'agent';start:number;end:number;label:string};
export function resolveMentions(text:string,directory:Person[],selected:Range[]=[]){
 const people=[...new Map(directory.filter(p=>p&&typeof p.id==='string'&&['human','agent'].includes(p.kind)&&typeof p.name==='string'&&p.name.trim()).map(p=>[p.kind+':'+p.id,p])).values()];
 const code=[...text.matchAll(/(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]*`/g)].map(match=>[match.index!,match.index!+match[0].length]);
 const excluded=(start:number,end:number)=>code.some(([a,b])=>start<b&&end>a);
 const output:{kind:'human'|'agent';id:string}[]=[],seen=new Set<string>(),lower=text.toLocaleLowerCase();
 function add(person:Person){const key=person.kind+':'+person.id;if(!seen.has(key)){seen.add(key);output.push({kind:person.kind,id:person.id});}}
 for(let i=0;i<text.length;i++){if(text[i]!=='@'||i>0&&!/[\s([{,;:!?]/.test(text[i-1])||excluded(i,i+1))continue;
  const explicit=selected.find(range=>range.start===i&&!excluded(range.start,range.end)&&text.slice(range.start,range.end)==='@'+range.label&&people.some(p=>p.id===range.id&&p.kind===range.kind&&p.name===range.label));
  if(explicit){const person=people.find(p=>p.id===explicit.id&&p.kind===explicit.kind)!;add(person);i=explicit.end-1;continue;}
  const matches=people.filter(person=>lower.startsWith('@'+person.name.toLocaleLowerCase(),i)&&(i+person.name.length+1===text.length||/[\s.,!?;:)\]}]/.test(text[i+person.name.length+1]))).sort((a,b)=>b.name.length-a.name.length);
  if(!matches.length)continue;const longest=matches.filter(person=>person.name.length===matches[0].name.length);if(longest.length===1&&!excluded(i,i+longest[0].name.length+1))add(longest[0]);i+=matches[0].name.length;
 }
 return output;
}
