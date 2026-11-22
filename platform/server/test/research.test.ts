import test from 'node:test';
import assert from 'node:assert/strict';
import { researchBusiness } from '../src/research.js';

test('research uses mandatory web search and annotation evidence only', async () => {
  const oldKey=process.env.OPENAI_API_KEY,oldFetch=globalThis.fetch;
  process.env.OPENAI_API_KEY='unit-test-key';
  globalThis.fetch=(async (_url,options)=>{
    const body=JSON.parse(String(options?.body));
    assert.equal(body.tool_choice,'required');assert.equal(body.tools[0].type,'web_search');assert.equal(body.max_output_tokens,2000);
    assert.match(body.instructions,/exclusiv în limba română/);
    assert.equal(JSON.parse(body.input[0].content).businessBrief,'Studio de arhitectură în Brașov');
    return new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'O structură editorială clară poate prezenta serviciile și proiectele studioului.',annotations:[{type:'url_citation',url:'https://example.com/studio',title:'Studiu comparabil'},{type:'url_citation',url:'https://example.com/studio',title:'Studiu comparabil'},{type:'url_citation',url:'javascript:alert(1)',title:'Nesigur'}]}]}]}));
  }) as typeof fetch;
  try {const value=await researchBusiness('Studio de arhitectură în Brașov');assert.equal(value.sources.length,1);assert.equal(value.sources[0].url,'https://example.com/studio');assert.match(value.summary,/structură editorială/);}
  finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

test('research rejects incomplete results, refusals and missing citation evidence', async () => {
  const oldKey=process.env.OPENAI_API_KEY,oldFetch=globalThis.fetch;process.env.OPENAI_API_KEY='unit-test-key';
  let data:any={status:'incomplete',output:[]};
  globalThis.fetch=(async()=>new Response(JSON.stringify(data))) as typeof fetch;
  try {
    await assert.rejects(researchBusiness('O cafenea în București'),/incompletă/);
    data={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'refusal',refusal:'Refused'}]}]};
    await assert.rejects(researchBusiness('O cafenea în București'),/nu a putut/);
    data.output[1].content=[{type:'output_text',text:'Aceasta este o recomandare suficient de lungă, dar fără dovezi citate reale.',annotations:[]}];
    await assert.rejects(researchBusiness('O cafenea în București'),/surse citate/);
    data.output.shift();await assert.rejects(researchBusiness('O cafenea în București'),/nu a fost confirmată/);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

test('research refuses unavailable configuration and does not leak provider errors', async () => {
  const oldKey=process.env.OPENAI_API_KEY,oldFetch=globalThis.fetch;delete process.env.OPENAI_API_KEY;
  globalThis.fetch=(()=>{throw new Error('Unexpected network');}) as typeof fetch;
  try {
    await assert.rejects(researchBusiness('O cafenea în București'),/conexiunea AI/);
    process.env.OPENAI_API_KEY='unit-test-key';
    globalThis.fetch=(async()=>new Response('secret-provider-details',{status:429})) as typeof fetch;
    await assert.rejects(researchBusiness('O cafenea în București'),e=>e instanceof Error&&e.message.includes('429')&&!e.message.includes('secret'));
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
