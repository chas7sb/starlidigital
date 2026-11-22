import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../../server/src/store.js';
import { Events } from '../../server/src/events.js';
import { AssetServices } from '../../server/src/assets/service.js';
import { VideoServices } from '../../server/src/video/service.js';
import { createControlPlaneServer } from '../src/server.js';
import { FixtureTokenVerifier } from '../src/auth.js';
import { SqliteAuditSink } from '../src/audit.js';
import type { UpstreamHealthProbe, ControlPlaneConfig } from '../src/types.js';

test('MCP Video Studio: Complete AI Orchestration & Toolset Verification', async () => {
  const store = new Store(':memory:');
  const events = new Events();
  const assetServices = new AssetServices({ store, events });
  const videoServices = new VideoServices({ store, events, assetServices });
  const auditSink = new SqliteAuditSink(':memory:');

  const validToken = 'mcp-test-admin-bearer-token';
  const readOnlyToken = 'mcp-test-readonly-bearer-token';

  const tokenVerifier = new FixtureTokenVerifier();
  tokenVerifier.registerToken(validToken, {
    id: 'admin-orchestrator',
    role: 'admin',
    scopes: ['read', 'write', 'admin', '*'],
    email: 'admin@starlidigital.ro',
  });
  tokenVerifier.registerToken(readOnlyToken, {
    id: 'readonly-orchestrator',
    role: 'admin',
    scopes: ['read'],
    email: 'readonly@starlidigital.ro',
  });

  const healthProbe: UpstreamHealthProbe = {
    async probe() {
      return { ready: true, service: 'starlidigital-control-plane', dependencies: { database: 'UP' } };
    },
  };

  const config: ControlPlaneConfig = {
    upstreamHealthUrl: 'http://127.0.0.1/health',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: ['http://127.0.0.1', 'http://localhost', '*'],
    controlDbPath: ':memory:',
    publicResourceUrl: 'https://api.starlidigital.ro/mcp',
  };

  const cpServer = createControlPlaneServer({
    config,
    tokenVerifier,
    auditSink,
    healthProbe,
    assetServices,
    videoServices,
    store,
    events,
  });

  // Start HTTP server on ephemeral port
  const port = await new Promise<number>((resolve) => {
    cpServer.listen(0, '127.0.0.1', () => {
      const addr = cpServer.address() as any;
      resolve(addr.port);
    });
  });

  try {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${validToken}` },
      },
    });

    const client = new Client(
      { name: 'test-chatgpt-orchestrator', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    // 1. Tool discovery
    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((t) => t.name);

    assert.ok(toolNames.includes('video_project_create'), 'video_project_create must be registered');
    assert.ok(toolNames.includes('video_project_get'), 'video_project_get must be registered');
    assert.ok(toolNames.includes('video_project_list'), 'video_project_list must be registered');
    assert.ok(toolNames.includes('video_project_apply_spec'), 'video_project_apply_spec must be registered');
    assert.ok(toolNames.includes('video_project_patch_spec'), 'video_project_patch_spec must be registered');
    assert.ok(toolNames.includes('video_asset_upload'), 'video_asset_upload must be registered');
    assert.ok(toolNames.includes('video_asset_import'), 'video_asset_import must be registered');
    assert.ok(toolNames.includes('video_voiceover_create'), 'video_voiceover_create must be registered');
    assert.ok(toolNames.includes('video_validate'), 'video_validate must be registered');
    assert.ok(toolNames.includes('video_preview_frame'), 'video_preview_frame must be registered');
    assert.ok(toolNames.includes('video_render_start'), 'video_render_start must be registered');
    assert.ok(toolNames.includes('video_render_status'), 'video_render_status must be registered');
    assert.ok(toolNames.includes('video_output_get'), 'video_output_get must be registered');
    assert.ok(toolNames.includes('brand_profile_create'), 'brand_profile_create must be registered');
    assert.ok(toolNames.includes('brand_profile_get'), 'brand_profile_get must be registered');

    // 2. ChatGPT uploads a generated image (1x1 PNG)
    const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploadRes = await client.callTool({
      name: 'video_asset_upload',
      arguments: {
        base64Data: tinyPngBase64,
        mimeType: 'image/png',
        filenameHint: 'chatgpt_artwork.png',
        altText: 'Cosmic Starli Spire Artwork',
      },
    });

    assert.equal(uploadRes.isError, undefined);
    const uploadJson = JSON.parse(((uploadRes as any).content[0] as any).text);
    assert.equal(uploadJson.status, 'UPLOADED');
    assert.ok(uploadJson.assetId.startsWith('ast-'));
    const generatedAssetId = uploadJson.assetId;

    // 3. ChatGPT creates a video project
    const createRes = await client.callTool({
      name: 'video_project_create',
      arguments: {
        title: 'Starli AI Agents — Universal Reel',
        format: 'VERTICAL_9_16',
        purpose: 'AI Orchestrated Showcase Video',
      },
    });

    assert.equal(createRes.isError, undefined);
    const createJson = JSON.parse(((createRes as any).content[0] as any).text);
    assert.equal(createJson.status, 'CREATED');
    const projectId = createJson.project.id;
    assert.ok(projectId.startsWith('vproj-'));

    // 4. ChatGPT declaratively composes the entire multi-scene video using the uploaded image
    const fullSpec = {
      canvas: { width: 720, height: 1280, fps: 30 },
      brand: {
        businessName: 'StarliDigital',
        primaryColor: '#080C12',
        accentColor: '#C6DBF0',
      },
      scenes: [
        {
          id: 'scene_artwork',
          duration: 3.0,
          background: {
            type: 'image',
            assetId: generatedAssetId,
            effect: 'ken_burns',
          },
          layers: [
            {
              type: 'shape',
              shape: 'starli_star',
              x: 360,
              y: 200,
              width: 50,
              height: 50,
            },
            {
              type: 'text',
              text: 'Inteligență Artificială.\nConstruită pentru afacerea ta.',
              fontSize: 38,
              fontWeight: 'bold',
              align: 'center',
              anchor: 'top_center',
              x: 360,
              y: 320,
            },
          ],
        },
        {
          id: 'scene_ui',
          duration: 3.0,
          transition: { type: 'crossfade', duration: 0.5 },
          background: { type: 'color', color: '#10151D' },
          layers: [
            {
              type: 'ui',
              component: 'status_pill',
              x: 230,
              y: 200,
              componentProps: { label: 'STARLI AI · AGENT' },
            },
            {
              type: 'ui',
              component: 'chat_bubble',
              x: 60,
              y: 300,
              width: 600,
              height: 180,
              componentProps: {
                sender: 'Starli AI',
                message: 'Preluăm automat solicitările clienților tăi 24/7.',
              },
            },
          ],
        },
      ],
      audioTracks: [],
      voiceovers: [],
    };

    const applyRes = await client.callTool({
      name: 'video_project_apply_spec',
      arguments: {
        projectId,
        spec: fullSpec,
      },
    });

    assert.equal(applyRes.isError, undefined);
    const applyJson = JSON.parse(((applyRes as any).content[0] as any).text);
    assert.equal(applyJson.status, 'SPEC_APPLIED');
    assert.equal(applyJson.scenesCount, 2);

    // 5. ChatGPT validates the composition
    const valRes = await client.callTool({
      name: 'video_validate',
      arguments: { projectId },
    });
    assert.equal(valRes.isError, undefined);
    const valJson = JSON.parse(((valRes as any).content[0] as any).text);
    assert.equal(valJson.valid, true);

    // 6. ChatGPT requests preview frame at 1.5s
    const prevRes = await client.callTool({
      name: 'video_preview_frame',
      arguments: {
        projectId,
        timestamp: 1.5,
      },
    });
    assert.equal(prevRes.isError, undefined);
    assert.ok((prevRes as any).content.some((c: any) => c.type === 'image'));

    // 7. ChatGPT queues render
    const renderRes = await client.callTool({
      name: 'video_render_start',
      arguments: { projectId },
    });
    assert.equal(renderRes.isError, undefined);
    const renderJson = JSON.parse(((renderRes as any).content[0] as any).text);
    assert.equal(renderJson.status, 'QUEUED');
    assert.ok(renderJson.renderId.startsWith('vrnd-'));

    // 8. ChatGPT inspects render status
    const statusRes = await client.callTool({
      name: 'video_render_status',
      arguments: { renderId: renderJson.renderId },
    });
    assert.equal(statusRes.isError, undefined);
    const statusJson = JSON.parse(((statusRes as any).content[0] as any).text);
    assert.ok(['QUEUED', 'VALIDATING', 'RENDERING_FRAMES', 'COMPLETE'].includes(statusJson.status));

    await client.close();

    // 9. Read-only client cannot execute write tool video_project_create
    const roTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${readOnlyToken}` },
      },
    });
    const roClient = new Client({ name: 'readonly-client', version: '1.0.0' }, { capabilities: {} });
    await roClient.connect(roTransport);

    const roDeniedRes = await roClient.callTool({
      name: 'video_project_create',
      arguments: { title: 'Denied Project' },
    });
    assert.equal(roDeniedRes.isError, true);
    await roClient.close();
  } finally {
    await new Promise<void>((resolve) => cpServer.close(() => resolve()));
    auditSink.close();
  }
});
