import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphql } from 'graphql';
import { Store } from '../src/store.js';
import { Events } from '../src/events.js';
import { createAppSchema } from '../src/schema.js';
import { sessionContext, hashPassword } from '../src/security.js';
import { OutlierClient, shouldRotateOutlierConversation } from '../src/outlier-client.js';
import { buildNextSite } from '../src/site-builder.js';

test('OutlierClient rotates conversation with continuity brief when conversation is full', async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = {
    STARLI_COOKIE: process.env.STARLI_COOKIE,
    STARLI_CSRF_TOKEN: process.env.STARLI_CSRF_TOKEN,
    STARLI_CONVERSATION_ID: process.env.STARLI_CONVERSATION_ID,
    STARLI_API_URL: process.env.STARLI_API_URL,
    STARLI_MODEL: process.env.STARLI_MODEL,
    NODE_ENV: process.env.NODE_ENV
  };

  process.env.STARLI_COOKIE = 'session=test-cookie';
  process.env.STARLI_CSRF_TOKEN = 'csrf-test-token';
  process.env.STARLI_CONVERSATION_ID = 'conv-old-123';
  process.env.STARLI_API_URL = 'https://app.outlier.ai/internal/experts/assistant/conversations/conv-old-123/turn-streaming';
  process.env.STARLI_MODEL = 'claude-opus-4-6';
  process.env.NODE_ENV = 'test';

  const calls: { url: string; body: any }[] = [];
  let rotatedConvId = '';

  globalThis.fetch = async (url, init) => {
    const targetUrl = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: targetUrl, body });

    if (targetUrl.includes('conv-old-123/turn-streaming')) {
      return new Response(JSON.stringify({ error: { message: 'Conversation is full. Please start a new conversation.' } }), { status: 400 });
    }
    if (targetUrl.endsWith('/conversations')) {
      return new Response(JSON.stringify({ id: 'conv-new-456' }), { status: 200 });
    }
    if (targetUrl.includes('conv-new-456/turn-streaming')) {
      const sse = [
        `data: ${JSON.stringify({ object: 'chat.completion.chunk', choices: [{ delta: { content: 'Salut! Continuăm construcția website-ului.' } }] })}`,
        'data: [DONE]',
        ''
      ].join('\n');
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('Not found', { status: 404 });
  };

  try {
    assert.equal(shouldRotateOutlierConversation(new Error('Unexpected HTTP status 400. Body preview: Conversation is full')), true);

    const client = new OutlierClient({
      systemPromptBuilder: () => 'Ești Starli AI.',
      continuityContextBuilder: () => ({ projectName: 'Atelier Ceramică', brief: 'Ceramică artizanală în Brașov' }),
      persistRuntime: false,
      initialConversationId: 'conv-old-123',
      initialApiUrl: 'https://app.outlier.ai/internal/experts/assistant/conversations/conv-old-123/turn-streaming',
      onRotate: (id) => { rotatedConvId = id; }
    });

    const answer = await client.ask('Adaugă secțiunea de galerie.');
    assert.equal(answer, 'Salut! Continuăm construcția website-ului.');
    assert.equal(rotatedConvId, 'conv-new-456');
    assert.equal(calls.length, 3);

    // 2nd call created the new conversation with the continuity brief
    assert.match(calls[1].url, /\/conversations$/);
    assert.match(calls[1].body.prompt.text, /BRIEF DE CONTINUITATE STARLI AI/);
    assert.match(calls[1].body.prompt.text, /Atelier Ceramică/);

    // 3rd call streamed on the new conversation with carry-forward context
    assert.match(calls[2].url, /conv-new-456\/turn-streaming$/);
    assert.match(calls[2].body.prompt.text, /Brief de continuitate/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('Admin can switch AI provider between OPENAI and OUTLIER, and image generation stays on OpenAI', async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ENABLE_IMAGE_GENERATION: process.env.ENABLE_IMAGE_GENERATION,
    ENABLE_MARKET_RESEARCH: process.env.ENABLE_MARKET_RESEARCH,
    STARLI_COOKIE: process.env.STARLI_COOKIE,
    STARLI_CSRF_TOKEN: process.env.STARLI_CSRF_TOKEN,
    STARLI_CONVERSATION_ID: process.env.STARLI_CONVERSATION_ID,
    STARLI_API_URL: process.env.STARLI_API_URL,
    NODE_ENV: process.env.NODE_ENV
  };

  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ENABLE_IMAGE_GENERATION = 'true';
  process.env.ENABLE_MARKET_RESEARCH = 'false';
  process.env.STARLI_COOKIE = 'session=outlier-cookie';
  process.env.STARLI_CSRF_TOKEN = 'outlier-csrf';
  process.env.STARLI_CONVERSATION_ID = 'conv-site-789';
  process.env.STARLI_API_URL = 'https://app.outlier.ai/internal/experts/assistant/conversations/conv-site-789/turn-streaming';
  process.env.NODE_ENV = 'test';

  const store = new Store(':memory:');
  const events = new Events();
  const schema = createAppSchema(store, events);
  const adminUser = store.saveUser({
    id: 'admin-1',
    username: 'alex',
    email: 'alex@starlidigital.ro',
    recoveryEmail: 'alex@example.com',
    role: 'ADMIN',
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword('admin-very-secure-password')
  });
  const adminCtx = { store, user: adminUser, ip: '127.0.0.1', setCookie: () => {} };

  const endpointsCalled: string[] = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    endpointsCalled.push(target);
    if (target === 'https://api.openai.com/v1/images/generations') {
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') }] }), { status: 200 });
    }
    if (target.endsWith('/conversations')) return new Response(JSON.stringify({id:'conv-new-build'}));
    if (target.includes('outlier.ai')) {
      const siteJson = JSON.stringify({
        page: 'export default function Home(){return <main><h1>Cafenea</h1><img src="assets/hero.png" alt="Hero"/></main>}',
        css: 'body{margin:0;background:#111;color:#fff}',
        title: 'Cafenea Specialitate',
        description: 'Cafenea în București'
      });
      const sse = `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: siteJson })}\ndata: [DONE]\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error(`Unexpected URL: ${target}`);
  };

  try {
    // Non-admin cannot switch provider
    const guestCtx = sessionContext(store, '', () => {}, 'guest-ip');
    const denied = await graphql({
      schema,
      source: 'mutation { setAIProvider(provider: OUTLIER) { aiProvider } }',
      contextValue: guestCtx
    });
    assert.ok(denied.errors);

    // Admin switches provider to OUTLIER
    const switched = await graphql({
      schema,
      source: 'mutation { setAIProvider(provider: OUTLIER) { aiProvider } }',
      contextValue: adminCtx
    });
    assert.equal(switched.errors, undefined);
    assert.equal((switched.data as any).setAIProvider.aiProvider, 'OUTLIER');

    // Build site using OUTLIER while keeping image generation on OpenAI
    const built = await buildNextSite('Cafenea de specialitate în centrul Bucureștiului', 'Cafenea', { provider: 'OUTLIER' });
    assert.ok(built.files.some(f => f.path === 'public/assets/hero.png'));
    assert.ok(built.files.some(f => f.path === 'public/assets/logo.png'));
    assert.equal(endpointsCalled.filter(u => u === 'https://api.openai.com/v1/images/generations').length, 2);
    assert.equal(endpointsCalled.filter(u => u.includes('outlier.ai')).length, 2);

    // Iterative rebuild reuses existing PNG assets without calling OpenAI images API again
    endpointsCalled.length = 0;
    const rebuilt = await buildNextSite('Cafenea de specialitate — adaugă secțiunea de meniu', 'Cafenea', {
      provider: 'OUTLIER',
      existingFiles: built.files,
      regenerateImages: false
    });
    assert.ok(rebuilt.files.some(f => f.path === 'public/assets/hero.png'));
    assert.equal(endpointsCalled.filter(u => u === 'https://api.openai.com/v1/images/generations').length, 0);
    assert.equal(endpointsCalled.filter(u => u.includes('outlier.ai')).length, 2);
  } finally {
    store.close();
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('User can delete their own project and cannot delete another user project', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const schema = createAppSchema(store, events);
  const ownerUser = store.saveUser({
    id: 'user-owner',
    username: 'maria',
    email: 'maria@starlidigital.ro',
    recoveryEmail: 'maria@example.com',
    role: 'USER',
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword('maria-very-secure-password')
  });
  const otherUser = store.saveUser({
    id: 'user-other',
    username: 'andrei',
    email: 'andrei@starlidigital.ro',
    recoveryEmail: 'andrei@example.com',
    role: 'USER',
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword('andrei-very-secure-password')
  });
  const ownerCtx = { store, user: ownerUser, ip: '127.0.0.2', setCookie: () => {} };
  const otherCtx = { store, user: otherUser, ip: '127.0.0.3', setCookie: () => {} };

  try {
    const created = await graphql({
      schema,
      source: 'mutation { createProject(name: "Studio Foto", brief: "Portofoliu fotografie") { id name } }',
      contextValue: ownerCtx
    });
    assert.equal(created.errors, undefined);
    const projectId = (created.data as any).createProject.id;

    // Link a conversation to this project
    store.put('conversations', {
      id: 'conv-linked',
      ownerId: ownerUser.id,
      projectId,
      title: 'Studio Foto Chat',
      mode: 'STARLI',
      status: 'OPEN',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // Other user cannot delete owner's project
    const forbidden = await graphql({
      schema,
      source: 'mutation($id: ID!) { deleteProject(id: $id) }',
      variableValues: { id: projectId },
      contextValue: otherCtx
    });
    assert.ok(forbidden.errors);
    assert.ok(store.get('projects', projectId));

    // Owner deletes their project
    const deleted = await graphql({
      schema,
      source: 'mutation($id: ID!) { deleteProject(id: $id) }',
      variableValues: { id: projectId },
      contextValue: ownerCtx
    });
    assert.equal(deleted.errors, undefined);
    assert.equal((deleted.data as any).deleteProject, true);
    assert.equal(store.get('projects', projectId), undefined);
    assert.equal(store.get('conversations', 'conv-linked')?.projectId, null);
  } finally {
    store.close();
  }
});

test('Project workspace loop: build creates previewHtml + version + AgentRun, inlineTextEdit creates new version, and restoreProjectVersion reverts cleanly', async () => {
  const originalFetch = globalThis.fetch;
  const savedEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ENABLE_IMAGE_GENERATION: process.env.ENABLE_IMAGE_GENERATION,
    ENABLE_MARKET_RESEARCH: process.env.ENABLE_MARKET_RESEARCH,
    NEXT_WORKER_ENABLED: process.env.NEXT_WORKER_ENABLED
  };
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.ENABLE_IMAGE_GENERATION = 'false';
  process.env.ENABLE_MARKET_RESEARCH = 'false';
  process.env.NEXT_WORKER_ENABLED = 'false';

  globalThis.fetch = async () => {
    const output = JSON.stringify({
      page: 'export default function Home(){return <main><section className="hero"><h1>Florăria Atelier</h1><p>Buchete de autor în București</p></section></main>}',
      css: ':root{--background:#faf6f0;--foreground:#1e1a17}body{background:var(--background);color:var(--foreground)}',
      title: 'Florăria Atelier',
      description: 'Buchete în București'
    });
    return new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }]
    }), { status: 200 });
  };

  const store = new Store(':memory:');
  const events = new Events();
  const schema = createAppSchema(store, events);
  const user = store.saveUser({
    id: 'user-studio',
    username: 'elena',
    email: 'elena@starlidigital.ro',
    recoveryEmail: 'elena@example.com',
    role: 'USER',
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword('elena-very-secure-password')
  });
  const ctx = { store, user, ip: '127.0.0.9', setCookie: () => {} };

  try {
    const created = await graphql({
      schema,
      source: 'mutation { createProject(name: "Florăria Atelier", brief: "Florărie în București") { id buildState publishState previewState } }',
      contextValue: ctx
    });
    assert.equal(created.errors, undefined);
    const projectId = (created.data as any).createProject.id;
    assert.equal((created.data as any).createProject.buildState, 'idle');

    // Update Project Knowledge (Starli DNA)
    const dnaRes = await graphql({
      schema,
      source: 'mutation($id: ID!) { updateProjectKnowledge(projectId: $id, input: { businessSummary: "Florărie artizanală", brandDirection: "Cald, editorial" }) { knowledge { businessSummary brandDirection } } }',
      variableValues: { id: projectId },
      contextValue: ctx
    });
    assert.equal(dnaRes.errors, undefined);
    assert.equal((dnaRes.data as any).updateProjectKnowledge.knowledge.brandDirection, 'Cald, editorial');

    // Trigger Build
    const buildRes = await graphql({
      schema,
      source: 'mutation($id: ID!) { buildProject(id: $id, summary: "Prima versiune") { id status } }',
      variableValues: { id: projectId },
      contextValue: ctx
    });
    assert.equal(buildRes.errors, undefined);

    // Wait for async build completion
    let proj: any;
    for (let i = 0; i < 60; i++) {
      proj = store.get('projects', projectId);
      if (proj?.status === 'SOURCE_READY') break;
      await new Promise(r => setTimeout(r, 15));
    }
    assert.equal(proj?.status, 'SOURCE_READY');
    assert.ok(proj?.previewHtml?.includes('Florăria Atelier'));
    assert.equal(proj?.versions?.length, 1);
    assert.equal(proj?.agentRuns?.length, 1);
    assert.equal(proj?.agentRuns[0].status, 'success');
    const v1Id = proj.versions[0].id;

    // Deterministic inline text edit (no AI call needed)
    const edited = await graphql({
      schema,
      source: 'mutation($id: ID!) { inlineTextEdit(projectId: $id, originalText: "Buchete de autor în București", replacementText: "Colecții florale create la comandă") { previewHtml versions { id summary source } } }',
      variableValues: { id: projectId },
      contextValue: ctx
    });
    assert.equal(edited.errors, undefined);
    const editedProj = (edited.data as any).inlineTextEdit;
    assert.ok(editedProj.previewHtml.includes('Colecții florale create la comandă'));
    assert.equal(editedProj.versions.length, 2);
    assert.equal(editedProj.versions[0].source, 'visual-edit');

    // Restore Version 1
    const restored = await graphql({
      schema,
      source: 'mutation($id: ID!, $vId: ID!) { restoreProjectVersion(projectId: $id, versionId: $vId) { previewHtml versions { id source } notifications { id kind title read } } }',
      variableValues: { id: projectId, vId: v1Id },
      contextValue: ctx
    });
    assert.equal(restored.errors, undefined);
    const restoredProj = (restored.data as any).restoreProjectVersion;
    assert.ok(restoredProj.previewHtml.includes('Buchete de autor în București'));
    assert.equal(restoredProj.versions.length, 3);
    assert.equal(restoredProj.versions[0].source, 'restore');
    assert.ok(Array.isArray(restoredProj.notifications) && restoredProj.notifications.length >= 4);
    assert.ok(restoredProj.notifications.some((n: any) => !n.read));

    // Mark notifications read
    const marked = await graphql({
      schema,
      source: 'mutation($id: ID!) { markProjectNotificationsRead(projectId: $id) { notifications { id read } } }',
      variableValues: { id: projectId },
      contextValue: ctx
    });
    assert.equal(marked.errors, undefined);
    assert.ok((marked.data as any).markProjectNotificationsRead.notifications.every((n: any) => n.read === true));

    // Only confirmed web-search output may be billed or presented as research.
    globalThis.fetch=async()=>new Response(JSON.stringify({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'## Oportunitatea ta principală\nUn website clar pentru atelier, pe baza sursei publice analizate.',annotations:[{type:'url_citation',url:'https://example.com/atelier',title:'Atelier'}]}]}]}));
    // Run project web research & competitor snapshot
    const researched = await graphql({
      schema,
      source: 'mutation($id: ID!) { runProjectResearch(projectId: $id) { research agentRuns { summary status steps { category title } } notifications { kind title read } } }',
      variableValues: { id: projectId },
      contextValue: ctx
    });
    assert.equal(researched.errors, undefined);
    const resProj = (researched.data as any).runProjectResearch;
    assert.ok(resProj.research.includes('Oportunitatea ta principală'));
    assert.ok(resProj.notifications.some((n: any) => n.kind === 'research' && n.read === false));
  } finally {
    store.close();
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('Interactive ask_user question tool and chat attachments in sendMessage', async () => {
  const originalFetch = globalThis.fetch;
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'function_call',
          name: 'ask_user',
          arguments: JSON.stringify({
            kind: 'name',
            question: 'Cum se numește cafeneaua ta sau ce variantă ți se potrivește?',
            options: [
              { label: 'Atelierul de Cafea (Recomandat)', value: 'Atelierul de Cafea', recommended: true },
              { label: 'Origini Nord', value: 'Origini Nord' },
              { label: 'Kava Studio', value: 'Kava Studio' }
            ],
            allowCustom: true,
            customPlaceholder: 'Alt nume (scrie numele tău)…',
            moreIdeasLabel: 'Mai multe idei de nume',
            moreIdeasPrompt: 'Propune-mi încă 4 idei de nume pentru cafenea'
          })
        }
      ]
    }), { status: 200 });
  };

  const store = new Store(':memory:');
  const events = new Events();
  const schema = createAppSchema(store, events);
  const user = store.saveUser({
    id: 'user-ask',
    username: 'vlad',
    email: 'vlad@starlidigital.ro',
    recoveryEmail: 'vlad@example.com',
    role: 'USER',
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword('vlad-very-secure-password')
  });
  const ctx = { store, user, ip: '127.0.0.11', setCookie: () => {} };

  try {
    const convRes = await graphql({
      schema,
      source: 'mutation { createConversation(mode: STARLI, title: "Cafenea") { id } }',
      contextValue: ctx
    });
    assert.equal(convRes.errors, undefined);
    const convId = (convRes.data as any).createConversation.id;

    const sendRes = await graphql({
      schema,
      source: `mutation($cid: ID!, $att: [ChatAttachmentInput!]) {
        sendMessage(conversationId: $cid, content: "Vreau o cafenea dar nu am nume încă", actionMode: CHAT, attachments: $att) {
          id
          attachments { name mimeType }
        }
      }`,
      variableValues: {
        cid: convId,
        att: [{ name: 'meniu.txt', mimeType: 'text/plain', textExcerpt: 'Espresso, Flat White, V60' }]
      },
      contextValue: ctx
    });
    assert.equal(sendRes.errors, undefined);
    assert.equal((sendRes.data as any).sendMessage.attachments[0].name, 'meniu.txt');

    // Wait for async assistant turn with questionJson
    let conv: any;
    for (let i = 0; i < 40; i++) {
      conv = store.get('conversations', convId);
      if (conv?.messages?.length >= 2) break;
      await new Promise(r => setTimeout(r, 15));
    }
    assert.equal(conv.messages.length, 2);
    const assistantMsg = conv.messages[1];
    assert.ok(assistantMsg.questionJson);
    const parsedQ = JSON.parse(assistantMsg.questionJson);
    assert.equal(parsedQ.kind, 'name');
    assert.equal(parsedQ.options.length, 3);
    assert.equal(parsedQ.options[0].recommended, true);
  } finally {
    store.close();
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  }
});
