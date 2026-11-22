import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProposalSpec,selectVerticalAndVariant} from '../src/proposal-templates.js';

const spec=(name:string,industry:string,extra:Record<string,unknown>={})=>buildProposalSpec({proposalId:'p',leadId:'l',mode:'snapshot',lead:{businessName:name,industry,locality:'Brașov',...extra}});

test('unknown businesses receive a neutral professional template',()=>{
 assert.equal(selectVerticalAndVariant('Consultanță','Atelier de idei').vertical,'professional');
 assert.equal(selectVerticalAndVariant('Branding','Identitate Studio').vertical,'professional');
 const value=spec('Contabilitate Nord','Contabilitate');
 assert.equal(value.template.vertical,'professional');
 assert.doesNotMatch(JSON.stringify(value.content),/mecanic|auto|barbă|implant/);
});

test('specialty copy does not invent an unrelated business',()=>{
 const dermatologist=spec('Clinica Dermis','Dermatologie estetică');
 assert.equal(dermatologist.template.vertical,'clinic');
 assert.equal(dermatologist.business.category,'Dermatologie');
 assert.doesNotMatch(JSON.stringify(dermatologist.content),/implant|stomatolog|fațet|manichiur|fără durere/);
 const barber=spec('Nord Barber','Frizerie');
 assert.equal(barber.business.category,'Frizerie & barber');
 assert.doesNotMatch(JSON.stringify(barber.content),/manichiur|tratamente faciale|balayage/);
 const coffee=spec('Forma Coffee','Cafenea');
 assert.equal(coffee.business.category,'Cafenea');
 assert.match(coffee.content.headline,/cafea/);
 assert.doesNotMatch(JSON.stringify(coffee.content),/meniu vegetarian|produse locale|gătite zilnic/);
});

test('template copy omits fabricated guarantees, statistics and facilities',()=>{
 for(const industry of ['Auto service','Beauty salon','Clinică','Construcții','Instalator','Curățenie','Hotel','Restaurant','Mobilă','Fotografie']){
  const value=spec('Afacerea mea',industry);
  assert.doesNotMatch(JSON.stringify(value.content),/garantat|garanți|fără durere|echipamente digitale|4K|parcare gratuit|Wi-Fi|personal verificat|ani de experiență|sterilizare medicală/i);
  assert.equal(value.content.confirmedTestimonials,undefined);
  assert.equal(value.content.confirmedPrices,undefined);
  assert.ok(value.research.unknownFacts.includes('Lista exactă de servicii'));
 }
});

test('only valid contact data and image URLs become actions and media',()=>{
 const value=spec('Test','Cafenea',{normalizedPhone:'+40744123456',email:'contact@example.ro',heroImage:'javascript:alert(1)',existingWebsite:'https://user:password@example.ro',galleryImages:['https://images.example.ro/a.webp','http://images.example.ro/b.jpg','/assets/hero.png','data:text/html,<script>']});
 assert.equal(value.conversion.whatsapp,'https://wa.me/40744123456');
 assert.equal(value.business.existingWebsite,undefined);
 assert.equal(value.media.heroImage,undefined);
 assert.deepEqual(value.media.galleryImages,['https://images.example.ro/a.webp','/assets/hero.png']);
 const absent=spec('Test','Servicii',{normalizedPhone:'javascript:alert(1)',email:'bad email'});
 assert.equal(absent.conversion.whatsapp,undefined);
 assert.equal(absent.business.phone,undefined);
 assert.equal(absent.conversion.primaryAction.url,'/contact');
 assert.doesNotMatch(JSON.stringify(absent.content),/formular/);
});
