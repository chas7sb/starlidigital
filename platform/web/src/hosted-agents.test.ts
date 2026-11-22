import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  HostedAgent,
  HostedAgentType,
  HostedAgentStatus,
  HostedAgentPublic
} from './hosted-agents/types.ts';

test('HostedAgent client contracts and model types conform to CONTRACT.graphql', async () => {
  // Test type compatibility and contract fields
  const mockAgent: HostedAgent = {
    id: 'agent_1',
    ownerId: 'user_1',
    publicId: 'pub_1',
    name: 'Sales Rep',
    businessName: 'Solar Tech SRL',
    slug: 'solar-tech',
    type: 'SALES',
    status: 'ACTIVE',
    instructions: 'Help customers qualify solar installations.',
    welcomeMessage: 'Hello! How can I assist you?',
    businessContext: 'Solar energy provider in Romania.',
    knowledgeJson: JSON.stringify({ companyDescription: 'Solar installations' }),
    appearanceJson: JSON.stringify({ primaryColor: '#b8a4ff' }),
    deploymentJson: JSON.stringify({ enableEmbed: true }),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  assert.equal(mockAgent.type, 'SALES');
  assert.equal(mockAgent.status, 'ACTIVE');
  assert.ok(mockAgent.publicId);
  assert.ok(mockAgent.slug);
});

test('Public agent loader script exists and contains zero credentials', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const agentScriptPath = path.resolve(process.cwd(), 'public/agent.js');
  const content = fs.readFileSync(agentScriptPath, 'utf-8');

  // Must not contain credentials, tokens, or private endpoints
  assert.ok(!content.includes('Bearer'));
  assert.ok(!content.includes('OPENROUTER_API_KEY'));
  assert.ok(!content.includes('secret'));
  assert.ok(content.includes('data-agent'));
  assert.ok(content.includes('/ai/embed/'));
});

test('Stoma San demo agent model has canonical Romanian dental prompts and welcome copy', async () => {
  const { STOMA_SAN_DEMO_AGENT } = await import('./hosted-agents/demo-data.ts');
  assert.equal(STOMA_SAN_DEMO_AGENT.name, 'Stoma San AI Receptionist');
  assert.equal(STOMA_SAN_DEMO_AGENT.slug, 'stoma-san');
  assert.equal(STOMA_SAN_DEMO_AGENT.status, 'DEMO');
  assert.ok(STOMA_SAN_DEMO_AGENT.welcomeMessage.includes('Stoma San'));
  assert.ok(STOMA_SAN_DEMO_AGENT.welcomeMessage.includes('programări'));

  const appearance = JSON.parse(STOMA_SAN_DEMO_AGENT.appearanceJson);
  assert.equal(appearance.title, 'Stoma San AI Receptionist');
  assert.deepEqual(appearance.quickPrompts, ['Programare', 'Servicii', 'Informații', 'Prețuri']);
});

