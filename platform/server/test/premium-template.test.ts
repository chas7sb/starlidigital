import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProposalSpec} from '../src/proposal-templates.js';
import {makePremiumNextFiles,renderPremiumTemplate} from '../src/premium-template.js';
import {validateNextProjectFiles} from '../src/next-template.js';
import {VERTICAL_DEFINITIONS,type VerticalType} from '../src/proposal-spec.js';

const makeSpec=()=>buildProposalSpec({proposalId:'premium',leadId:'lead',lead:{businessName:'Atelier & Cafea',industry:'Cafenea',locality:'Brașov',normalizedPhone:'+40744123456',email:'contact@example.ro'},mode:'snapshot'});

test('all verticals produce real React pages and distinct, index-safe route previews',()=>{
 for(const vertical of Object.keys(VERTICAL_DEFINITIONS) as VerticalType[]){
  const spec=makeSpec();spec.template.vertical=vertical;
  const files=makePremiumNextFiles(spec);validateNextProjectFiles(files);
  assert.ok(files.find(f=>f.path==='app/page.tsx')?.content.includes('export const metadata'));
  const documents=['/','/servicii','/despre','/contact'].map(path=>renderPremiumTemplate(spec,path));
  for(const html of documents){
   assert.equal((html.match(/<h1(?:\s[^>]*)?>/g)||[]).length,1);
   assert.ok(html.includes('noindex, nofollow, noarchive'));
   assert.ok(html.includes('https://wa.me/40744123456'));
   assert.ok(!html.includes('href="#"'));
  }
  assert.equal(new Set(documents).size,4);
  assert.ok(documents[0].includes('Imagine de atmosferă'));
  assert.ok(documents[2].includes('Imagine de atmosferă'));
  assert.ok(documents[1].includes('Găsește direcția potrivită'));
  assert.ok(!documents[1].includes('<section class="hero">'));
  assert.ok(documents[3].includes('Un mesaj poate fi începutul.'));
 }
});

test('untrusted business text and unsafe image URLs cannot become markup or executable JSX',()=>{
 const spec=makeSpec();
 spec.business.name='Atelier <img src=x onerror=alert(1)> {process.exit()} & Cafea';
 spec.content.headline='Text </h1><script>alert(1)</script> {danger}';
 spec.content.about='Quote " and <iframe src="https://bad.example"></iframe>';
 spec.media.heroImage='javascript:alert(1)';
 spec.media.galleryImages=['data:image/svg+xml,<svg onload=alert(1)>'];
 const files=makePremiumNextFiles(spec);validateNextProjectFiles(files);
 const html=renderPremiumTemplate(spec);
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(!html.includes('<img src=x'));
 assert.ok(!html.includes('<iframe src='));
 assert.ok(!html.includes('javascript:'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('&#123;process.exit()&#125;'));
});

test('no phone means no invented WhatsApp number, and confirmed media does not pretend to be stock',()=>{
 const spec=makeSpec();delete spec.business.phone;delete spec.conversion.phone;delete spec.conversion.whatsapp;
 spec.media.heroImage='https://example.ro/own-hero.jpg';
 spec.media.galleryImages=['https://example.ro/own-gallery.jpg'];
 const html=renderPremiumTemplate(spec);
 assert.ok(!html.includes('wa.me/'));
 assert.ok(html.includes('mailto:contact@example.ro'));
 assert.ok(!html.includes('Imagine de atmosferă'));
 assert.ok(html.includes('https://example.ro/own-hero.jpg'));
});

test('canonical URLs and robots are generated only for an explicitly supplied publication origin',()=>{
 const spec=makeSpec();spec.business.existingWebsite='https://old.example.ro';
 const unpublished=makePremiumNextFiles(spec);
 assert.ok(!unpublished.some(f=>f.path==='public/sitemap.xml'));
 const published=makePremiumNextFiles(spec,{siteUrl:'https://atelier.example.ro'});validateNextProjectFiles(published);
 assert.ok(published.some(f=>f.path==='public/sitemap.xml'&&f.content.includes('https://atelier.example.ro/servicii/')));
 assert.ok(!published.some(f=>f.content.includes('https://old.example.ro')));
 assert.throws(()=>makePremiumNextFiles(spec,{siteUrl:'javascript:alert(1)'}));
});
