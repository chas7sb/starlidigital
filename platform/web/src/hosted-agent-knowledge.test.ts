import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeToForm, knowledgeFromForm } from './hosted-agents/knowledge-form.ts';

test('knowledge editor round-trips canonical products, locations, FAQs and hidden policies', () => {
  const source = { companyDescription: 'Cafe', productsAndServices: [{ name: 'Coffee', price: '€3', features: ['Fresh'] }],
    locations: [{ city: 'Arad', address: 'Main street' }], faqs: [{ question: 'Open?', answer: 'Yes' }],
    pricingDetails: 'VAT included', contactInfo: { email: 'owner@example.com' }, policies: { refund: 'Ask the team' }, customKnowledgeText: 'No delivery' };
  const saved = JSON.parse(knowledgeFromForm(knowledgeToForm(JSON.stringify(source)), JSON.stringify(source)));
  assert.deepEqual(saved, { ...source, openingHours: '' });
});

test('knowledge editor upgrades legacy text to model-readable canonical fields', () => {
  const saved = JSON.parse(knowledgeFromForm({ productsAndServices: 'Coffee\nTea', locations: 'Arad', pricingPolicy: 'From €3',
    contactDetails: 'Call reception', frequentlyAskedQuestions: 'Open? | Every day', customRules: 'No delivery' }));
  assert.deepEqual(saved.productsAndServices, [{ name: 'Coffee' }, { name: 'Tea' }]);
  assert.equal(saved.pricingDetails, 'From €3');
  assert.equal(saved.faqs[0].answer, 'Every day');
  assert.equal(saved.customKnowledgeText, 'No delivery');
  assert.equal(saved.pricingPolicy, undefined);
});

test('knowledge editor rejects malformed structured input without silently dropping it', () => {
  assert.throws(() => knowledgeFromForm({ productsAndServices: '["Coffee"]' }), /array of objects/);
  assert.throws(() => knowledgeFromForm({ frequentlyAskedQuestions: 'Question without an answer' }), /question \| answer/);
});
