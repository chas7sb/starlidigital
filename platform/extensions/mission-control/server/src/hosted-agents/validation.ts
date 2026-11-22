import { z } from 'zod';
const text = z.string().max(8000);
const knowledge = z.object({
 companyDescription: text.optional(), pricingDetails: text.optional(), openingHours: text.optional(), customKnowledgeText: text.optional(),
 productsAndServices: z.array(z.object({name: z.string().max(300), description: text.optional(), price: z.string().max(300).optional(), features: z.array(z.string().max(500)).max(30).optional()}).strict()).max(100).optional(),
 locations: z.array(z.object({city: z.string().max(300).optional(), address: z.string().max(1000).optional(), operatingHours: z.string().max(1000).optional()}).strict()).max(50).optional(),
 faqs: z.array(z.object({question:text, answer:text}).strict()).max(100).optional(),
 policies: z.record(z.string().max(100), text).optional(), contactInfo: z.record(z.string().max(100), text).optional()
}).strict();
function objectJson(raw: string, max: number) { if (typeof raw !== 'string' || raw.length > max) throw new Error('Configuration exceeds maximum size'); const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object'); return value; }
export function validateKnowledge(raw: string): string {
 if (typeof raw !== 'string' || raw.length > 48000) throw new Error('Knowledge exceeds maximum size');
 let value: unknown; try { value = JSON.parse(raw); } catch { value = {customKnowledgeText:raw}; }
 return JSON.stringify(knowledge.parse(value));
}
export function validateAgentInput(input: Record<string, any>) {
 for (const [key, max] of Object.entries({name:200,businessName:300,slug:200,instructions:8000,businessContext:8000,welcomeMessage:2000})) {
  const value = input[key]; if (value == null) continue;
  if (typeof value !== 'string' || value.length > max || (['name','businessName'].includes(key) && !value.trim())) throw new Error('Invalid ' + key);
 }
 if (input.knowledgeJson != null) validateKnowledge(input.knowledgeJson);
 if (input.appearanceJson != null) {
  const value=objectJson(input.appearanceJson,8000);
  z.object({primaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),title:z.string().max(200).optional(),subtitle:z.string().max(500).optional(),placeholderText:z.string().max(300).optional(),quickPrompts:z.array(z.string().max(300)).max(8).optional(),position:z.enum(['bottom-right','bottom-left']).optional(),theme:z.enum(['light','dark','auto']).optional(),greetingTitle:z.string().max(200).optional(),avatarUrl:z.string().max(2000).refine(v=>v.startsWith('https://') || v.startsWith('/')).optional()}).strict().parse(value);
 }
 if (input.deploymentJson != null) z.object({enablePublicEmbed:z.boolean().optional(),enableAnonymousDemo:z.boolean().optional(),allowedOrigins:z.array(z.string().url()).max(30).optional()}).strict().parse(objectJson(input.deploymentJson,8000));
 if (input.toolsJson != null) {
  if (typeof input.toolsJson !== 'string' || input.toolsJson.length > 8000) throw new Error('Invalid toolsJson');
  try {
   const parsed = JSON.parse(input.toolsJson);
   if (!Array.isArray(parsed) && (typeof parsed !== 'object' || parsed === null)) throw new Error();
  } catch {
   throw new Error('toolsJson must be a valid JSON array or object');
  }
 }
 if (input.enabledTools != null) {
  if (!Array.isArray(input.enabledTools) || input.enabledTools.length > 50 || input.enabledTools.some((t: any) => typeof t !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(t))) {
   throw new Error('Invalid enabledTools: must be an array of valid tool ID strings');
  }
 }
}
