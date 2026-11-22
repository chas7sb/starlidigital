const fs=require('fs'),assert=require('assert/strict'),{compile,preprocess}=require(process.cwd()+'/node_modules/svelte/compiler.cjs'),ts=require(process.cwd()+'/node_modules/typescript');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const dir='src/lib/components/marketing',file=dir+'/Homepage.svelte';
 const source=await preprocess(fs.readFileSync(file,'utf8'),{script:({content,attributes})=>attributes.lang==='ts'?{code:ts.transpileModule(content,{compilerOptions:{verbatimModuleSyntax:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText}:undefined});
 const compiled=compile(source.code,{filename:file,generate:false});assert.deepEqual(compiled.warnings,[]);
 const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[],api=[],failed=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url())});page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()})});
  await page.route('**/__homepage-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="app"></div><script type="module">import Home from "/src/lib/components/marketing/Homepage.svelte";new Home({target:document.querySelector("#app")});window.ready=true;</script></body></html>'}));
  await page.goto('http://localhost:5180/__homepage-fixture',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.ready);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('h1').count(),1);assert((await page.title()).includes('StarliDigital'));assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://starlidigital.ro/');
  const schema=JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());assert.equal(schema['@graph'].length,2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:/Approvals/}).click();assert.equal(await page.getByRole('button',{name:/Approvals/}).getAttribute('aria-pressed'),'true');await page.getByText('Ready for your review',{exact:true}).waitFor();
  await page.getByRole('button',{name:/AI teammates/}).click();
  const links=await page.locator('a').evaluateAll(els=>els.map(x=>x.getAttribute('href')));assert(links.every(h=>['/app','/','#main'].includes(h)));
  await page.screenshot({path:dir+'/homepage-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByText('Do bots act without my permission?',{exact:false}).click();assert.equal(await page.locator('details[open]').count(),1);await page.getByText('Do bots act without my permission?',{exact:false}).press('Enter');assert.equal(await page.locator('details[open]').count(),0);
  await page.screenshot({path:dir+'/homepage-mobile.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.button').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.equal(api.length,0);
  const receipt={passed:true,source:file,compileWarnings:0,actualComponent:true,isolatedFixture:true,viewports:[1440,390],horizontalOverflow:false,featureSelection:true,faqKeyboard:true,reducedMotion:true,seoSchema:true,allCtaApp:true,fontLoaded:await page.evaluate(()=>document.fonts.check('15px StarliMona')),apiCalls:0,browserErrors:errors,failedResponses:failed,productionDeployment:false};
  fs.writeFileSync(dir+'/homepage-verification.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
