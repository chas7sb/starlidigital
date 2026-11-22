import test from 'node:test';import assert from 'node:assert/strict';
import{parseOperatorBusinessDetails,publicOperatorBrief}from'../src/operator-project-context.js';
test('natural-language website commands extract the business instead of instruction prefixes',()=>{
 const actual=parseOperatorBusinessDetails('creeaza un website cu optiunea 1 pentru pizeria viva din hunedoara',{businessName:'un website cu optiunea 1 pentru pizeria viva',locality:'hunedoara'});
 assert.equal(actual.businessName,'pizeria viva');assert.equal(actual.locality,'hunedoara');
 const labelled=parseOperatorBusinessDetails('Creează pentru o afacere fictivă:\nNume: Cafeneaua Miez\nDomeniu: cafenea\nLocalitate: Brașov\nStil: editorial\nOPERATOR_PRIVATE: nu publica.');
 assert.deepEqual(labelled,{businessName:'Cafeneaua Miez',industry:'cafenea',locality:'Brașov'});
 assert.ok(!publicOperatorBrief({...labelled,businessName:labelled.businessName!}).includes('OPERATOR_PRIVATE'));
});
test('ambiguous commands do not become customer-facing business names',()=>{assert.equal(parseOperatorBusinessDetails('creează un website pentru o afacere fictivă').businessName,undefined);});
