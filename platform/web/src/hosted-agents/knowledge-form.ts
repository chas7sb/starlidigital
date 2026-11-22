import type { HostedAgentStructuredKnowledge } from './types';

function object(raw: string): Record<string, any> {
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
const text = (value: unknown) => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
export function knowledgeToForm(raw: string): HostedAgentStructuredKnowledge {
  const k = object(raw);
  return { companyDescription: text(k.companyDescription), productsAndServices: text(k.productsAndServices),
    pricingPolicy: text(k.pricingDetails ?? k.pricingPolicy), openingHours: text(k.openingHours), locations: text(k.locations),
    contactDetails: text(k.contactInfo ?? k.contactDetails), frequentlyAskedQuestions: text(k.faqs ?? k.frequentlyAskedQuestions),
    customRules: text(k.customKnowledgeText ?? k.customRules) };
}
function arrayInput(value: string | undefined, field: string, convert: (line: string) => object): unknown[] {
  const raw = (value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`${field} must be a JSON array of objects.`);
    return parsed;
  }
  return raw.split(/\n+/).filter(Boolean).map(convert);
}
export function knowledgeFromForm(form: HostedAgentStructuredKnowledge, original = '{}'): string {
  const k = object(original);
  k.companyDescription = form.companyDescription || '';
  k.productsAndServices = arrayInput(form.productsAndServices, 'Products', name => ({ name }));
  k.locations = arrayInput(form.locations, 'Locations', address => ({ address }));
  k.faqs = arrayInput(form.frequentlyAskedQuestions, 'FAQs', line => {
    const [question, ...answer] = line.split('|');
    if (!answer.length) throw new Error('Enter each FAQ as question | answer, or use a JSON array.');
    return { question: question.trim(), answer: answer.join('|').trim() };
  });
  k.pricingDetails = form.pricingPolicy || '';
  k.openingHours = form.openingHours || '';
  const contacts = (form.contactDetails || '').trim();
  if (contacts.startsWith('{')) {
    const parsed = JSON.parse(contacts);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Contact details must be an object.');
    k.contactInfo = parsed;
  } else k.contactInfo = contacts ? { details: contacts } : {};
  k.customKnowledgeText = form.customRules || '';
  delete k.pricingPolicy; delete k.contactDetails; delete k.frequentlyAskedQuestions; delete k.customRules;
  return JSON.stringify(k);
}
