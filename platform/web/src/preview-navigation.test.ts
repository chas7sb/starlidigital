import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import{createHash}from'node:crypto';
import {buildNavigablePreview,readPreviewNavigation,PREVIEW_NAVIGATION_SCRIPT,PREVIEW_SELECTION_SCRIPT} from './preview-navigation.ts';

test('only the exact opaque preview frame may request an approved page',()=>{
 const frame={};const event={source:frame,origin:'null',data:{type:'STARLI_PREVIEW_NAVIGATE',path:'/contact',hash:'#formular'}};
 assert.deepEqual(readPreviewNavigation(event,frame),{path:'/contact',hash:'#formular'});
 for(const bad of [{...event,source:{}},{...event,origin:'https://starlidigital.ro'},{...event,data:{...event.data,path:'https://evil.example/'}},{...event,data:{...event.data,path:'/app/admin'}},{...event,data:{...event.data,path:'/../contact'}},{...event,data:{...event.data,hash:'#'+('a'.repeat(257))}}])assert.equal(readPreviewNavigation(bad,frame),null);
});

test('navigation bridge keeps internal links in the preview and blocks external actions',()=>{
 const html=buildNavigablePreview('<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'"></head><body><script>throw Error("untrusted")</script><button onclick="evil()">Test</button></body></html>',false);
 assert.doesNotMatch(html,/untrusted|onclick=/);assert.match(html,/script-src 'nonce-starli-preview-bridge'/);
 const callbacks:Record<string,(event:any)=>void>={};const messages:any[]=[];let scrolled=false;
 vm.runInNewContext(html.match(/<script nonce="starli-preview-bridge">([\s\S]*?)<\/script>/)![1],{URL,setTimeout:(fn:()=>void)=>fn(),window:{parent:{postMessage:(message:any)=>messages.push(message)}},document:{body:{getAttribute:()=>null},addEventListener:(type:string,callback:(event:any)=>void)=>{callbacks[type]=callback;},getElementById:(id:string)=>id==='servicii'?{scrollIntoView:()=>{scrolled=true;}}:null}});
 function click(href:string){let prevented=false;callbacks.click({preventDefault:()=>{prevented=true;},stopPropagation:()=>{},target:{closest:()=>({getAttribute:()=>href})}});assert.equal(prevented,true);}
 click('/contact/#formular');assert.equal(messages.at(-1).path,'/contact');assert.equal(messages.at(-1).hash,'#formular');
 click('#servicii');assert.equal(scrolled,true);
 click('https://example.com/');assert.equal(messages.at(-1).type,'STARLI_PREVIEW_EXTERNAL');
 click('javascript:alert(1)');assert.equal(messages.at(-1).type,'STARLI_PREVIEW_EXTERNAL');
 let prevented=false;callbacks.submit({preventDefault:()=>{prevented=true;},stopPropagation:()=>{}});assert.equal(prevented,true);assert.equal(messages.at(-1).type,'STARLI_PREVIEW_FORM');
});


test('trusted bridge hashes remain identical across routes, hashes and selection contexts',()=>{
 const source='<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'"></head><body data-starli-preview-path="/wrong"><h1>Test</h1></body></html>';
 for(const [selection,script] of [[false,PREVIEW_NAVIGATION_SCRIPT],[true,PREVIEW_SELECTION_SCRIPT]] as const){
  for(const [path,hash] of [['/',''],['/contact','#formular'],['/servicii','#x"<script>evil</script>']]){
   const html=buildNavigablePreview(source,selection,path,hash);const content=html.match(/<script nonce="starli-preview-bridge">([\s\S]*?)<\/script>/)![1];
   assert.equal(createHash('sha256').update(content).digest('base64'),createHash('sha256').update(script).digest('base64'));
   assert.equal((html.match(/data-starli-preview-path=/g)||[]).length,1);
   assert.doesNotMatch(html,/<script>evil/);
  }
 }
});
